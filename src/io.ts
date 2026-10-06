import type { Doc, PartInstance, ViewId, Wire } from './types';
import { P } from './types';
import { computeNets, docBounds, nodeKey, placementForPin, reattach, uid } from './model';
import { PARTS, getDef } from './parts';

const STORAGE_KEY = 'fritzking.doc.v1';

export function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function serialize(doc: Doc): string {
  return JSON.stringify({ app: 'fritzking', version: 1, doc }, null, 2);
}

export function deserialize(text: string): Doc {
  const data = JSON.parse(text);
  const doc: Doc = data?.doc ?? data;
  if (!Array.isArray(doc?.parts) || !Array.isArray(doc?.wires)) throw new Error('Not a Fritzking sketch file.');
  doc.parts = doc.parts.filter((p) => PARTS[p.type]);
  for (const p of doc.parts) {
    const def = getDef(p.type);
    for (const pd of def.props) if (p.props[pd.key] === undefined) p.props[pd.key] = pd.default;
  }
  return doc;
}

export function saveLocal(doc: Doc) {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(doc));
  } catch {
    /* storage unavailable */
  }
}

export function loadLocal(): Doc | null {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t ? deserialize(t) : null;
  } catch {
    return null;
  }
}

export function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      f.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}

/** Produce a standalone SVG of the current view, cropped to its contents. */
export function exportSvgString(svg: SVGSVGElement, doc: Doc, view: ViewId): string | null {
  const b = docBounds(doc, view);
  if (!b) return null;
  const m = P * 2;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('.no-export').forEach((n) => n.remove());
  const g = clone.querySelector(':scope > g');
  g?.setAttribute('transform', '');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${b.x - m} ${b.y - m} ${b.w + 2 * m} ${b.h + 2 * m}`);
  clone.setAttribute('width', String(Math.round(b.w + 2 * m)));
  clone.setAttribute('height', String(Math.round(b.h + 2 * m)));
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', String(b.x - m));
  bg.setAttribute('y', String(b.y - m));
  bg.setAttribute('width', String(b.w + 2 * m));
  bg.setAttribute('height', String(b.h + 2 * m));
  bg.setAttribute('fill', view === 'bb' ? '#ffffff' : '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = 'text{font-family:system-ui,-apple-system,Segoe UI,sans-serif} .sch-label{font-size:11px;fill:#1d1f22}';
  clone.insertBefore(style, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

export async function svgToPng(svgText: string, scale = 2): Promise<Blob | null> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('render failed'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.width * scale;
    c.height = img.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Human-readable netlist of the whole sketch (all views). */
export function netlistText(doc: Doc): string {
  const nets = computeNets(doc, 'all');
  const lines: string[] = [`# Fritzking netlist — ${new Date().toISOString()}`, ''];
  let n = 0;
  for (const nodes of nets.groups.values()) {
    const named: string[] = [];
    for (const node of nodes) {
      if (node.includes('@')) continue;
      const [pid, conn] = node.split(':');
      const inst = doc.parts.find((p) => p.id === pid);
      if (!inst || PARTS[inst.type].isBreadboard) continue;
      const cn = getDef(inst.type).connectors.find((c) => c.id === conn)?.name ?? conn;
      named.push(`${inst.label}.${cn}`);
    }
    if (named.length < 2) continue;
    lines.push(`Net ${++n}: ${named.sort().join(', ')}`);
  }
  if (!n) lines.push('(no connections yet)');
  return lines.join('\n') + '\n';
}

export function bomCsv(doc: Doc): string {
  const rows = new Map<string, { labels: string[]; title: string; value: string }>();
  for (const p of doc.parts) {
    const def = getDef(p.type);
    const value = def.valueText?.(p) ?? '';
    const key = `${def.title}|${value}`;
    const r = rows.get(key) ?? { labels: [], title: def.title, value };
    r.labels.push(p.label);
    rows.set(key, r);
  }
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ['Qty,Part,Value,Labels', ...[...rows.values()].map((r) => [r.labels.length, esc(r.title), esc(r.value), esc(r.labels.join(' '))].join(','))].join('\n') + '\n';
}

/* ---------------- Share links ---------------- */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipeBytes(bytes: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(new Uint8Array(bytes));
  void w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Compact, URL-safe encoding of a sketch for the location hash. */
export async function encodeShare(doc: Doc): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify({ parts: doc.parts, wires: doc.wires }));
  if (typeof CompressionStream === 'undefined') return `j.${b64url(raw)}`;
  return `d.${b64url(await pipeBytes(raw, new CompressionStream('deflate-raw')))}`;
}

export async function decodeShare(s: string): Promise<Doc> {
  const [kind, data] = s.split('.');
  let bytes: Uint8Array = unb64url(data);
  if (kind === 'd') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  return deserialize(new TextDecoder().decode(bytes));
}

/* ---------------- Example sketches ---------------- */

type Row = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'tp' | 'tn' | 'bn' | 'bp';
const ROW_Y: Record<Row, number> = { a: 4, b: 5, c: 6, d: 7, e: 8, f: 11, g: 12, h: 13, i: 14, j: 15, tp: 1, tn: 2, bn: 17, bp: 18 };

/** Grid position (in P units) of a hole on a breadboard placed at the origin. */
const hole = (col: number, row: Row): [number, number] => [col + 1, ROW_Y[row]];

const RED = '#cc1414', BLK = '#404040', YEL = '#ffe24d', GRN = '#47cc79', BLU = '#418dd9';

class Sketch {
  doc: Doc = { parts: [], wires: [] };
  private g = (n: number) => n * P;

  part(type: string, label: string, bb: [number, number, number], sch: [number, number, number], props: Record<string, string> = {}): PartInstance {
    const def = getDef(type);
    const all: Record<string, string> = {};
    for (const pd of def.props) all[pd.key] = pd.default;
    const inst: PartInstance = {
      id: uid(),
      type,
      label,
      props: { ...all, ...props },
      bb: { x: this.g(bb[0]), y: this.g(bb[1]), rot: bb[2] },
      sch: { x: this.g(sch[0]), y: this.g(sch[1]), rot: sch[2] },
    };
    this.doc.parts.push(inst);
    return inst;
  }

  /** Place a part so that connector `conn` sits in breadboard hole (col,row). */
  onBoard(type: string, label: string, conn: string, col: number, row: Row, rot: number, sch: [number, number, number], props: Record<string, string> = {}) {
    const [hx, hy] = hole(col, row);
    const pl = placementForPin(type, 'bb', conn, { x: this.g(hx), y: this.g(hy) }, rot);
    return this.part(type, label, [pl.x / P, pl.y / P, rot], sch, props);
  }

  wire(view: ViewId, pts: [number, number][], color: string) {
    const w: Wire = {
      id: uid(),
      view,
      ends: [
        { x: this.g(pts[0][0]), y: this.g(pts[0][1]) },
        { x: this.g(pts[pts.length - 1][0]), y: this.g(pts[pts.length - 1][1]) },
      ],
      bends: pts.slice(1, -1).map(([x, y]) => ({ x: this.g(x), y: this.g(y) })),
      color,
    };
    this.doc.wires.push(w);
    return w;
  }

  /** Breadboard jumper between two holes, optionally via bend points (grid units). */
  jump(a: [number, Row], b: [number, Row], color: string, via: [number, number][] = []) {
    return this.wire('bb', [hole(a[0], a[1]), ...via, hole(b[0], b[1])], color);
  }

  sch(pts: [number, number][]) {
    return this.wire('sch', pts, '#2b2d31');
  }

  /** 9V-style battery below the board, wired to the bottom rails. */
  battery(voltage: string, sch: [number, number, number]) {
    this.part('battery', 'VCC1', [-4, 21, 0], sch, { voltage });
    this.wire('bb', [[-4, 21], [-4, 23], [3, 23], hole(2, 'bp')], RED);
    this.wire('bb', [[-3, 21], [-3, 22], [2, 22], hole(1, 'bn')], BLK);
  }

  done(): Doc {
    reattach(this.doc);
    return this.doc;
  }
}

export interface Example {
  id: string;
  title: string;
  blurb: string;
  build: () => Doc;
}

export const EXAMPLES: Example[] = [
  {
    id: 'button-led',
    title: 'Button & LED',
    blurb: 'Press the button to light an LED through a 470Ω resistor.',
    build: () => {
      const s = new Sketch();
      s.part('breadboard-half', 'BB1', [0, 0, 0], [0, 0, 0]);
      s.battery('9V', [0, 0, 90]);
      s.onBoard('pushbutton', 'S1', 'a1', 5, 'e', 0, [4, -6, 0]);
      s.onBoard('led', 'LED1', 'a', 7, 'c', 0, [8, -2, 90], { color: 'Red' });
      s.onBoard('resistor', 'R1', 'p0', 8, 'e', 90, [8, 4, 90], { resistance: '470Ω' });
      s.jump([5, 'bp'], [5, 'j'], RED);
      s.jump([8, 'j'], [8, 'bn'], BLK);
      return s.done();
    },
  },
  {
    id: 'dimmer',
    title: 'Dimmer',
    blurb: 'A potentiometer sets the LED brightness. Drag the Position slider while simulating.',
    build: () => {
      const s = new Sketch();
      s.part('breadboard-half', 'BB1', [0, 0, 0], [0, 0, 0]);
      s.battery('9V', [0, 4, 90]);
      s.onBoard('potentiometer', 'R1', 'p1', 10, 'f', 0, [4, 0, 0], { resistance: '10kΩ', position: '25' });
      s.onBoard('resistor', 'R2', 'p0', 11, 'i', 0, [10, 4, 90], { resistance: '220Ω' });
      s.onBoard('led', 'LED1', 'a', 15, 'g', 0, [10, 9, 90], { color: 'Green' });
      s.jump([10, 'j'], [10, 'bp'], RED);
      s.jump([12, 'j'], [13, 'bn'], BLK);
      s.jump([16, 'j'], [16, 'bn'], BLK);
      s.sch([[2, 2], [2, 0], [4, 0]]);
      s.sch([[6, 2], [12, 2]]);
      s.sch([[12, 6], [12, 7]]);
      s.sch([[12, 11], [12, 13], [8, 13]]);
      s.sch([[8, 13], [2, 13], [2, 6]]);
      s.sch([[8, 0], [8, 13]]);
      return s.done();
    },
  },
  {
    id: 'arduino-motor',
    title: 'Arduino motor switch',
    blurb: 'Pin 13 drives an NPN transistor that switches a motor. The simulated sketch blinks once a second.',
    build: () => {
      const s = new Sketch();
      s.part('breadboard-half', 'BB1', [0, 0, 0], [0, 0, 0]);
      s.part('arduino-uno', 'Arduino1', [0, 24, 0], [0, 0, 0], { high: '13', sketch: 'Blink (1 Hz)' });
      s.onBoard('npn', 'Q1', 'B', 5, 'f', 0, [16, 13, 0]);
      s.onBoard('resistor', 'R1', 'p0', 1, 'i', 0, [12, 13, 0], { resistance: '1kΩ' });
      s.onBoard('motor', 'M1', 'p0', 11, 'h', 0, [16, 7, 270]);
      s.wire('bb', [[12, 25], [12, 23], [2, 23], hole(1, 'j')], YEL);
      s.wire('bb', [[11, 25], [11, 21], [9, 21], hole(8, 'bn')], BLK);
      s.jump([4, 'j'], [4, 'bn'], BLK);
      s.jump([6, 'j'], [11, 'j'], BLU);
      s.jump([13, 'j'], [13, 'bp'], RED);
      s.wire('bb', [[13, 44], [13, 46], [29, 46], [29, 21], [15, 21], hole(14, 'bp')], RED);
      s.sch([[10, 13], [12, 13]]);
      s.sch([[18, 9], [18, 11]]);
      s.sch([[0, 1], [-2, 1], [-2, -3], [18, -3], [18, 5]]);
      s.sch([[18, 15], [18, 17], [5, 17]]);
      return s.done();
    },
  },
  {
    id: 'night-light',
    title: 'Night light',
    blurb: 'A photocell and 10kΩ divider bias a transistor: the LED turns on when it gets dark. Drag the Light level slider.',
    build: () => {
      const s = new Sketch();
      s.part('breadboard-half', 'BB1', [0, 0, 0], [0, 0, 0]);
      s.battery('6V', [0, 3, 90]);
      s.onBoard('photocell', 'R1', 'p0', 4, 'a', 0, [6, 7, 270], { light: '35' });
      s.onBoard('resistor', 'R2', 'p0', 5, 'c', 0, [6, 1, 270], { resistance: '10kΩ' });
      s.onBoard('npn', 'Q1', 'B', 7, 'f', 0, [12, 4, 0]);
      s.onBoard('led', 'LED1', 'a', 12, 'g', 0, [12, -3, 90], { color: 'Yellow' });
      s.onBoard('resistor', 'R3', 'p0', 12, 'i', 0, [12, -9, 270], { resistance: '220Ω' });
      // rail bridges on the right-hand end
      s.jump([28, 'tp'], [28, 'bp'], RED);
      s.jump([29, 'tn'], [29, 'bn'], BLK);
      s.jump([4, 'e'], [2, 'tn'], BLK, [[3, 8]]);
      s.jump([9, 'a'], [9, 'tp'], RED);
      s.jump([5, 'e'], [7, 'j'], GRN);
      s.jump([6, 'j'], [7, 'bn'], BLK);
      s.jump([8, 'j'], [13, 'j'], BLU);
      s.jump([16, 'j'], [16, 'bp'], RED);
      s.sch([[2, 1], [2, -13], [8, -13]]);
      s.sch([[8, -13], [14, -13], [14, -11]]);
      s.sch([[8, -1], [8, -13]]);
      s.sch([[2, 5], [2, 11], [8, 11]]);
      s.sch([[8, 9], [8, 11]]);
      s.sch([[8, 11], [14, 11], [14, 6]]);
      s.sch([[8, 3], [8, 5]]);
      s.sch([[8, 5], [10, 5], [10, 4], [12, 4]]);
      s.sch([[14, -1], [14, 2]]);
      s.sch([[14, -7], [14, -5]]);
      return s.done();
    },
  },
];

export const exampleDoc = () => EXAMPLES[0].build();

export function connectionsOf(doc: Doc, inst: PartInstance) {
  const nets = computeNets(doc, 'all');
  return getDef(inst.type).connectors.map((c) => {
    const root = nets.find(nodeKey(inst.id, c.id));
    const to: string[] = [];
    for (const n of nets.groups.get(root) ?? []) {
      if (n.includes('@')) continue;
      const [pid, conn] = n.split(':');
      if (pid === inst.id) continue;
      const o = doc.parts.find((p) => p.id === pid);
      if (!o || PARTS[o.type].isBreadboard) continue;
      to.push(`${o.label}.${getDef(o.type).connectors.find((x) => x.id === conn)?.name ?? conn}`);
    }
    return { conn: c, root, to };
  });
}
