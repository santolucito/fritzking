import type { Doc, PartSimState, SimElement } from './types';
import type { Nets } from './model';
import { nodeKey } from './model';
import { PARTS } from './parts';

export interface SimResult {
  /** Voltage per net root (relative to ground). */
  netVoltage: Map<string, number>;
  parts: Map<string, PartSimState>;
  warnings: string[];
  ok: boolean;
}

const GMIN = 1e-9;
const GOFF = 1e-9;

interface Bound {
  part: string;
  el: SimElement;
  roots: Record<string, string>; // terminal -> net root
  n: Record<string, number>; // terminal -> matrix index (-1 = ground)
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-18) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/** DC operating-point simulation using modified nodal analysis with piecewise-linear diodes. */
export function simulate(doc: Doc, nets: Nets): SimResult {
  const warnings: string[] = [];
  const bound: Bound[] = [];
  const roots: string[] = [];
  const index = new Map<string, number>();
  let ground: string | null = null;

  for (const inst of doc.parts) {
    const def = PARTS[inst.type];
    if (!def?.sim) continue;
    for (const el of def.sim(inst)) {
      const terms: Record<string, string> =
        el.kind === 'R' ? { a: el.a, b: el.b } : el.kind === 'V' ? { p: el.p, n: el.n } : el.kind === 'D' ? { a: el.a, k: el.k } : { b: el.b, c: el.c, e: el.e };
      const rootsOf: Record<string, string> = {};
      for (const [t, conn] of Object.entries(terms)) rootsOf[t] = nets.find(nodeKey(inst.id, conn));
      if (el.kind === 'V' && !ground) ground = rootsOf.n;
      bound.push({ part: inst.id, el, roots: rootsOf, n: {} });
    }
  }
  if (!ground) return { netVoltage: new Map(), parts: new Map(), warnings: ['Add a battery or an Arduino to power the circuit.'], ok: false };

  for (const b of bound) {
    const idx: Record<string, number> = {};
    for (const [t, root] of Object.entries(b.roots)) {
      if (root === ground) idx[t] = -1;
      else {
        if (!index.has(root)) {
          index.set(root, roots.length);
          roots.push(root);
        }
        idx[t] = index.get(root)!;
      }
    }
    b.n = idx;
  }

  const N = roots.length;
  const dOn = new Map<Bound, boolean>();
  const qOn = new Map<Bound, boolean>();
  let v: number[] = new Array(N).fill(0);
  const V = (i: number) => (i < 0 ? 0 : v[i]);

  const diodeParams = (b: Bound) =>
    b.el.kind === 'D' ? { a: b.n.a, k: b.n.k, vf: b.el.vf, rs: b.el.rs } : { a: b.n.b, k: b.n.e, vf: 0.65, rs: 20 };

  for (let iter = 0; iter < 60; iter++) {
    const A = Array.from({ length: N }, () => new Array(N).fill(0));
    const I = new Array(N).fill(0);
    const g = (a: number, c: number, val: number) => {
      if (a >= 0) A[a][a] += val;
      if (c >= 0) A[c][c] += val;
      if (a >= 0 && c >= 0) {
        A[a][c] -= val;
        A[c][a] -= val;
      }
    };
    const inj = (a: number, val: number) => {
      if (a >= 0) I[a] += val;
    };
    for (let i = 0; i < N; i++) A[i][i] += GMIN;
    for (const b of bound) {
      const el = b.el;
      if (el.kind === 'R') g(b.n.a, b.n.b, 1 / el.r);
      else if (el.kind === 'V') {
        const gv = 1 / el.r;
        g(b.n.p, b.n.n, gv);
        inj(b.n.p, el.v * gv);
        inj(b.n.n, -el.v * gv);
      }
      if (el.kind === 'D' || el.kind === 'Q') {
        const d = diodeParams(b);
        if (dOn.get(b)) {
          const gd = 1 / d.rs;
          g(d.a, d.k, gd);
          inj(d.a, d.vf * gd);
          inj(d.k, -d.vf * gd);
        } else g(d.a, d.k, GOFF);
      }
      if (el.kind === 'Q') g(b.n.c, b.n.e, qOn.get(b) ? 1 / 2 : GOFF);
    }
    const x = solve(A, I);
    if (!x) {
      warnings.push('Circuit could not be solved.');
      return { netVoltage: new Map(), parts: new Map(), warnings, ok: false };
    }
    v = x;
    let changed = false;
    for (const b of bound) {
      if (b.el.kind !== 'D' && b.el.kind !== 'Q') continue;
      const d = diodeParams(b);
      const vd = V(d.a) - V(d.k);
      const on = !!dOn.get(b);
      if (on && (vd - d.vf) / d.rs < -1e-9) {
        dOn.set(b, false);
        changed = true;
      } else if (!on && vd > d.vf + 1e-6) {
        dOn.set(b, true);
        changed = true;
      }
      if (b.el.kind === 'Q') {
        const ib = dOn.get(b) ? Math.max(0, (vd - d.vf) / d.rs) : 0;
        const q = ib > 2e-5;
        if (q !== !!qOn.get(b)) {
          qOn.set(b, q);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const netVoltage = new Map<string, number>();
  netVoltage.set(ground, 0);
  roots.forEach((r, i) => netVoltage.set(r, v[i]));

  const parts = new Map<string, PartSimState>();
  const add = (id: string, cur: number, pow: number) => {
    const s = parts.get(id) ?? { current: undefined, power: 0 };
    if (s.current === undefined) s.current = cur;
    s.power = (s.power ?? 0) + pow;
    parts.set(id, s);
  };
  for (const b of bound) {
    const el = b.el;
    if (el.kind === 'R') {
      const i = (V(b.n.a) - V(b.n.b)) / el.r;
      add(b.part, i, i * i * el.r);
    } else if (el.kind === 'V') {
      const i = (el.v - (V(b.n.p) - V(b.n.n))) / el.r; // current delivered
      add(b.part, i, i * el.v);
      if (Math.abs(i) > 3) {
        const inst = doc.parts.find((p) => p.id === b.part);
        warnings.push(`Short circuit! ${inst?.label ?? 'A source'} is delivering ${i.toFixed(1)}A.`);
      }
    } else {
      const d = diodeParams(b);
      const vd = V(d.a) - V(d.k);
      const i = dOn.get(b) ? Math.max(0, (vd - d.vf) / d.rs) : 0;
      if (el.kind === 'Q') {
        const ic = qOn.get(b) ? (V(b.n.c) - V(b.n.e)) / 2 : 0;
        add(b.part, ic, ic * (V(b.n.c) - V(b.n.e)));
      } else add(b.part, i, i * vd);
    }
  }

  for (const inst of doc.parts) {
    const s = parts.get(inst.id);
    if (!s) continue;
    const cur = Math.abs(s.current ?? 0);
    if (inst.type === 'led') {
      s.level = Math.min(1, cur / 0.015);
      s.on = cur > 1e-4;
      if (cur > 0.05) {
        s.burnt = true;
        warnings.push(`${inst.label} is drawing ${(cur * 1000).toFixed(0)}mA and burnt out — add a current-limiting resistor.`);
      }
    } else if (inst.type === 'buzzer') s.level = cur > 0.003 ? 1 : 0;
    else if (inst.type === 'motor') s.level = Math.min(1, cur / 0.15);
    else if (inst.type === 'resistor' && (s.power ?? 0) > 0.25) warnings.push(`${inst.label} dissipates ${(s.power ?? 0).toFixed(2)}W (rated 0.25W) — it would overheat.`);
  }

  return { netVoltage, parts, warnings, ok: true };
}
