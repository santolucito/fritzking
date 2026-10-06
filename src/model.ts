import { P } from './types';
import type { Doc, PartDef, PartInstance, Placement, Pt, ViewId, Wire } from './types';
import { PARTS, getDef } from './parts';

export const snap = (v: number, step = P) => Math.round(v / step) * step;
export const uid = () => Math.random().toString(36).slice(2, 10);
export const clone = <T,>(v: T): T => structuredClone(v);

export function produce(doc: Doc, fn: (d: Doc) => void): Doc {
  const d = clone(doc);
  fn(d);
  return d;
}

export function geom(def: PartDef, view: ViewId) {
  return view === 'bb' ? def.bb : def.sch;
}

export function inView(inst: PartInstance, view: ViewId): boolean {
  return !!geom(getDef(inst.type), view);
}

export function rotatePt(p: Pt, pivot: Pt, rot: number): Pt {
  const dx = p.x - pivot.x, dy = p.y - pivot.y;
  switch (((rot % 360) + 360) % 360) {
    case 90: return { x: pivot.x - dy, y: pivot.y + dx };
    case 180: return { x: pivot.x - dx, y: pivot.y - dy };
    case 270: return { x: pivot.x + dy, y: pivot.y - dx };
    default: return { x: p.x, y: p.y };
  }
}

export function toWorld(local: Pt, pl: Placement, pivot: Pt): Pt {
  const r = rotatePt(local, pivot, pl.rot);
  return { x: r.x + pl.x, y: r.y + pl.y };
}

export function pinWorld(inst: PartInstance, view: ViewId, conn: string): Pt | null {
  const g = geom(getDef(inst.type), view);
  const p = g?.pins[conn];
  if (!g || !p) return null;
  return toWorld(p, inst[view], g.pivot);
}

export interface Rect { x: number; y: number; w: number; h: number }

export function partBounds(inst: PartInstance, view: ViewId): Rect | null {
  const g = geom(getDef(inst.type), view);
  if (!g) return null;
  const b = g.bounds;
  const corners = [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h },
  ].map((c) => toWorld(c, inst[view], g.pivot));
  const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const rectsOverlap = (a: Rect, b: Rect, m = 0) =>
  a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

export const nodeKey = (part: string, conn: string) => `${part}:${conn}`;
export const wireKey = (wire: string, end: number) => `${wire}@${end}`;

export interface PinPos {
  node: string;
  part: string;
  conn: string;
  x: number;
  y: number;
  breadboard: boolean;
}

export function pinPositions(doc: Doc, view: ViewId): PinPos[] {
  const out: PinPos[] = [];
  for (const inst of doc.parts) {
    const def = PARTS[inst.type];
    const g = def && geom(def, view);
    if (!g) continue;
    for (const [conn, p] of Object.entries(g.pins)) {
      const w = toWorld(p, inst[view], g.pivot);
      out.push({ node: nodeKey(inst.id, conn), part: inst.id, conn, x: w.x, y: w.y, breadboard: !!def.isBreadboard });
    }
  }
  return out;
}

const posKey = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;

class UnionFind {
  parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a);
    if (p === undefined) {
      this.parent.set(a, a);
      return a;
    }
    if (p === a) return a;
    p = this.find(p);
    this.parent.set(a, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface Nets {
  find: (node: string) => string;
  groups: Map<string, string[]>;
}

/** Connectivity: internal buses, wires, and coincident connectors in the given view(s). */
export function computeNets(doc: Doc, scope: ViewId | 'all'): Nets {
  const uf = new UnionFind();
  const views: ViewId[] = scope === 'all' ? ['bb', 'sch'] : [scope];
  for (const inst of doc.parts) {
    const def = PARTS[inst.type];
    if (!def) continue;
    for (const c of def.connectors) uf.find(nodeKey(inst.id, c.id));
    for (const bus of def.buses ?? []) for (let i = 1; i < bus.length; i++) uf.union(nodeKey(inst.id, bus[0]), nodeKey(inst.id, bus[i]));
  }
  for (const view of views) {
    const at = new Map<string, string>();
    const touch = (node: string, x: number, y: number) => {
      const k = posKey(x, y);
      const other = at.get(k);
      if (other) uf.union(node, other);
      else at.set(k, node);
    };
    for (const p of pinPositions(doc, view)) touch(p.node, p.x, p.y);
    for (const w of doc.wires) {
      if (w.view !== view) continue;
      uf.union(wireKey(w.id, 0), wireKey(w.id, 1));
      w.ends.forEach((e, i) => touch(wireKey(w.id, i), e.x, e.y));
    }
  }
  const groups = new Map<string, string[]>();
  for (const node of uf.parent.keys()) {
    const r = uf.find(node);
    const g = groups.get(r);
    if (g) g.push(node);
    else groups.set(r, [node]);
  }
  return { find: (n) => uf.find(n), groups };
}

/** Move attached wire ends onto their connectors; drop attachments that no longer resolve. */
export function syncAttachments(doc: Doc) {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  for (const w of doc.wires) {
    for (const e of w.ends) {
      if (!e.attach) continue;
      const inst = byId.get(e.attach.part);
      const p = inst && pinWorld(inst, w.view, e.attach.conn);
      if (!p) {
        delete e.attach;
        continue;
      }
      e.x = p.x;
      e.y = p.y;
    }
  }
}

/** Attach wire ends to whatever connector they sit on (prefers parts over breadboard holes). */
export function reattach(doc: Doc) {
  for (const view of ['bb', 'sch'] as ViewId[]) {
    const at = new Map<string, PinPos[]>();
    for (const p of pinPositions(doc, view)) {
      const k = posKey(p.x, p.y);
      const l = at.get(k);
      if (l) l.push(p);
      else at.set(k, [p]);
    }
    for (const w of doc.wires) {
      if (w.view !== view) continue;
      for (const e of w.ends) {
        const cands = at.get(posKey(e.x, e.y)) ?? [];
        if (e.attach && cands.some((c) => c.part === e.attach!.part && c.conn === e.attach!.conn)) continue;
        const best = cands.find((c) => !c.breadboard) ?? cands[0];
        if (best) e.attach = { part: best.part, conn: best.conn };
        else delete e.attach;
      }
    }
  }
}

export interface RatLine { x1: number; y1: number; x2: number; y2: number; a: PinPos; b: PinPos }

export interface Routing {
  lines: RatLine[];
  netsToRoute: number;
  netsRouted: number;
  unrouted: number;
}

/** Dashed "ratsnest" lines: connections that exist in some view but are not yet wired in this one. */
export function ratsnest(doc: Doc, view: ViewId, full: Nets, local: Nets): Routing {
  const byFull = new Map<string, PinPos[]>();
  for (const p of pinPositions(doc, view)) {
    if (p.breadboard) continue;
    const r = full.find(p.node);
    const l = byFull.get(r);
    if (l) l.push(p);
    else byFull.set(r, [p]);
  }
  const lines: RatLine[] = [];
  let netsToRoute = 0, netsRouted = 0, unrouted = 0;
  for (const pins of byFull.values()) {
    if (pins.length < 2) continue;
    netsToRoute++;
    const clusters = new Map<string, PinPos[]>();
    for (const p of pins) {
      const r = local.find(p.node);
      const l = clusters.get(r);
      if (l) l.push(p);
      else clusters.set(r, [p]);
    }
    const cl = [...clusters.values()];
    if (cl.length === 1) {
      netsRouted++;
      continue;
    }
    unrouted += cl.length - 1;
    // Prim's algorithm over clusters
    const inTree = [...cl[0]];
    const rest = cl.slice(1);
    while (rest.length) {
      let best = { d: Infinity, a: inTree[0], b: rest[0][0], ci: 0 };
      rest.forEach((c, ci) => {
        for (const b of c)
          for (const a of inTree) {
            const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
            if (d < best.d) best = { d, a, b, ci };
          }
      });
      lines.push({ x1: best.a.x, y1: best.a.y, x2: best.b.x, y2: best.b.y, a: best.a, b: best.b });
      inTree.push(...rest[best.ci]);
      rest.splice(best.ci, 1);
    }
  }
  return { lines, netsToRoute, netsRouted, unrouted };
}

export function nextLabel(doc: Doc, prefix: string): string {
  let n = 1;
  const used = new Set(doc.parts.map((p) => p.label));
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Find a spot in `view` where a part's bounds don't overlap others, spiralling out from `seed`. */
export function findFreeSpot(doc: Doc, view: ViewId, inst: PartInstance, seed: Pt): Placement {
  const others = doc.parts.filter((p) => p.id !== inst.id).map((p) => partBounds(p, view)).filter(Boolean) as Rect[];
  const step = P * 2;
  for (let ring = 0; ring < 40; ring++) {
    for (let i = -ring; i <= ring; i++)
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const pl = { x: snap(seed.x + i * step), y: snap(seed.y + j * step), rot: 0 };
        const b = partBounds({ ...inst, [view]: pl }, view);
        if (b && !others.some((o) => rectsOverlap(o, b, P))) return pl;
      }
  }
  return { x: snap(seed.x), y: snap(seed.y), rot: 0 };
}

export function centroid(doc: Doc, view: ViewId): Pt {
  const bs = doc.parts.map((p) => partBounds(p, view)).filter(Boolean) as Rect[];
  if (!bs.length) return { x: 0, y: 0 };
  return {
    x: bs.reduce((s, b) => s + b.x + b.w / 2, 0) / bs.length,
    y: bs.reduce((s, b) => s + b.y + b.h / 2, 0) / bs.length,
  };
}

/** Create a part centred at `at` in `view`, auto-placed in the other view. */
export function createPart(doc: Doc, type: string, view: ViewId, at: Pt): PartInstance {
  const def = getDef(type);
  const props: Record<string, string> = {};
  for (const pd of def.props) props[pd.key] = pd.default;
  const inst: PartInstance = {
    id: uid(),
    type,
    label: nextLabel(doc, def.labelPrefix),
    props,
    bb: { x: 0, y: 0, rot: 0 },
    sch: { x: 0, y: 0, rot: 0 },
  };
  const g = geom(def, view)!;
  inst[view] = {
    x: snap(at.x - (g.bounds.x + g.bounds.w / 2)),
    y: snap(at.y - (g.bounds.y + g.bounds.h / 2)),
    rot: 0,
  };
  const other: ViewId = view === 'bb' ? 'sch' : 'bb';
  if (geom(def, other)) {
    const c = doc.parts.length ? centroid(doc, other) : at;
    inst[other] = findFreeSpot(doc, other, inst, c);
  }
  return inst;
}

export function wireLength(w: Wire): number {
  const pts = [w.ends[0], ...w.bends, w.ends[1]];
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}

export function docBounds(doc: Doc, view: ViewId): Rect | null {
  const rs: Rect[] = doc.parts.map((p) => partBounds(p, view)).filter(Boolean) as Rect[];
  for (const w of doc.wires) {
    if (w.view !== view) continue;
    for (const p of [...w.ends, ...w.bends]) rs.push({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  if (!rs.length) return null;
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

/** Convert every ratsnest line in `view` into a wire (L-shaped in schematic view). */
export function autoroute(doc: Doc, view: ViewId, color: string): Doc {
  const full = computeNets(doc, 'all');
  const local = computeNets(doc, view);
  const { lines } = ratsnest(doc, view, full, local);
  if (!lines.length) return doc;
  return produce(doc, (d) => {
    for (const l of lines) {
      const bends: Pt[] = view === 'sch' && l.x1 !== l.x2 && l.y1 !== l.y2 ? [{ x: l.x2, y: l.y1 }] : [];
      d.wires.push({
        id: uid(),
        view,
        ends: [
          { x: l.x1, y: l.y1, attach: { part: l.a.part, conn: l.a.conn } },
          { x: l.x2, y: l.y2, attach: { part: l.b.part, conn: l.b.conn } },
        ],
        bends,
        color,
      });
    }
  });
}

/** Placement that puts connector `conn` of a part at world point `at` with rotation `rot`. */
export function placementForPin(type: string, view: ViewId, conn: string, at: Pt, rot = 0): Placement {
  const g = geom(getDef(type), view)!;
  const r = rotatePt(g.pins[conn], g.pivot, rot);
  return { x: at.x - r.x, y: at.y - r.y, rot };
}

/** Copy of selected items with fresh ids, offset by (dx, dy) in `view`; wires keep attachments inside the copy. */
export function cloneItems(doc: Doc, parts: PartInstance[], wires: Wire[], view: ViewId, dx: number, dy: number): { parts: PartInstance[]; wires: Wire[] } {
  const idMap = new Map<string, string>();
  const scratch = clone(doc);
  const outParts: PartInstance[] = [];
  for (const p of parts) {
    const def = getDef(p.type);
    const copy: PartInstance = clone(p);
    copy.id = uid();
    copy.label = nextLabel(scratch, def.labelPrefix);
    scratch.parts.push(copy);
    idMap.set(p.id, copy.id);
    copy[view] = { ...copy[view], x: copy[view].x + dx, y: copy[view].y + dy };
    const other: ViewId = view === 'bb' ? 'sch' : 'bb';
    if (geom(def, other)) copy[other] = findFreeSpot(scratch, other, copy, copy[other]);
    outParts.push(copy);
  }
  const outWires: Wire[] = [];
  for (const w of wires) {
    const copy: Wire = clone(w);
    copy.id = uid();
    if (w.view === view)
      for (const p of [...copy.ends, ...copy.bends]) {
        p.x += dx;
        p.y += dy;
      }
    for (const e of copy.ends) if (e.attach) e.attach = idMap.has(e.attach.part) ? { ...e.attach, part: idMap.get(e.attach.part)! } : undefined;
    outWires.push(copy);
  }
  return { parts: outParts, wires: outWires };
}
