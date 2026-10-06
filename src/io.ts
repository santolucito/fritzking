import type { Doc, PartInstance, ViewId, Wire } from './types';
import { P } from './types';
import { computeNets, docBounds, nodeKey, reattach, uid } from './model';
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

/* ---------------- Example sketch ---------------- */

export function exampleDoc(): Doc {
  const g = (n: number) => n * P;
  const part = (type: string, label: string, bb: [number, number, number], sch: [number, number, number], props: Record<string, string> = {}): PartInstance => {
    const def = getDef(type);
    const all: Record<string, string> = {};
    for (const pd of def.props) all[pd.key] = pd.default;
    return {
      id: uid(),
      type,
      label,
      props: { ...all, ...props },
      bb: { x: g(bb[0]), y: g(bb[1]), rot: bb[2] },
      sch: { x: g(sch[0]), y: g(sch[1]), rot: sch[2] },
    };
  };
  const board = part('breadboard-half', 'BB1', [0, 0, 0], [0, 0, 0]);
  const bat = part('battery', 'VCC1', [-4, 21, 0], [0, 0, 90], { voltage: '9V' });
  const btn = part('pushbutton', 'S1', [6, 8, 0], [4, -6, 0]);
  const led = part('led', 'LED1', [8, 6, 0], [8, -2, 90], { color: 'Red' });
  const res = part('resistor', 'R1', [7, 10, 90], [8, 4, 90], { resistance: '470Ω' });
  const wire = (x1: number, y1: number, x2: number, y2: number, color: string, bends: [number, number][] = []): Wire => ({
    id: uid(),
    view: 'bb',
    ends: [{ x: g(x1), y: g(y1) }, { x: g(x2), y: g(y2) }],
    bends: bends.map(([x, y]) => ({ x: g(x), y: g(y) })),
    color,
  });
  const doc: Doc = {
    parts: [board, bat, btn, led, res],
    wires: [
      wire(-4, 21, 3, 18, '#cc1414', [[-4, 23], [3, 23]]),
      wire(-3, 21, 2, 17, '#404040', [[-3, 22], [2, 22]]),
      wire(6, 18, 6, 15, '#cc1414'),
      wire(9, 15, 9, 17, '#404040'),
    ],
  };
  reattach(doc);
  return doc;
}

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
