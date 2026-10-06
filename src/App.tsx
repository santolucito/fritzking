import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Doc, PartInstance, Pt, ViewId, Wire } from './types';
import { P } from './types';
import Canvas from './Canvas';
import type { Derived, Viewport } from './Canvas';
import PartsBin from './PartsBin';
import Inspector, { WIRE_COLORS } from './Inspector';
import {
  computeNets, createPart, docBounds, findFreeSpot, geom, nextLabel, pinPositions, produce, ratsnest, reattach, syncAttachments, uid,
} from './model';
import { getDef } from './parts';
import { simulate } from './sim';
import { bomCsv, deserialize, download, exampleDoc, exportSvgString, loadLocal, netlistText, pickFile, saveLocal, serialize, svgToPng } from './io';
import { Icon } from './icons';

interface History {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  mergeKey?: string;
}

const EMPTY: Doc = { parts: [], wires: [] };
const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'bb', label: 'Breadboard' },
  { id: 'sch', label: 'Schematic' },
];

export default function App() {
  const [hist, setHist] = useState<History>(() => ({ doc: loadLocal() ?? exampleDoc(), past: [], future: [] }));
  const doc = hist.doc;
  const [view, setView] = useState<ViewId>('bb');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [viewports, setViewports] = useState<Record<ViewId, Viewport>>({ bb: { tx: 0, ty: 0, k: 1 }, sch: { tx: 0, ty: 0, k: 1 } });
  const [simulating, setSimulating] = useState(false);
  const [wireColor, setWireColor] = useState(WIRE_COLORS[0][0]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fitted = useRef<Record<ViewId, boolean>>({ bb: false, sch: false });

  /* ---------------- history ---------------- */

  const live = useCallback((d: Doc) => setHist((h) => ({ ...h, doc: d })), []);
  const commit = useCallback(
    (d: Doc, before?: Doc, mergeKey?: string) =>
      setHist((h) => {
        if (mergeKey && h.mergeKey === mergeKey) return { ...h, doc: d };
        return { doc: d, past: [...h.past.slice(-199), before ?? h.doc], future: [], mergeKey };
      }),
    [],
  );
  const undo = useCallback(
    () => setHist((h) => (h.past.length ? { doc: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.doc, ...h.future] } : h)),
    [],
  );
  const redo = useCallback(
    () => setHist((h) => (h.future.length ? { doc: h.future[0], past: [...h.past, h.doc], future: h.future.slice(1) } : h)),
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => saveLocal(doc), 400);
    return () => clearTimeout(t);
  }, [doc]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  };

  /* ---------------- derived ---------------- */

  const full = useMemo(() => computeNets(doc, 'all'), [doc]);
  const derived: Derived = useMemo(() => {
    const local = computeNets(doc, view);
    return { full, local, pins: pinPositions(doc, view), routing: ratsnest(doc, view, full, local) };
  }, [doc, view, full]);
  const sim = useMemo(() => (simulating ? simulate(doc, full) : null), [simulating, doc, full]);

  /* ---------------- viewport ---------------- */

  const viewport = viewports[view];
  const setViewport = useCallback((v: Viewport) => setViewports((vs) => ({ ...vs, [view]: v })), [view]);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const b = docBounds(doc, view);
    const W = el.clientWidth, H = el.clientHeight;
    if (!b) {
      setViewport({ tx: W / 2, ty: H / 2, k: 1 });
      return;
    }
    const m = 60;
    const k = Math.min(1.6, Math.max(0.15, Math.min((W - 2 * m) / Math.max(b.w, 1), (H - 2 * m) / Math.max(b.h, 1))));
    setViewport({ k, tx: W / 2 - (b.x + b.w / 2) * k, ty: H / 2 - (b.y + b.h / 2) * k });
  }, [doc, view, setViewport]);

  useEffect(() => {
    if (fitted.current[view]) return;
    fitted.current[view] = true;
    requestAnimationFrame(fit);
  }, [view, fit]);

  const zoomBy = (f: number) => {
    const el = svgRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    const k = Math.min(8, Math.max(0.1, viewport.k * f));
    setViewport({ k, tx: cx - ((cx - viewport.tx) / viewport.k) * k, ty: cy - ((cy - viewport.ty) / viewport.k) * k });
  };

  /* ---------------- edit operations ---------------- */

  const addPart = useCallback(
    (type: string, at?: Pt) => {
      const def = getDef(type);
      let v = view;
      if (!geom(def, view)) {
        v = 'bb';
        setView('bb');
        flash(`${def.title} only exists in breadboard view`);
      }
      const el = svgRef.current;
      const vp = viewports[v];
      const center = at ?? (el ? { x: (el.clientWidth / 2 - vp.tx) / vp.k, y: (el.clientHeight / 2 - vp.ty) / vp.k } : { x: 0, y: 0 });
      const inst = createPart(doc, type, v, center);
      if (!at) inst[v] = findFreeSpot(doc, v, inst, { x: inst[v].x, y: inst[v].y });
      commit(produce(doc, (d) => {
        d.parts.push(inst);
        reattach(d);
      }));
      setSelection(new Set([inst.id]));
    },
    [doc, view, viewports, commit],
  );

  const deleteSelection = useCallback(() => {
    if (!selection.size) return;
    commit(
      produce(doc, (d) => {
        d.parts = d.parts.filter((p) => !selection.has(p.id));
        d.wires = d.wires.filter((w) => !selection.has(w.id));
        syncAttachments(d);
      }),
    );
    setSelection(new Set());
  }, [doc, selection, commit]);

  const rotateSelection = useCallback(
    (dir: 1 | -1) => {
      const ids = doc.parts.filter((p) => selection.has(p.id) && geom(getDef(p.type), view));
      if (!ids.length) return;
      commit(
        produce(doc, (d) => {
          for (const p of d.parts) if (selection.has(p.id)) p[view].rot = (p[view].rot + (dir === 1 ? 90 : 270)) % 360;
          syncAttachments(d);
          reattach(d);
        }),
      );
    },
    [doc, selection, view, commit],
  );

  const duplicateSelection = useCallback(() => {
    const parts = doc.parts.filter((p) => selection.has(p.id));
    const wires = doc.wires.filter((w) => selection.has(w.id));
    if (!parts.length && !wires.length) return;
    const idMap = new Map<string, string>();
    const next = produce(doc, (d) => {
      for (const p of parts) {
        const def = getDef(p.type);
        const copy: PartInstance = structuredClone(p);
        copy.id = uid();
        copy.label = nextLabel(d, def.labelPrefix);
        idMap.set(p.id, copy.id);
        copy[view] = { ...copy[view], x: copy[view].x + 2 * P, y: copy[view].y + 2 * P };
        const other: ViewId = view === 'bb' ? 'sch' : 'bb';
        if (geom(def, other)) copy[other] = findFreeSpot(d, other, copy, copy[other]);
        d.parts.push(copy);
      }
      for (const w of wires) {
        const copy: Wire = structuredClone(w);
        copy.id = uid();
        idMap.set(w.id, copy.id);
        for (const p of [...copy.ends, ...copy.bends]) {
          p.x += 2 * P;
          p.y += 2 * P;
        }
        for (const e of copy.ends) if (e.attach) e.attach = idMap.has(e.attach.part) ? { ...e.attach, part: idMap.get(e.attach.part)! } : undefined;
        d.wires.push(copy);
      }
      syncAttachments(d);
      reattach(d);
    });
    commit(next);
    setSelection(new Set(idMap.values()));
  }, [doc, selection, view, commit]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!selection.size) return;
      commit(
        produce(doc, (d) => {
          for (const p of d.parts)
            if (selection.has(p.id)) {
              p[view].x += dx;
              p[view].y += dy;
            }
          for (const w of d.wires)
            if (selection.has(w.id) && w.view === view)
              for (const q of [...w.ends.filter((e) => !e.attach), ...w.bends]) {
                q.x += dx;
                q.y += dy;
              }
          syncAttachments(d);
          reattach(d);
        }),
      );
    },
    [doc, selection, view, commit],
  );

  const changePart = useCallback(
    (id: string, fn: (p: PartInstance) => void, mergeKey?: string) =>
      commit(
        produce(doc, (d) => {
          const p = d.parts.find((x) => x.id === id);
          if (p) fn(p);
          syncAttachments(d);
        }),
        undefined,
        mergeKey,
      ),
    [doc, commit],
  );

  const changeWire = useCallback(
    (id: string, fn: (w: Wire) => void) => {
      commit(produce(doc, (d) => fn(d.wires.find((w) => w.id === id)!)));
      const w = doc.wires.find((x) => x.id === id);
      if (w) {
        const probe = structuredClone(w);
        fn(probe);
        if (probe.color !== w.color) setWireColor(probe.color);
      }
    },
    [doc, commit],
  );

  /* ---------------- file operations ---------------- */

  const newSketch = () => {
    if (doc.parts.length && !confirm('Start a new sketch? Unsaved changes in this sketch will be lost (you can still undo).')) return;
    commit(EMPTY);
    setSelection(new Set());
  };
  const save = () => {
    download('sketch.fzk.json', serialize(doc), 'application/json');
    flash('Sketch downloaded');
  };
  const open = async () => {
    const t = await pickFile('.json,.fzk,application/json');
    if (!t) return;
    try {
      const d = deserialize(t);
      commit(d);
      setSelection(new Set());
      fitted.current = { bb: false, sch: false };
      requestAnimationFrame(fit);
      flash('Sketch opened');
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const exportAs = async (kind: 'svg' | 'png' | 'netlist' | 'bom') => {
    setMenu(null);
    const name = view === 'bb' ? 'breadboard' : 'schematic';
    if (kind === 'netlist') return download('netlist.txt', netlistText(doc), 'text/plain');
    if (kind === 'bom') return download('bom.csv', bomCsv(doc), 'text/csv');
    const el = svgRef.current;
    const svg = el && exportSvgString(el, doc, view);
    if (!svg) return flash('Nothing to export');
    if (kind === 'svg') return download(`${name}.svg`, svg, 'image/svg+xml');
    const png = await svgToPng(svg, 2);
    if (png) download(`${name}.png`, png);
  };

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea')) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && k === 'a') {
        e.preventDefault();
        setSelection(new Set([...doc.parts.filter((p) => geom(getDef(p.type), view)).map((p) => p.id), ...doc.wires.filter((w) => w.view === view).map((w) => w.id)]));
      } else if (mod && k === 's') {
        e.preventDefault();
        save();
      } else if (mod && k === 'o') {
        e.preventDefault();
        open();
      } else if (mod && (k === '1' || k === '2')) {
        e.preventDefault();
        setView(k === '1' ? 'bb' : 'sch');
      } else if (mod && k === '0') {
        e.preventDefault();
        fit();
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        zoomBy(1.25);
      } else if (mod && k === '-') {
        e.preventDefault();
        zoomBy(0.8);
      } else if (!mod && (k === 'delete' || k === 'backspace')) {
        e.preventDefault();
        deleteSelection();
      } else if (!mod && k === 'r') {
        rotateSelection(e.shiftKey ? -1 : 1);
      } else if (k === 'escape') {
        setSelection(new Set());
        setMenu(null);
      } else if (k.startsWith('arrow') && selection.size) {
        e.preventDefault();
        const s = e.shiftKey ? 5 * P : P;
        nudge(k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // drop selection entries that no longer exist (after undo etc.)
  useEffect(() => {
    const ids = new Set([...doc.parts.map((p) => p.id), ...doc.wires.map((w) => w.id)]);
    if ([...selection].some((id) => !ids.has(id))) setSelection(new Set([...selection].filter((id) => ids.has(id))));
  }, [doc, selection]);

  const r = derived.routing;
  const routingText =
    r.netsToRoute === 0
      ? 'No connections to route'
      : r.unrouted === 0
        ? 'Routing completed'
        : `${r.netsRouted} of ${r.netsToRoute} nets routed — ${r.unrouted} connection${r.unrouted === 1 ? '' : 's'} still to be routed`;

  return (
    <div className="app" onPointerDown={() => menu && setMenu(null)}>
      <header className="topbar">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#2f6f5e" />
            <path d="M7 16h5l2-5 4 10 2-5h5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Fritzking</span>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={newSketch} title="New sketch">
            <Icon name="new" />
          </button>
          <button className="tool" onClick={open} title="Open… (⌘O)">
            <Icon name="open" />
          </button>
          <button className="tool" onClick={save} title="Save to file (⌘S)">
            <Icon name="save" />
          </button>
          <div className="menu-anchor" onPointerDown={(e) => e.stopPropagation()}>
            <button className="tool wide" onClick={() => setMenu(menu === 'export' ? null : 'export')} title="Export">
              <Icon name="export" /> Export
            </button>
            {menu === 'export' && (
              <div className="menu">
                <button onClick={() => exportAs('svg')}>{view === 'bb' ? 'Breadboard' : 'Schematic'} as SVG</button>
                <button onClick={() => exportAs('png')}>{view === 'bb' ? 'Breadboard' : 'Schematic'} as PNG</button>
                <hr />
                <button onClick={() => exportAs('netlist')}>Netlist (.txt)</button>
                <button onClick={() => exportAs('bom')}>Bill of materials (.csv)</button>
                <hr />
                <button
                  onClick={() => {
                    setMenu(null);
                    commit(exampleDoc());
                    fitted.current = { bb: false, sch: false };
                    requestAnimationFrame(fit);
                  }}
                >
                  Load example sketch
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={undo} disabled={!hist.past.length} title="Undo (⌘Z)">
            <Icon name="undo" />
          </button>
          <button className="tool" onClick={redo} disabled={!hist.future.length} title="Redo (⇧⌘Z)">
            <Icon name="redo" />
          </button>
          <button className="tool" onClick={() => rotateSelection(1)} disabled={!selection.size} title="Rotate (R)">
            <Icon name="rotate" />
          </button>
          <button className="tool" onClick={deleteSelection} disabled={!selection.size} title="Delete (⌫)">
            <Icon name="trash" />
          </button>
        </div>

        <nav className="tabs">
          {VIEWS.map((v, i) => (
            <button key={v.id} className={`tab ${view === v.id ? 'on' : ''}`} onClick={() => setView(v.id)} title={`${v.label} view (⌘${i + 1})`}>
              <Icon name={v.id} /> {v.label}
            </button>
          ))}
        </nav>

        <div className="spacer" />
        {view === 'bb' && (
          <div className="tool-group wire-color" title="Colour for new wires">
            <span className="muted small">Wire</span>
            <select value={wireColor} onChange={(e) => setWireColor(e.target.value)} style={{ borderLeft: `14px solid ${wireColor}` }}>
              {WIRE_COLORS.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
        <button className={`sim-toggle ${simulating ? 'on' : ''}`} onClick={() => setSimulating((s) => !s)} title="Run the DC circuit simulator">
          <Icon name={simulating ? 'stop' : 'play'} /> {simulating ? 'Stop' : 'Simulate'}
        </button>
      </header>

      <div className="main">
        <PartsBin view={view} onAdd={(t) => addPart(t)} />
        <main className="stage">
          <Canvas
            doc={doc}
            view={view}
            derived={derived}
            selection={selection}
            setSelection={setSelection}
            onLive={live}
            onCommit={(d, before) => commit(d, before)}
            viewport={viewport}
            setViewport={setViewport}
            onDropPart={(t, at) => addPart(t, at)}
            sim={sim}
            simulating={simulating}
            wireColor={wireColor}
            onCursor={setCursor}
            svgRef={svgRef}
          />
          <div className="zoom-ctl">
            <button onClick={() => zoomBy(0.8)} title="Zoom out (⌘−)">−</button>
            <button className="pct" onClick={fit} title="Fit in window (⌘0)">
              {Math.round(viewport.k * 100)}%
            </button>
            <button onClick={() => zoomBy(1.25)} title="Zoom in (⌘+)">+</button>
          </div>
          {simulating && sim && sim.warnings.length > 0 && <div className="sim-banner">{sim.warnings[0]}</div>}
          {toast && <div className="toast">{toast}</div>}
          <footer className="status">
            <span className={`route ${r.unrouted ? 'pending' : 'done'}`}>{routingText}</span>
            <span className="spacer" />
            {simulating && <span className="sim-pill">● Simulating</span>}
            <span className="mono">{cursor ? `${(cursor.x / P / 10).toFixed(2)}″, ${(cursor.y / P / 10).toFixed(2)}″` : ''}</span>
          </footer>
        </main>
        <Inspector
          doc={doc}
          view={view}
          selection={selection}
          routing={r}
          sim={sim}
          simulating={simulating}
          onPartChange={changePart}
          onWireChange={changeWire}
          onRotate={rotateSelection}
          onDelete={deleteSelection}
          onDuplicate={duplicateSelection}
        />
      </div>
    </div>
  );
}
