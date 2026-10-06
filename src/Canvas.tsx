import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Doc, PartInstance, PartSimState, Pt, ViewId, Wire } from './types';
import { P } from './types';
import type { Nets, PinPos, Rect, Routing } from './model';
import {
  geom, nodeKey, partBounds, produce, reattach, rectsOverlap, snap, syncAttachments, uid, wireKey, wireLength,
} from './model';
import { PARTS, getDef } from './parts';
import type { SimResult } from './sim';
import { formatValue } from './parts/util';

export interface Viewport {
  tx: number;
  ty: number;
  k: number;
}

export interface Derived {
  full: Nets;
  local: Nets;
  routing: Routing;
  pins: PinPos[];
}

interface Props {
  doc: Doc;
  view: ViewId;
  derived: Derived;
  selection: Set<string>;
  setSelection: (s: Set<string>) => void;
  onLive: (d: Doc) => void;
  onCommit: (d: Doc, before: Doc) => void;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
  onDropPart: (type: string, at: Pt) => void;
  sim: SimResult | null;
  simulating: boolean;
  wireColor: string;
  onCursor: (p: Pt | null) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vp: Viewport }
  | { kind: 'move'; start: Pt; before: Doc; parts: Set<string>; wires: Set<string>; moved: boolean; clickId?: string; shift: boolean }
  | { kind: 'wire'; wire: string; end: 0 | 1; before: Doc; created: boolean }
  | { kind: 'bend'; wire: string; idx: number; before: Doc; moved: boolean }
  | { kind: 'segment'; wire: string; seg: number; start: Pt; before: Doc }
  | { kind: 'marquee'; start: Pt; cur: Pt; additive: boolean; base: Set<string> }
  | { kind: 'press'; part: string; key: string; value: string; before: Doc };

const BB_BG = '#e4e7e3';
const SCH_BG = '#fbfbf8';

/* ---------- Part rendering (memoised: breadboards are heavy) ---------- */

interface PartViewProps {
  inst: PartInstance;
  view: ViewId;
  sim?: PartSimState;
  simulating: boolean;
}

const PartView = memo(
  function PartView({ inst, view, sim, simulating }: PartViewProps) {
    const def = getDef(inst.type);
    const g = geom(def, view)!;
    const pl = inst[view];
    return (
      <g
        data-part={inst.id}
        transform={`translate(${pl.x} ${pl.y}) rotate(${pl.rot} ${g.pivot.x} ${g.pivot.y})`}
        className={def.simToggle && simulating ? 'part clickable' : 'part'}
      >
        {g.render(inst, { view, sim, simulating })}
      </g>
    );
  },
  (a, b) =>
    a.view === b.view &&
    a.simulating === b.simulating &&
    a.inst.type === b.inst.type &&
    a.inst.label === b.inst.label &&
    a.inst[a.view].x === b.inst[b.view].x &&
    a.inst[a.view].y === b.inst[b.view].y &&
    a.inst[a.view].rot === b.inst[b.view].rot &&
    JSON.stringify(a.inst.props) === JSON.stringify(b.inst.props) &&
    JSON.stringify(a.sim) === JSON.stringify(b.sim),
);

function wirePoints(w: Wire): Pt[] {
  return [w.ends[0], ...w.bends, w.ends[1]];
}

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(c * 0.62);
  return `#${((f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}

export default function Canvas(props: Props) {
  const { doc, view, derived, selection, viewport, sim, simulating } = props;
  const svgRef = props.svgRef;
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [hover, setHover] = useState<{ pin: PinPos; sx: number; sy: number } | null>(null);
  const [space, setSpace] = useState(false);
  const latest = useRef(props);
  latest.current = props;

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgRef]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        setSpace(true);
        if (e.target === document.body) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Wheel: scroll pans, ctrl/cmd (or pinch) zooms around the cursor.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = latest.current.viewport;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const k = Math.min(8, Math.max(0.1, vp.k * Math.exp(-e.deltaY * 0.01)));
        latest.current.setViewport({ k, tx: mx - ((mx - vp.tx) / vp.k) * k, ty: my - ((my - vp.ty) / vp.k) * k });
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        latest.current.setViewport({ ...vp, tx: vp.tx - dx, ty: vp.ty - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef]);

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const vp = latest.current.viewport;
    return { x: (e.clientX - r.left - vp.tx) / vp.k, y: (e.clientY - r.top - vp.ty) / vp.k };
  };

  const pinRadius = () => Math.min(P * 0.45, Math.max(P * 0.3, 6 / latest.current.viewport.k));

  const nearestPin = (w: Pt, r: number, exclude?: (p: PinPos) => boolean): PinPos | null => {
    let best: PinPos | null = null;
    let bd = r * r;
    for (const p of latest.current.derived.pins) {
      if (exclude?.(p)) continue;
      const d = (p.x - w.x) ** 2 + (p.y - w.y) ** 2;
      if (d <= bd) {
        // prefer part pins over breadboard holes when equally close
        if (best && d === bd && p.breadboard) continue;
        bd = d;
        best = p;
      }
    }
    return best;
  };

  /** Snap target for a dragged wire end: connectors, then other wire ends, then the grid. */
  const snapWireEnd = (w: Pt, wireId: string): Pt => {
    const r = Math.max(pinRadius(), 10 / latest.current.viewport.k);
    const pin = nearestPin(w, r);
    if (pin) return { x: pin.x, y: pin.y };
    for (const other of latest.current.doc.wires) {
      if (other.id === wireId || other.view !== latest.current.view) continue;
      for (const e of other.ends) if ((e.x - w.x) ** 2 + (e.y - w.y) ** 2 < r * r) return { x: e.x, y: e.y };
    }
    return { x: snap(w.x, P / 2), y: snap(w.y, P / 2) };
  };

  /* ---------------- pointer handling ---------------- */

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const L = latest.current;
    const target = e.target as Element;
    const w = toWorld(e);
    svgRef.current!.setPointerCapture(e.pointerId);

    if (e.button === 1 || (e.button === 0 && space)) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vp: L.viewport });
      return;
    }
    if (e.button !== 0) return;

    const endEl = target.closest('[data-wire-end]');
    const bendEl = target.closest('[data-bend]');
    const segEl = target.closest('[data-seg]');
    const partEl = target.closest('[data-part]');

    // Simulator interaction: press buttons / flip switches.
    if (L.simulating && partEl) {
      const inst = L.doc.parts.find((p) => p.id === partEl.getAttribute('data-part'));
      const st = inst && getDef(inst.type).simToggle;
      if (inst && st) {
        const before = L.doc;
        const next = st.momentary ? st.values[1] : inst.props[st.key] === st.values[0] ? st.values[1] : st.values[0];
        L.onLive(produce(before, (d) => (d.parts.find((p) => p.id === inst.id)!.props[st.key] = next)));
        setDrag({ kind: 'press', part: inst.id, key: st.key, value: st.momentary ? st.values[0] : next, before });
        return;
      }
    }

    if (endEl && !e.altKey) {
      const [id, i] = endEl.getAttribute('data-wire-end')!.split(':');
      L.setSelection(new Set([id]));
      const before = L.doc;
      L.onLive(produce(before, (d) => delete d.wires.find((x) => x.id === id)!.ends[Number(i) as 0 | 1].attach));
      setDrag({ kind: 'wire', wire: id, end: Number(i) as 0 | 1, before, created: false });
      return;
    }
    if (bendEl) {
      const [id, i] = bendEl.getAttribute('data-bend')!.split(':');
      L.setSelection(new Set([id]));
      setDrag({ kind: 'bend', wire: id, idx: Number(i), before: L.doc, moved: false });
      return;
    }

    const pin = endEl ? null : nearestPin(w, pinRadius());
    const startFrom = endEl && e.altKey ? (() => {
      const [id, i] = endEl.getAttribute('data-wire-end')!.split(':');
      return L.doc.wires.find((x) => x.id === id)!.ends[Number(i)];
    })() : pin;
    if (startFrom) {
      const before = L.doc;
      const wire: Wire = {
        id: uid(),
        view: L.view,
        ends: [
          { x: startFrom.x, y: startFrom.y, ...(pin ? { attach: { part: pin.part, conn: pin.conn } } : {}) },
          { x: startFrom.x, y: startFrom.y },
        ],
        bends: [],
        color: L.view === 'bb' ? L.wireColor : '#2b2d31',
      };
      L.onLive(produce(before, (d) => void d.wires.push(wire)));
      L.setSelection(new Set([wire.id]));
      setDrag({ kind: 'wire', wire: wire.id, end: 1, before, created: true });
      return;
    }

    if (segEl) {
      const id = segEl.getAttribute('data-wire')!;
      const seg = Number(segEl.getAttribute('data-seg'));
      if (e.shiftKey) {
        const s = new Set(L.selection);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        L.setSelection(s);
        return;
      }
      L.setSelection(new Set([id]));
      setDrag({ kind: 'segment', wire: id, seg, start: w, before: L.doc });
      return;
    }

    if (partEl) {
      const id = partEl.getAttribute('data-part')!;
      let sel = new Set(L.selection);
      if (e.shiftKey) {
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
      } else if (!sel.has(id)) sel = new Set([id]);
      L.setSelection(sel);
      const parts = new Set(L.doc.parts.filter((p) => sel.has(p.id)).map((p) => p.id));
      const wires = new Set(L.doc.wires.filter((x) => sel.has(x.id) && x.view === L.view).map((x) => x.id));
      // Moving a breadboard carries the parts plugged into it.
      if (L.view === 'bb') {
        for (const bbId of [...parts]) {
          const bb = L.doc.parts.find((p) => p.id === bbId)!;
          if (!getDef(bb.type).isBreadboard) continue;
          const holes = new Set(L.derived.pins.filter((p) => p.part === bbId).map((p) => `${p.x},${p.y}`));
          for (const p of L.derived.pins) if (!p.breadboard && holes.has(`${p.x},${p.y}`)) parts.add(p.part);
        }
      }
      setDrag({ kind: 'move', start: w, before: L.doc, parts, wires, moved: false, clickId: id, shift: e.shiftKey });
      return;
    }

    const base = e.shiftKey ? new Set(L.selection) : new Set<string>();
    if (!e.shiftKey) L.setSelection(base);
    setDrag({ kind: 'marquee', start: w, cur: w, additive: e.shiftKey, base });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const L = latest.current;
    const w = toWorld(e);
    L.onCursor(w);
    const d = dragRef.current;
    if (!d) {
      const pin = nearestPin(w, pinRadius());
      const r = svgRef.current!.getBoundingClientRect();
      setHover(pin ? { pin, sx: e.clientX - r.left, sy: e.clientY - r.top } : null);
      return;
    }
    if (hover) setHover(null);
    switch (d.kind) {
      case 'pan':
        L.setViewport({ ...d.vp, tx: d.vp.tx + e.clientX - d.sx, ty: d.vp.ty + e.clientY - d.sy });
        break;
      case 'move': {
        const dx = snap(w.x - d.start.x), dy = snap(w.y - d.start.y);
        if (!d.moved && dx === 0 && dy === 0) return;
        if (!d.moved) setDrag({ ...d, moved: true });
        L.onLive(
          produce(d.before, (doc) => {
            for (const p of doc.parts)
              if (d.parts.has(p.id)) {
                p[L.view].x += dx;
                p[L.view].y += dy;
              }
            for (const wi of doc.wires) {
              if (wi.view !== L.view) continue;
              const sel = d.wires.has(wi.id);
              const follows = wi.ends.map((en) => (en.attach ? d.parts.has(en.attach.part) : sel));
              for (const en of wi.ends)
                if (!en.attach && sel) {
                  en.x += dx;
                  en.y += dy;
                }
              if (sel || (follows[0] && follows[1]))
                for (const b of wi.bends) {
                  b.x += dx;
                  b.y += dy;
                }
            }
            syncAttachments(doc);
          }),
        );
        break;
      }
      case 'wire': {
        const p = snapWireEnd(w, d.wire);
        L.onLive(
          produce(L.doc, (doc) => {
            const wi = doc.wires.find((x) => x.id === d.wire)!;
            wi.ends[d.end].x = p.x;
            wi.ends[d.end].y = p.y;
          }),
        );
        break;
      }
      case 'bend': {
        if (!d.moved) setDrag({ ...d, moved: true });
        const p = { x: snap(w.x, P / 4), y: snap(w.y, P / 4) };
        L.onLive(produce(L.doc, (doc) => void (doc.wires.find((x) => x.id === d.wire)!.bends[d.idx] = p)));
        break;
      }
      case 'segment': {
        if (Math.hypot(w.x - d.start.x, w.y - d.start.y) * L.viewport.k < 4) return;
        const p = { x: snap(w.x, P / 4), y: snap(w.y, P / 4) };
        L.onLive(produce(d.before, (doc) => void doc.wires.find((x) => x.id === d.wire)!.bends.splice(d.seg, 0, p)));
        setDrag({ kind: 'bend', wire: d.wire, idx: d.seg, before: d.before, moved: true });
        break;
      }
      case 'marquee': {
        const r = rectFrom(d.start, w);
        const s = new Set(d.base);
        for (const p of L.doc.parts) {
          const b = partBounds(p, L.view);
          if (b && rectsOverlap(b, r)) s.add(p.id);
        }
        for (const wi of L.doc.wires)
          if (wi.view === L.view && wirePoints(wi).some((q) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h)) s.add(wi.id);
        L.setSelection(s);
        setDrag({ ...d, cur: w });
        break;
      }
    }
  };

  const onPointerUp = () => {
    const L = latest.current;
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    switch (d.kind) {
      case 'move':
        if (d.moved) L.onCommit(produce(L.doc, reattach), d.before);
        else if (!d.shift && d.clickId) L.setSelection(new Set([d.clickId]));
        break;
      case 'wire': {
        const wi = L.doc.wires.find((x) => x.id === d.wire);
        if (wi && d.created && wireLength(wi) < 2) {
          L.onLive(d.before);
          L.setSelection(new Set());
        } else L.onCommit(produce(L.doc, reattach), d.before);
        break;
      }
      case 'bend':
        if (d.moved) L.onCommit(L.doc, d.before);
        break;
      case 'press':
        L.onCommit(
          produce(L.doc, (doc) => {
            const p = doc.parts.find((x) => x.id === d.part);
            if (p) p.props[d.key] = d.value;
          }),
          d.before,
        );
        break;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const L = latest.current;
    // pointer capture retargets dblclick to the <svg>, so hit-test the real element under the cursor
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    const bendEl = target.closest('[data-bend]');
    if (bendEl) {
      const [id, i] = bendEl.getAttribute('data-bend')!.split(':');
      L.onCommit(produce(L.doc, (doc) => void doc.wires.find((x) => x.id === id)!.bends.splice(Number(i), 1)), L.doc);
      return;
    }
    const ratEl = target.closest('[data-rat]');
    if (ratEl) {
      const line = L.derived.routing.lines[Number(ratEl.getAttribute('data-rat'))];
      if (!line) return;
      const wire: Wire = {
        id: uid(),
        view: L.view,
        ends: [
          { x: line.x1, y: line.y1, attach: { part: line.a.part, conn: line.a.conn } },
          { x: line.x2, y: line.y2, attach: { part: line.b.part, conn: line.b.conn } },
        ],
        bends: [],
        color: L.view === 'bb' ? L.wireColor : '#2b2d31',
      };
      L.onCommit(produce(L.doc, (doc) => void doc.wires.push(wire)), L.doc);
      L.setSelection(new Set([wire.id]));
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-fritz-part')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData('application/x-fritz-part');
    if (!type) return;
    e.preventDefault();
    latest.current.onDropPart(type, toWorld(e));
  };

  /* ---------------- derived render data ---------------- */

  const { parts: simParts, netVoltage } = sim ?? { parts: undefined, netVoltage: undefined };

  // For each local net: does it touch more than one part (or a wire)?
  const netInfo = useMemo(() => {
    const parts = new Map<string, Set<string>>();
    const nonBB = new Set<string>();
    const bbIds = new Set(doc.parts.filter((p) => PARTS[p.type]?.isBreadboard).map((p) => p.id));
    for (const [root, nodes] of derived.local.groups) {
      const s = new Set<string>();
      for (const n of nodes) {
        const owner = n.includes('@') ? `wire:${n.split('@')[0]}` : n.split(':')[0];
        s.add(owner);
        if (!bbIds.has(owner)) nonBB.add(root);
      }
      parts.set(root, s);
    }
    return { parts, nonBB };
  }, [derived.local, doc.parts]);

  const isConnected = (node: string, owner: string) => {
    const s = netInfo.parts.get(derived.local.find(node));
    return !!s && [...s].some((o) => o !== owner);
  };

  const hoverNet = useMemo(() => {
    if (!hover) return null;
    const root = derived.local.find(hover.pin.node);
    return new Set(derived.local.groups.get(root) ?? []);
  }, [hover, derived.local]);

  const parts = doc.parts.filter((p) => !!geom(getDef(p.type), view));
  const ordered = [...parts.filter((p) => PARTS[p.type].isBreadboard), ...parts.filter((p) => !PARTS[p.type].isBreadboard)];
  const wires = doc.wires.filter((w) => w.view === view);
  const k = viewport.k;
  const visible: Rect = { x: -viewport.tx / k, y: -viewport.ty / k, w: size.w / k, h: size.h / k };

  const cursor = drag?.kind === 'pan' ? 'grabbing' : space ? 'grab' : hover ? 'crosshair' : 'default';

  return (
    <div className="canvas-wrap" onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className={`canvas view-${view}`}
        style={{ cursor, background: view === 'bb' ? BB_BG : SCH_BG }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHover(null);
          props.onCursor(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id={`grid-${view}`} width={P} height={P} patternUnits="userSpaceOnUse">
            {view === 'bb' ? (
              <circle cx={0} cy={0} r={0.9} fill="#c7cbc6" />
            ) : (
              <path d={`M${P} 0 H0 V${P}`} fill="none" stroke="#e6e9ee" strokeWidth={0.6} />
            )}
          </pattern>
          <pattern id={`grid5-${view}`} width={P * 5} height={P * 5} patternUnits="userSpaceOnUse">
            {view === 'sch' && <path d={`M${P * 5} 0 H0 V${P * 5}`} fill="none" stroke="#d3d8e0" strokeWidth={0.8} />}
          </pattern>
        </defs>
        <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${k})`}>
          <g className="no-export">
            <rect x={visible.x} y={visible.y} width={visible.w} height={visible.h} fill={`url(#grid-${view})`} />
            <rect x={visible.x} y={visible.y} width={visible.w} height={visible.h} fill={`url(#grid5-${view})`} />
          </g>

          {ordered.map((inst) => (
            <PartView key={inst.id} inst={inst} view={view} sim={simParts?.get(inst.id)} simulating={simulating} />
          ))}

          {/* breadboard strip highlights */}
          {view === 'bb' && (
            <g className="no-export" pointerEvents="none">
              {derived.pins.map((p) =>
                p.breadboard && netInfo.nonBB.has(derived.local.find(p.node)) ? (
                  <rect key={p.node} x={p.x - 4.5} y={p.y - 4.5} width={9} height={9} rx={1.5} fill="#38b54a" opacity={0.75} />
                ) : null,
              )}
            </g>
          )}

          {/* schematic labels */}
          {view === 'sch' &&
            parts.map((inst) => {
              const b = partBounds(inst, 'sch')!;
              const def = getDef(inst.type);
              const val = def.valueText?.(inst);
              const icLike = inst.type === 'ic-555' || inst.type === 'arduino-uno';
              const rot = inst.sch.rot % 180 !== 0;
              const x = icLike ? b.x + b.w : rot ? b.x + b.w + 4 : b.x + b.w / 2;
              const y = icLike ? b.y + b.h + 14 : rot ? b.y + b.h / 2 - 4 : b.y - 6;
              return (
                <text key={inst.id} x={x} y={y} className="sch-label" textAnchor={icLike ? 'end' : rot ? 'start' : 'middle'} pointerEvents="none">
                  <tspan fontWeight={600}>{inst.label}</tspan>
                  {val && !icLike && <tspan dx={4} fill="#5a6070">{val}</tspan>}
                </text>
              );
            })}

          {/* wires */}
          {wires.map((w) => {
            const pts = wirePoints(w);
            const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
            const sel = selection.has(w.id);
            return (
              <g key={w.id} className="wire">
                {sel && <polyline points={ptsStr} fill="none" stroke="#3b82f6" strokeWidth={view === 'bb' ? 11 : 7} strokeLinecap="round" strokeLinejoin="round" opacity={0.45} />}
                {view === 'bb' ? (
                  <>
                    <polyline points={ptsStr} fill="none" stroke={darken(w.color)} strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={ptsStr} fill="none" stroke={w.color} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={ptsStr} fill="none" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.3} transform="translate(-0.8 -0.8)" />
                  </>
                ) : (
                  <polyline points={ptsStr} fill="none" stroke={w.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                )}
                {pts.slice(1).map((p, i) => (
                  <line
                    key={i}
                    data-wire={w.id}
                    data-seg={i}
                    x1={pts[i].x}
                    y1={pts[i].y}
                    x2={p.x}
                    y2={p.y}
                    stroke="transparent"
                    strokeWidth={Math.max(10, 10 / k)}
                    className="wire-hit no-export"
                  />
                ))}
              </g>
            );
          })}

          {/* schematic junction dots (3+ connections at a point) */}
          {view === 'sch' && <Junctions wires={wires} pins={derived.pins} />}

          {/* ratsnest */}
          <g className="no-export">
            {derived.routing.lines.map((l, i) => (
              <g key={i} data-rat={i} className="rat">
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="transparent" strokeWidth={8} />
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={view === 'bb' ? '#d9459a' : '#7c5cff'} strokeWidth={1.4} strokeDasharray="5 4" />
              </g>
            ))}
          </g>

          {/* connector status: red = unconnected, green = connected */}
          <g className="no-export" pointerEvents="none">
            {derived.pins.map((p) => {
              if (p.breadboard) return null;
              const ok = isConnected(p.node, p.part);
              return <circle key={p.node} cx={p.x} cy={p.y} r={view === 'bb' ? 2.6 : 2.2} fill={ok ? '#2fae47' : '#e0403a'} opacity={ok ? 0.85 : 0.9} />;
            })}
          </g>

          {/* wire ends + bend handles */}
          <g className="no-export">
            {wires.map((w) => {
              const sel = selection.has(w.id);
              return (
                <g key={w.id}>
                  {w.ends.map((e, i) => {
                    const ok = isConnected(wireKey(w.id, i), `wire:${w.id}`);
                    return (
                      <circle
                        key={i}
                        data-wire-end={`${w.id}:${i}`}
                        cx={e.x}
                        cy={e.y}
                        r={view === 'bb' ? 3.6 : 3}
                        fill={ok ? '#2fae47' : '#e0403a'}
                        stroke={sel ? '#1d4ed8' : '#00000055'}
                        strokeWidth={sel ? 1.5 : 0.8}
                        className="wire-end"
                      />
                    );
                  })}
                  {sel &&
                    w.bends.map((b, i) => (
                      <circle key={`b${i}`} data-bend={`${w.id}:${i}`} cx={b.x} cy={b.y} r={4} fill="#fff" stroke="#1d4ed8" strokeWidth={1.5} className="bend" />
                    ))}
                </g>
              );
            })}
          </g>

          {/* hover highlight of the whole net */}
          {hover && hoverNet && (
            <g className="no-export" pointerEvents="none">
              {derived.pins
                .filter((p) => hoverNet.has(p.node))
                .map((p) => (
                  <rect key={p.node} x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2} fill="none" stroke="#2f7cf6" strokeWidth={1.6} />
                ))}
              <circle cx={hover.pin.x} cy={hover.pin.y} r={7} fill="#2f7cf633" stroke="#2f7cf6" strokeWidth={2} />
            </g>
          )}

          {/* selection outlines */}
          <g className="no-export" pointerEvents="none">
            {parts
              .filter((p) => selection.has(p.id))
              .map((p) => {
                const b = partBounds(p, view)!;
                return <rect key={p.id} x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={4} fill="#3b82f60f" stroke="#3b82f6" strokeWidth={1.4 / k} strokeDasharray={`${5 / k} ${3 / k}`} />;
              })}
          </g>

          {drag?.kind === 'marquee' && (() => {
            const r = rectFrom(drag.start, drag.cur);
            return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#3b82f61a" stroke="#3b82f6" strokeWidth={1 / k} strokeDasharray={`${4 / k} ${3 / k}`} />;
          })()}
        </g>
      </svg>

      {hover && (
        <div className="tooltip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
          <PinTooltip pin={hover.pin} doc={doc} derived={derived} netVoltage={netVoltage} simulating={simulating} />
        </div>
      )}
      {!doc.parts.length && (
        <div className="empty-hint">
          <div className="empty-title">Drag parts here from the Parts bin</div>
          <div>Drag from any pin or breadboard hole to draw a wire · Scroll to pan · ⌘/Ctrl + scroll to zoom</div>
        </div>
      )}
    </div>
  );
}

function rectFrom(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function Junctions({ wires, pins }: { wires: Wire[]; pins: PinPos[] }) {
  const count = new Map<string, { x: number; y: number; n: number }>();
  const bump = (x: number, y: number) => {
    const key = `${Math.round(x)},${Math.round(y)}`;
    const c = count.get(key);
    if (c) c.n++;
    else count.set(key, { x, y, n: 1 });
  };
  for (const w of wires) for (const e of w.ends) bump(e.x, e.y);
  for (const p of pins) {
    const c = count.get(`${Math.round(p.x)},${Math.round(p.y)}`);
    if (c) c.n++;
  }
  return (
    <g pointerEvents="none">
      {[...count.values()].filter((c) => c.n >= 3).map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={3.5} fill="#2b2d31" />)}
    </g>
  );
}

function PinTooltip({ pin, doc, derived, netVoltage, simulating }: { pin: PinPos; doc: Doc; derived: Derived; netVoltage?: Map<string, number>; simulating: boolean }) {
  const inst = doc.parts.find((p) => p.id === pin.part);
  if (!inst) return null;
  const def = getDef(inst.type);
  const name = def.connectors.find((c) => c.id === pin.conn)?.name ?? pin.conn;
  const others = new Set<string>();
  for (const n of derived.full.groups.get(derived.full.find(nodeKey(inst.id, pin.conn))) ?? []) {
    if (n.includes('@')) continue;
    const [pid, conn] = n.split(':');
    if (pid === inst.id) continue;
    const o = doc.parts.find((p) => p.id === pid);
    if (o && !PARTS[o.type].isBreadboard) {
      const cn = getDef(o.type).connectors.find((c) => c.id === conn)?.name ?? conn;
      others.add(`${o.label} · ${cn}`);
    }
  }
  const v = netVoltage?.get(derived.full.find(nodeKey(inst.id, pin.conn)));
  return (
    <>
      <div className="tt-title">
        {def.isBreadboard ? 'Breadboard' : inst.label} · <b>{name}</b>
      </div>
      {simulating && v !== undefined && <div className="tt-volt">{formatValue(v, 'V')}</div>}
      {others.size > 0 ? (
        <div className="tt-list">
          {[...others].slice(0, 8).map((o) => (
            <div key={o}>↔ {o}</div>
          ))}
          {others.size > 8 && <div>… {others.size - 8} more</div>}
        </div>
      ) : (
        <div className="tt-muted">Not connected</div>
      )}
    </>
  );
}
