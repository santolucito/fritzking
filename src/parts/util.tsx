import { P } from '../types';

export const u = (n: number) => n * P;

const SI: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

/** Parse "4.7k", "220Ω", "1M", "100nF", "4k7" into a number. */
export function parseValue(s: string): number {
  const t = s.replace(/[ΩFVAHz\s]|ohms?/gi, '');
  const infix = t.match(/^(\d+)([pnuµmkKMG])(\d+)$/);
  if (infix) return parseFloat(`${infix[1]}.${infix[3]}`) * SI[infix[2]];
  const m = t.match(/^([\d.]+)([pnuµmkKMG]?)$/);
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] ? SI[m[2]] : 1);
}

export function formatValue(v: number, unit = ''): string {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const steps: [number, string][] = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
  ];
  if (a === 0) return `0${unit}`;
  for (const [f, p] of steps) {
    if (a >= f * 0.9995) {
      const n = v / f;
      const s = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
      return `${s.replace(/\.?0+$/, '')}${p}${unit}`;
    }
  }
  return `${v.toExponential(1)}${unit}`;
}

const BAND = ['#1a1a1a', '#7a4a1e', '#d42a1f', '#f07b16', '#f4d21c', '#2e9b3c', '#2563c9', '#7d3fb5', '#8a8a8a', '#f5f5f5'];
const GOLD = '#c8a24a';
const SILVER = '#b8bcc0';

/** 4-band resistor colour code. */
export function resistorBands(ohms: number): string[] {
  if (!isFinite(ohms) || ohms <= 0) return [BAND[0], BAND[0], BAND[0], GOLD];
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / Math.pow(10, exp));
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp += 1;
  }
  const d1 = Math.floor(digits / 10) % 10;
  const d2 = digits % 10;
  const mult = exp === -1 ? GOLD : exp === -2 ? SILVER : BAND[Math.max(0, Math.min(9, exp))];
  return [BAND[d1], BAND[d2], mult, GOLD];
}

export const LEAD = '#a7aaad';
export const LEAD_DARK = '#7d8084';

/** A metal lead drawn as a polyline. */
export function Lead({ pts, w = 3 }: { pts: [number, number][]; w?: number }) {
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={LEAD_DARK} strokeWidth={w + 1} />
      <path d={d} stroke={LEAD} strokeWidth={w} />
    </g>
  );
}

/** Schematic stroke defaults. */
export const SCH = { stroke: '#1d1f22', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function SchPinLine({ from, to }: { from: [number, number]; to: [number, number] }) {
  return <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} {...SCH} />;
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
