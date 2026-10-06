import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Doc, PartInstance, Pt, ViewId, Wire } from './types';
import { P } from './types';
import Canvas from './Canvas';
import type { ContextInfo, Derived, Viewport } from './Canvas';
import PartsBin from './PartsBin';
import Inspector, { WIRE_COLORS } from './Inspector';
import {
  autoroute, cloneItems, computeNets, createPart, docBounds, findFreeSpot, geom, pinPositions, produce, ratsnest, reattach, syncAttachments,
} from './model';
import { getDef } from './parts';
import { simulate } from './sim';
import {
  EXAMPLES, bomCsv, decodeShare, deserialize, download, encodeShare, exportSvgString, loadLocal, netlistText, pickFile, saveLocal, serialize, svgToPng,
} from './io';
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
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

const SHORTCUTS: [string, string][] = [
  ['Drag from a pin or hole', 'Draw a wire'],
  ['Drag wire middle', 'Add a bend point'],
  ['Double-click bend', 'Remove the bend'],
  ['Double-click dashed line', 'Turn ratsnest into a wire'],
  ['Alt + drag (schematic)', 'Straight diagonal wire'],
  ['Right-click', 'Context menu'],
  ['R / Shift+R', 'Rotate selection'],
  ['Delete / Backspace', 'Delete selection'],
  [`${MOD}C / ${MOD}X / ${MOD}V`, 'Copy / cut / paste'],
  [`${MOD}D`, 'Duplicate'],
  [`${MOD}Z / Shift+${MOD}Z`, 'Undo / redo'],
  [`${MOD}A`, 'Select all in view'],
  ['Arrow keys (Shift ×5)', 'Nudge selection'],
  ['Scroll / Space+drag / middle-drag', 'Pan'],
  [`${MOD}scroll, pinch`, 'Zoom'],
  [`${MOD}0`, 'Fit to window'],
  [`${MOD}1 / ${MOD}2`, 'Breadboard / schematic view'],
  [`${MOD}S / ${MOD}O`, 'Save / open'],
  ['?', 'This help'],
];

export default function App() {
  const [hist, setHist] = useState<History>(() => ({ doc: loadLocal() ?? EXAMPLES[0].build(), past: [], future: [] }));
  const doc = hist.doc;
  const [view, setView] = useState<ViewId>('bb');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [viewports, setViewports] = useState<Record<ViewId, Viewport>>({ bb: { tx: 0, ty: 0, k: 1 }, sch: { tx: 0, ty: 0, k: 1 } });
  const [simulating, setSimulating] = useState(false);
  const [simT, setSimT] = useState(0);
  const [wireColor, setWireColor] = useState(WIRE_COLORS[0][0]);
  const [showLabels, setShowLabels] = useState(true);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ContextInfo | null>(null);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fitted = useRef<Record<ViewId, boolean>>({ bb: false, sch: false });
  const clipboard = useRef<{ parts: PartInstance[]; wires: Wire[]; view: ViewId } | null>(null);

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

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }, []);

  const refit = useCallback(() => {
    fitted.current = { bb: false, sch: false };
  }, []);

  const loadDoc = useCallback(
    (d: Doc, msg?: string) => {
      commit(d);
      setSelection(new Set());
      refit();
      if (msg) flash(msg);
    },
    [commit, refit, flash],
  );

  // A shared sketch in the URL hash takes precedence over the autosaved one.
  useEffect(() => {
    const m = location.hash.match(/^#s=(.+)$/);
    if (!m) return;
    decodeShare(m[1])
      .then((d) => loadDoc(d, 'Opened shared sketch'))
      .catch(() => flash('Could not read the shared sketch link'));
    history.replaceState(null, '', location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- derived ---------------- */

  const full = useMemo(() => computeNets(doc, 'all'), [doc]);
  const derived: Derived = useMemo(() => {
    const local = computeNets(doc, view);
    return { full, local, pins: pinPositions(doc, view), routing: ratsnest(doc, view, full, local) };
  }, [doc, view, full]);
  const sim = useMemo(() => (simulating ? simulate(doc, full, simT) : null), [simulating, doc, full, simT]);

  // Simulation clock: only ticks when something is time-dependent (a blinking Arduino).
  const animated = simulating && doc.parts.some((p) => p.type === 'arduino-uno' && p.props.sketch && p.props.sketch !== 'Pins steady HIGH');
  useEffect(() => {
    if (!animated) {
      setSimT(0);
      return;
    }
    const start = performance.now();
    const id = setInterval(() => setSimT(Math.round(performance.now() - start)), 125);
    return () => clearInterval(id);
  }, [animated]);

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
  }, [view, fit, doc]);

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
      commit(
        produce(doc, (d) => {
          d.parts.push(inst);
          reattach(d);
        }),
      );
      setSelection(new Set([inst.id]));
    },
    [doc, view, viewports, commit, flash],
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
      if (!doc.parts.some((p) => selection.has(p.id) && geom(getDef(p.type), view))) return;
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

  const pasteItems = useCallback(
    (parts: PartInstance[], wires: Wire[], fromView: ViewId, at?: Pt) => {
      if (!parts.length && !wires.length) return;
      // Offset so the copy lands at `at` (context menu / cursor) or just beside the original.
      let dx = 2 * P, dy = 2 * P;
      if (at && fromView === view) {
        const b = docBounds({ parts, wires }, view);
        if (b) {
          dx = Math.round((at.x - b.x - b.w / 2) / P) * P;
          dy = Math.round((at.y - b.y - b.h / 2) / P) * P;
        }
      }
      const copy = cloneItems(doc, parts, wires.filter((w) => w.view === view || parts.some((p) => w.ends.some((e) => e.attach?.part === p.id))), view, dx, dy);
      commit(
        produce(doc, (d) => {
          d.parts.push(...copy.parts);
          d.wires.push(...copy.wires);
          syncAttachments(d);
          reattach(d);
        }),
      );
      setSelection(new Set([...copy.parts.map((p) => p.id), ...copy.wires.map((w) => w.id)]));
    },
    [doc, view, commit],
  );

  const selectedItems = useCallback(
    () => ({ parts: doc.parts.filter((p) => selection.has(p.id)), wires: doc.wires.filter((w) => selection.has(w.id)) }),
    [doc, selection],
  );

  const duplicateSelection = useCallback(() => {
    const { parts, wires } = selectedItems();
    pasteItems(parts, wires, view);
  }, [selectedItems, pasteItems, view]);

  const copySelection = useCallback(() => {
    const { parts, wires } = selectedItems();
    if (!parts.length && !wires.length) return false;
    clipboard.current = { parts: structuredClone(parts), wires: structuredClone(wires), view };
    flash(`Copied ${parts.length + wires.length} item${parts.length + wires.length === 1 ? '' : 's'}`);
    return true;
  }, [selectedItems, view, flash]);

  const paste = useCallback(
    (at?: Pt) => {
      const c = clipboard.current;
      if (!c) return;
      pasteItems(c.parts, c.wires, c.view, at);
    },
    [pasteItems],
  );

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

  const recolorSelected = (color: string) => {
    commit(produce(doc, (d) => d.wires.forEach((w) => selection.has(w.id) && (w.color = color))));
    setWireColor(color);
  };

  const runAutoroute = useCallback(() => {
    const next = autoroute(doc, view, view === 'bb' ? wireColor : '#2b2d31');
    if (next === doc) return;
    const n = next.wires.length - doc.wires.length;
    commit(next);
    flash(`Autorouted ${n} connection${n === 1 ? '' : 's'}`);
  }, [doc, view, wireColor, commit, flash]);

  const selectAll = useCallback(
    () => setSelection(new Set([...doc.parts.filter((p) => geom(getDef(p.type), view)).map((p) => p.id), ...doc.wires.filter((w) => w.view === view).map((w) => w.id)])),
    [doc, view],
  );

  /* ---------------- file operations ---------------- */

  const newSketch = () => {
    if (doc.parts.length && !confirm('Start a new sketch? You can still undo afterwards.')) return;
    loadDoc(EMPTY);
  };
  const save = () => {
    download('sketch.fzk.json', serialize(doc), 'application/json');
    flash('Sketch downloaded');
  };
  const open = async () => {
    const t = await pickFile('.json,.fzk,application/json');
    if (!t) return;
    try {
      loadDoc(deserialize(t), 'Sketch opened');
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const share = async () => {
    setMenu(null);
    const hash = await encodeShare(doc);
    const url = `${location.origin}${location.pathname}#s=${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      flash(`Share link copied (${Math.round(url.length / 1024)} KB)`);
    } catch {
      prompt('Copy this link:', url);
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
      if (help && k === 'escape') return setHelp(false);
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
      } else if (mod && k === 'c') {
        e.preventDefault();
        copySelection();
      } else if (mod && k === 'x') {
        e.preventDefault();
        if (copySelection()) deleteSelection();
      } else if (mod && k === 'v') {
        e.preventDefault();
        paste(cursor ?? undefined);
      } else if (mod && k === 'a') {
        e.preventDefault();
        selectAll();
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
      } else if (!mod && k === '?') {
        setHelp((h) => !h);
      } else if (k === 'escape') {
        setSelection(new Set());
        setMenu(null);
        setCtx(null);
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

  const closeMenus = () => {
    if (menu) setMenu(null);
    if (ctx) setCtx(null);
  };

  const ctxItems = (() => {
    if (!ctx) return [];
    const run = (fn: () => void) => () => {
      setCtx(null);
      fn();
    };
    const items: ({ label: string; action: () => void; disabled?: boolean; danger?: boolean } | 'sep' | { colors: true })[] = [];
    if (ctx.target.kind === 'part') {
      items.push(
        { label: 'Rotate 90° clockwise', action: run(() => rotateSelection(1)) },
        { label: 'Rotate 90° counter-clockwise', action: run(() => rotateSelection(-1)) },
        'sep',
        { label: 'Copy', action: run(copySelection) },
        { label: 'Duplicate', action: run(duplicateSelection) },
        'sep',
        { label: 'Delete', action: run(deleteSelection), danger: true },
      );
    } else if (ctx.target.kind === 'wire') {
      const w = doc.wires.find((x) => x.id === ctx.target.id);
      if (view === 'bb') items.push({ colors: true }, 'sep');
      items.push(
        { label: 'Straighten', action: run(() => changeWire(ctx.target.id!, (x) => (x.bends = []))), disabled: !w?.bends.length },
        { label: 'Copy', action: run(copySelection) },
        'sep',
        { label: 'Delete wire', action: run(deleteSelection), danger: true },
      );
    } else {
      items.push(
        { label: 'Paste here', action: run(() => paste(ctx.world)), disabled: !clipboard.current },
        { label: 'Select all', action: run(selectAll) },
        'sep',
        { label: `Autoroute ${r.unrouted ? `(${r.unrouted})` : ''}`, action: run(runAutoroute), disabled: !r.unrouted },
        { label: 'Fit to window', action: run(fit) },
      );
    }
    return items;
  })();

  return (
    <div className="app" onPointerDown={closeMenus}>
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
          <button className="tool" onClick={open} title={`Open… (${MOD}O)`}>
            <Icon name="open" />
          </button>
          <button className="tool" onClick={save} title={`Save to file (${MOD}S)`}>
            <Icon name="save" />
          </button>
          <div className="menu-anchor" onPointerDown={(e) => e.stopPropagation()}>
            <button className="tool wide" onClick={() => setMenu(menu === 'export' ? null : 'export')} title="Export and share">
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
                <button onClick={share}>Copy share link</button>
              </div>
            )}
          </div>
          <div className="menu-anchor" onPointerDown={(e) => e.stopPropagation()}>
            <button className="tool wide" onClick={() => setMenu(menu === 'examples' ? null : 'examples')} title="Example sketches">
              <Icon name="examples" /> Examples
            </button>
            {menu === 'examples' && (
              <div className="menu examples">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => {
                      setMenu(null);
                      loadDoc(ex.build(), `Loaded “${ex.title}”`);
                    }}
                  >
                    <b>{ex.title}</b>
                    <small>{ex.blurb}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={undo} disabled={!hist.past.length} title={`Undo (${MOD}Z)`}>
            <Icon name="undo" />
          </button>
          <button className="tool" onClick={redo} disabled={!hist.future.length} title={`Redo (Shift+${MOD}Z)`}>
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
            <button key={v.id} className={`tab ${view === v.id ? 'on' : ''}`} onClick={() => setView(v.id)} title={`${v.label} view (${MOD}${i + 1})`}>
              <Icon name={v.id} /> {v.label}
            </button>
          ))}
        </nav>

        <div className="spacer" />
        {view === 'bb' ? (
          <>
            <button className={`tool ${showLabels ? 'active' : ''}`} onClick={() => setShowLabels((s) => !s)} title="Show part labels">
              <Icon name="label" /> Labels
            </button>
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
          </>
        ) : (
          <button className="tool wide" onClick={runAutoroute} disabled={!r.unrouted} title="Turn every ratsnest line into a wire">
            <Icon name="route" /> Autoroute{r.unrouted ? ` (${r.unrouted})` : ''}
          </button>
        )}
        <button className="tool" onClick={() => setHelp(true)} title="Help (?)">
          <Icon name="help" />
        </button>
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
            showLabels={showLabels}
            onContextMenu={setCtx}
          />
          {ctx && (
            <div className="menu ctx" style={{ left: ctx.sx, top: ctx.sy }} onPointerDown={(e) => e.stopPropagation()}>
              {ctxItems.map((it, i) =>
                it === 'sep' ? (
                  <hr key={i} />
                ) : 'colors' in it ? (
                  <div key={i} className="ctx-colors">
                    {WIRE_COLORS.map(([c, name]) => (
                      <button
                        key={c}
                        title={name}
                        className="swatch"
                        style={{ background: c }}
                        onClick={() => {
                          setCtx(null);
                          recolorSelected(c);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <button key={i} onClick={it.action} disabled={it.disabled} className={it.danger ? 'danger' : ''}>
                    {it.label}
                  </button>
                ),
              )}
            </div>
          )}
          <div className="zoom-ctl">
            <button onClick={() => zoomBy(0.8)} title={`Zoom out (${MOD}−)`}>−</button>
            <button className="pct" onClick={fit} title={`Fit in window (${MOD}0)`}>
              {Math.round(viewport.k * 100)}%
            </button>
            <button onClick={() => zoomBy(1.25)} title={`Zoom in (${MOD}+)`}>+</button>
          </div>
          {simulating && sim && sim.warnings.length > 0 && <div className="sim-banner">{sim.warnings[0]}</div>}
          {toast && <div className="toast">{toast}</div>}
          <footer className="status">
            <span className={`route ${r.unrouted ? 'pending' : 'done'}`}>{routingText}</span>
            <span className="spacer" />
            {simulating && <span className="sim-pill">● Simulating{animated ? ` · ${(simT / 1000).toFixed(1)}s` : ''}</span>}
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

      {help && (
        <div className="modal-back" onClick={() => setHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Fritzking help</h2>
              <button className="tool" onClick={() => setHelp(false)} title="Close (Esc)">
                ✕
              </button>
            </div>
            <p>
              Drag parts from the bin onto the breadboard. Parts pushed into the board connect through its strips (highlighted green). Switch to the
              Schematic tab to see the same circuit as symbols: dashed <i>ratsnest</i> lines show connections you still need to draw, or press{' '}
              <b>Autoroute</b>. Press <b>Simulate</b> to see what the circuit does — click buttons and switches, drag sliders in the Inspector, and hover
              pins to read voltages.
            </p>
            <table className="shortcuts">
              <tbody>
                {SHORTCUTS.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
