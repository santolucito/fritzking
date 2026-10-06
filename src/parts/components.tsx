import type { ReactNode } from 'react';
import type { PartDef, PartInstance, Pt, ViewGeom, RenderCtx } from '../types';
import { Lead, SCH, formatValue, parseValue, resistorBands, shade, u } from './util';

const pt = (x: number, y: number): Pt => ({ x: u(x), y: u(y) });

const RESISTANCES = ['10Ω', '47Ω', '100Ω', '220Ω', '330Ω', '470Ω', '1kΩ', '2.2kΩ', '4.7kΩ', '10kΩ', '22kΩ', '47kΩ', '100kΩ', '1MΩ'];

/* ---------------- shared schematic bits ---------------- */

function zigzag(x0: number, x1: number, amp = u(0.35), n = 6): string {
  const step = (x1 - x0) / n;
  let d = `M${x0} 0`;
  for (let i = 0; i < n; i++) {
    const x = x0 + step * (i + 0.5);
    d += ` L${x} ${i % 2 ? amp : -amp}`;
  }
  return d + ` L${x1} 0`;
}

function DiodeSymbol({ x0, x1, fill }: { x0: number; x1: number; fill?: string }) {
  const h = u(0.6);
  return (
    <g>
      <path d={`M${x0} ${-h} L${x1} 0 L${x0} ${h} Z`} {...SCH} fill={fill ?? 'none'} />
      <line x1={x1} y1={-h} x2={x1} y2={h} {...SCH} />
    </g>
  );
}

function Arrow({ x, y, dx, dy }: { x: number; y: number; dx: number; dy: number }) {
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const hx = x + dx, hy = y + dy;
  const a = 5;
  return (
    <g>
      <line x1={x} y1={y} x2={hx} y2={hy} {...SCH} strokeWidth={1.5} />
      <path
        d={`M${hx} ${hy} L${hx - ux * a - uy * a * 0.6} ${hy - uy * a + ux * a * 0.6} L${hx - ux * a + uy * a * 0.6} ${hy - uy * a - ux * a * 0.6} Z`}
        fill="#1d1f22"
      />
    </g>
  );
}

function twoPinSch(len: number, body: (ctx: RenderCtx, inst: PartInstance) => ReactNode, b0: number, b1: number): ViewGeom {
  return {
    pins: { p0: pt(0, 0), p1: pt(len, 0) },
    pivot: pt(Math.round(len / 2), 0),
    bounds: { x: 0, y: u(-1), w: u(len), h: u(2) },
    render: (inst, ctx) => (
      <g>
        <line x1={0} y1={0} x2={u(b0)} y2={0} {...SCH} />
        <line x1={u(b1)} y1={0} x2={u(len)} y2={0} {...SCH} />
        {body(ctx, inst)}
      </g>
    ),
  };
}

interface IcPin {
  id: string;
  label: string;
  num?: string;
}

/** Rectangular IC-style schematic symbol. */
function icSchematic(title: string, width: number, left: IcPin[], right: IcPin[], bottom: IcPin[] = []): ViewGeom {
  const n = Math.max(left.length, right.length);
  const pins: Record<string, Pt> = {};
  left.forEach((p, i) => (pins[p.id] = pt(0, i)));
  right.forEach((p, i) => (pins[p.id] = pt(width + 2, i)));
  bottom.forEach((p, i) => (pins[p.id] = pt(2 + Math.round(((i + 1) * width) / (bottom.length + 1)) - 1, n + 1)));
  const x0 = u(1), x1 = u(width + 1);
  return {
    pins,
    pivot: pt(Math.round((width + 2) / 2), Math.round(n / 2)),
    bounds: { x: 0, y: u(-2), w: u(width + 2), h: u(n + 3) },
    render: () => (
      <g fontFamily="system-ui, sans-serif">
        <rect x={x0} y={u(-1)} width={x1 - x0} height={u(n + 1)} {...SCH} fill="#fffef6" />
        <text x={(x0 + x1) / 2} y={u(-1.3)} fontSize={11} fontWeight={600} textAnchor="middle" fill="#1d1f22">
          {title}
        </text>
        {left.map((p) => (
          <g key={p.id}>
            <line x1={0} y1={pins[p.id].y} x2={x0} y2={pins[p.id].y} {...SCH} />
            <text x={x0 + 4} y={pins[p.id].y + 3.5} fontSize={9.5} fill="#1d1f22">{p.label}</text>
            {p.num && <text x={u(0.5)} y={pins[p.id].y - 3} fontSize={7} textAnchor="middle" fill="#6b6f75">{p.num}</text>}
          </g>
        ))}
        {right.map((p) => (
          <g key={p.id}>
            <line x1={x1} y1={pins[p.id].y} x2={u(width + 2)} y2={pins[p.id].y} {...SCH} />
            <text x={x1 - 4} y={pins[p.id].y + 3.5} fontSize={9.5} textAnchor="end" fill="#1d1f22">{p.label}</text>
            {p.num && <text x={u(width + 1.5)} y={pins[p.id].y - 3} fontSize={7} textAnchor="middle" fill="#6b6f75">{p.num}</text>}
          </g>
        ))}
        {bottom.map((p) => (
          <g key={p.id}>
            <line x1={pins[p.id].x} y1={u(n)} x2={pins[p.id].x} y2={pins[p.id].y} {...SCH} />
            <text x={pins[p.id].x} y={u(n) - 4} fontSize={9.5} textAnchor="middle" fill="#1d1f22">{p.label}</text>
          </g>
        ))}
      </g>
    ),
  };
}

/* ---------------- Resistor ---------------- */

const resistor: PartDef = {
  type: 'resistor',
  title: 'Resistor',
  category: 'Core',
  description: 'Limits current. The colour bands update with the resistance value.',
  labelPrefix: 'R',
  props: [{ key: 'resistance', label: 'Resistance', kind: 'select', options: RESISTANCES, default: '220Ω' }],
  connectors: [
    { id: 'p0', name: 'Pin 1' },
    { id: 'p1', name: 'Pin 2' },
  ],
  valueText: (i) => i.props.resistance,
  sim: (i) => [{ kind: 'R', a: 'p0', b: 'p1', r: Math.max(1e-3, parseValue(i.props.resistance) || 1) }],
  bb: {
    pins: { p0: pt(0, 0), p1: pt(4, 0) },
    pivot: pt(2, 0),
    bounds: { x: u(-0.2), y: u(-0.6), w: u(4.4), h: u(1.2) },
    render: (inst, ctx) => {
      const bands = resistorBands(parseValue(inst.props.resistance));
      const hot = (ctx.sim?.power ?? 0) > 0.25;
      return (
        <g>
          <Lead pts={[[0, 0], [u(4), 0]]} />
          <path
            d={`M${u(0.85)} ${u(-0.32)} q0 -5 6 -5 h${u(0.35)} q4 0 6 2 h${u(0.62)} q2 -2 6 -2 h${u(0.35)} q6 0 6 5 v${u(0.64)} q0 5 -6 5 h${-u(0.35)} q-4 0 -6 -2 h${-u(0.62)} q-2 2 -6 2 h${-u(0.35)} q-6 0 -6 -5 z`}
            fill={hot ? '#e58e6b' : '#dcc89c'}
            stroke="#a88f5f"
            strokeWidth={1}
          />
          {[1.25, 1.62, 1.99].map((x, k) => (
            <rect key={k} x={u(x)} y={u(-0.38)} width={u(0.17)} height={u(0.76)} fill={bands[k]} />
          ))}
          <rect x={u(2.62)} y={u(-0.42)} width={u(0.17)} height={u(0.84)} fill={bands[3]} />
          <rect x={u(0.95)} y={u(-0.3)} width={u(2.1)} height={u(0.12)} rx={2} fill="#fff" opacity={0.35} />
          {hot && <circle cx={u(2)} cy={0} r={u(1.4)} fill="#ff5a1f" opacity={0.18} />}
        </g>
      );
    },
  },
  sch: twoPinSch(4, () => <path d={zigzag(u(1), u(3))} {...SCH} />, 1, 3),
};

/* ---------------- LEDs ---------------- */

const LED_COLORS: Record<string, { c: string; vf: number }> = {
  Red: { c: '#e5332a', vf: 1.8 },
  Orange: { c: '#f07d1a', vf: 2.0 },
  Yellow: { c: '#f1cf23', vf: 2.0 },
  Green: { c: '#2bb84a', vf: 2.1 },
  Blue: { c: '#2f6fe8', vf: 3.0 },
  White: { c: '#f2f3ec', vf: 3.0 },
};

const led: PartDef = {
  type: 'led',
  title: 'LED',
  category: 'Output',
  description: '5mm light-emitting diode. The longer, bent leg is the anode (+). Glows in the simulator.',
  labelPrefix: 'LED',
  props: [{ key: 'color', label: 'Color', kind: 'select', options: Object.keys(LED_COLORS), default: 'Red' }],
  connectors: [
    { id: 'a', name: 'Anode (+)' },
    { id: 'k', name: 'Cathode (−)' },
  ],
  valueText: (i) => `${i.props.color}`,
  sim: (i) => [{ kind: 'D', a: 'a', k: 'k', vf: LED_COLORS[i.props.color]?.vf ?? 2, rs: 12 }],
  bb: {
    pins: { a: pt(0, 0), k: pt(1, 0) },
    pivot: pt(0, 0),
    bounds: { x: u(-0.6), y: u(-3.5), w: u(2.2), h: u(3.7) },
    render: (inst, ctx) => {
      const col = LED_COLORS[inst.props.color]?.c ?? '#e5332a';
      const lvl = ctx.sim?.burnt ? 0 : (ctx.sim?.level ?? 0);
      const gid = `ledg-${inst.id}`;
      return (
        <g>
          <defs>
            <radialGradient id={gid}>
              <stop offset="0%" stopColor={shade(col, 0.6)} stopOpacity={0.95} />
              <stop offset="45%" stopColor={col} stopOpacity={0.55} />
              <stop offset="100%" stopColor={col} stopOpacity={0} />
            </radialGradient>
          </defs>
          <Lead pts={[[0, 0], [0, u(-0.45)], [u(0.22), u(-0.75)], [u(0.22), u(-1.15)]]} />
          <Lead pts={[[u(1), 0], [u(1), u(-0.6)], [u(0.78), u(-0.9)], [u(0.78), u(-1.15)]]} />
          {lvl > 0.02 && <circle cx={u(0.5)} cy={u(-2.3)} r={u(1.2 + 1.6 * lvl)} fill={`url(#${gid})`} opacity={0.35 + 0.65 * lvl} />}
          <rect x={u(-0.18)} y={u(-1.45)} width={u(1.36)} height={u(0.32)} rx={2} fill={ctx.sim?.burnt ? '#3b3330' : shade(col, -0.15)} opacity={0.95} />
          <path
            d={`M${u(-0.05)} ${u(-1.45)} V${u(-2.7)} A${u(0.55)} ${u(0.55)} 0 0 1 ${u(1.05)} ${u(-2.7)} V${u(-1.45)} Z`}
            fill={ctx.sim?.burnt ? '#3b3330' : lvl > 0.02 ? shade(col, 0.35 + 0.4 * lvl) : col}
            stroke={shade(col, -0.35)}
            strokeWidth={0.8}
            opacity={0.92}
          />
          <path d={`M${u(0.12)} ${u(-1.6)} V${u(-2.65)} A${u(0.4)} ${u(0.4)} 0 0 1 ${u(0.42)} ${u(-3.05)}`} stroke="#fff" strokeWidth={2} fill="none" opacity={0.45} strokeLinecap="round" />
          {ctx.sim?.burnt && (
            <g fill="#8a8a8a" opacity={0.55}>
              <circle cx={u(0.6)} cy={u(-3.6)} r={5} />
              <circle cx={u(0.2)} cy={u(-4.1)} r={7} />
              <circle cx={u(0.8)} cy={u(-4.8)} r={9} />
            </g>
          )}
        </g>
      );
    },
  },
  sch: {
    pins: { a: pt(0, 0), k: pt(4, 0) },
    pivot: pt(2, 0),
    bounds: { x: 0, y: u(-1.4), w: u(4), h: u(2.2) },
    render: (inst, ctx) => {
      const col = LED_COLORS[inst.props.color]?.c ?? '#e5332a';
      const lit = !ctx.sim?.burnt && (ctx.sim?.level ?? 0) > 0.02;
      return (
        <g>
          <line x1={0} y1={0} x2={u(1.4)} y2={0} {...SCH} />
          <line x1={u(2.6)} y1={0} x2={u(4)} y2={0} {...SCH} />
          <DiodeSymbol x0={u(1.4)} x1={u(2.6)} fill={lit ? col : undefined} />
          <Arrow x={u(1.9)} y={u(-0.75)} dx={8} dy={-8} />
          <Arrow x={u(2.4)} y={u(-0.75)} dx={8} dy={-8} />
        </g>
      );
    },
  },
};

/* ---------------- Diode ---------------- */

const diode: PartDef = {
  type: 'diode',
  title: 'Rectifier Diode',
  category: 'Core',
  description: '1N4001 silicon diode. Current flows from anode to the banded cathode.',
  labelPrefix: 'D',
  props: [],
  connectors: [
    { id: 'a', name: 'Anode' },
    { id: 'k', name: 'Cathode' },
  ],
  valueText: () => '1N4001',
  sim: () => [{ kind: 'D', a: 'a', k: 'k', vf: 0.7, rs: 0.5 }],
  bb: {
    pins: { a: pt(0, 0), k: pt(4, 0) },
    pivot: pt(2, 0),
    bounds: { x: 0, y: u(-0.5), w: u(4), h: u(1) },
    render: () => (
      <g>
        <Lead pts={[[0, 0], [u(4), 0]]} />
        <rect x={u(1)} y={u(-0.38)} width={u(2)} height={u(0.76)} rx={4} fill="#26272a" />
        <rect x={u(2.55)} y={u(-0.38)} width={u(0.22)} height={u(0.76)} fill="#c7c9cc" />
        <rect x={u(1.1)} y={u(-0.3)} width={u(1.8)} height={u(0.12)} rx={2} fill="#fff" opacity={0.2} />
      </g>
    ),
  },
  sch: twoPinSch(4, () => <DiodeSymbol x0={u(1.4)} x1={u(2.6)} />, 1.4, 2.6),
};

/* ---------------- Capacitors ---------------- */

const ceramicCap: PartDef = {
  type: 'cap-ceramic',
  title: 'Ceramic Capacitor',
  category: 'Core',
  description: 'Non-polarised capacitor. Acts as an open circuit in the DC simulator.',
  labelPrefix: 'C',
  props: [{ key: 'capacitance', label: 'Capacitance', kind: 'select', options: ['10pF', '22pF', '100pF', '1nF', '10nF', '100nF', '1µF'], default: '100nF' }],
  connectors: [
    { id: 'p0', name: 'Pin 1' },
    { id: 'p1', name: 'Pin 2' },
  ],
  valueText: (i) => i.props.capacitance,
  bb: {
    pins: { p0: pt(0, 0), p1: pt(1, 0) },
    pivot: pt(0, 0),
    bounds: { x: u(-0.5), y: u(-2.8), w: u(2), h: u(3) },
    render: (inst) => (
      <g>
        <Lead pts={[[0, 0], [0, u(-0.5)], [u(0.2), u(-1.3)]]} />
        <Lead pts={[[u(1), 0], [u(1), u(-0.5)], [u(0.8), u(-1.3)]]} />
        <ellipse cx={u(0.5)} cy={u(-1.8)} rx={u(0.9)} ry={u(0.8)} fill="#e9a23b" stroke="#b67619" strokeWidth={1} />
        <ellipse cx={u(0.3)} cy={u(-2.1)} rx={u(0.35)} ry={u(0.2)} fill="#fff" opacity={0.35} />
        <text x={u(0.5)} y={u(-1.62)} fontSize={7} textAnchor="middle" fill="#6b4310" fontFamily="system-ui">
          {capCode(inst.props.capacitance)}
        </text>
      </g>
    ),
  },
  sch: {
    pins: { p0: pt(0, 0), p1: pt(2, 0) },
    pivot: pt(1, 0),
    bounds: { x: 0, y: u(-0.8), w: u(2), h: u(1.6) },
    render: () => (
      <g>
        <line x1={0} y1={0} x2={u(0.85)} y2={0} {...SCH} />
        <line x1={u(1.15)} y1={0} x2={u(2)} y2={0} {...SCH} />
        <line x1={u(0.85)} y1={u(-0.65)} x2={u(0.85)} y2={u(0.65)} {...SCH} strokeWidth={2.5} />
        <line x1={u(1.15)} y1={u(-0.65)} x2={u(1.15)} y2={u(0.65)} {...SCH} strokeWidth={2.5} />
      </g>
    ),
  },
};

function capCode(s: string): string {
  const pf = parseValue(s) / 1e-12;
  if (!isFinite(pf) || pf < 10) return '';
  const exp = Math.floor(Math.log10(pf)) - 1;
  return `${Math.round(pf / Math.pow(10, exp))}${exp}`;
}

const electrolytic: PartDef = {
  type: 'cap-electrolytic',
  title: 'Electrolytic Capacitor',
  category: 'Core',
  description: 'Polarised capacitor. The striped side is negative.',
  labelPrefix: 'C',
  props: [{ key: 'capacitance', label: 'Capacitance', kind: 'select', options: ['1µF', '10µF', '47µF', '100µF', '470µF', '1000µF'], default: '100µF' }],
  connectors: [
    { id: 'p', name: '+' },
    { id: 'n', name: '−' },
  ],
  valueText: (i) => i.props.capacitance,
  bb: {
    pins: { p: pt(0, 0), n: pt(1, 0) },
    pivot: pt(0, 0),
    bounds: { x: u(-0.5), y: u(-4.2), w: u(2), h: u(4.4) },
    render: (inst) => (
      <g>
        <Lead pts={[[0, 0], [0, u(-1.2)]]} />
        <Lead pts={[[u(1), 0], [u(1), u(-1.2)]]} />
        <rect x={u(-0.35)} y={u(-3.9)} width={u(1.7)} height={u(2.75)} rx={4} fill="#253f86" />
        <rect x={u(0.95)} y={u(-3.9)} width={u(0.4)} height={u(2.75)} fill="#9fb0d6" />
        <text x={u(1.15)} y={u(-3.2)} fontSize={9} textAnchor="middle" fill="#253f86" fontWeight={700}>−</text>
        <text x={u(1.15)} y={u(-2.3)} fontSize={9} textAnchor="middle" fill="#253f86" fontWeight={700}>−</text>
        <ellipse cx={u(0.5)} cy={u(-3.9)} rx={u(0.85)} ry={u(0.22)} fill="#b9bcc2" />
        <rect x={u(-0.25)} y={u(-3.6)} width={u(0.18)} height={u(2.2)} rx={2} fill="#fff" opacity={0.25} />
        <text x={u(0.3)} y={u(-2.2)} fontSize={6.5} textAnchor="middle" fill="#dfe6f7" fontFamily="system-ui" transform={`rotate(-90 ${u(0.3)} ${u(-2.4)})`}>
          {inst.props.capacitance}
        </text>
      </g>
    ),
  },
  sch: {
    pins: { p: pt(0, 0), n: pt(2, 0) },
    pivot: pt(1, 0),
    bounds: { x: 0, y: u(-0.9), w: u(2), h: u(1.8) },
    render: () => (
      <g>
        <line x1={0} y1={0} x2={u(0.85)} y2={0} {...SCH} />
        <line x1={u(1.05)} y1={0} x2={u(2)} y2={0} {...SCH} />
        <line x1={u(0.85)} y1={u(-0.65)} x2={u(0.85)} y2={u(0.65)} {...SCH} strokeWidth={2.5} />
        <path d={`M${u(1.3)} ${u(-0.65)} Q${u(1.0)} 0 ${u(1.3)} ${u(0.65)}`} {...SCH} strokeWidth={2.5} />
        <text x={u(0.45)} y={u(-0.4)} fontSize={11} textAnchor="middle" fill="#1d1f22">+</text>
      </g>
    ),
  },
};

/* ---------------- Switches ---------------- */

const pushbutton: PartDef = {
  type: 'pushbutton',
  title: 'Pushbutton',
  category: 'Input',
  description: '6mm tactile switch. Place it across the centre channel. While simulating, click it to press.',
  labelPrefix: 'S',
  props: [{ key: 'pressed', label: 'Pressed', kind: 'bool', default: 'no' }],
  connectors: [
    { id: 'a1', name: 'A1' },
    { id: 'b1', name: 'B1' },
    { id: 'a2', name: 'A2' },
    { id: 'b2', name: 'B2' },
  ],
  buses: [
    ['a1', 'a2'],
    ['b1', 'b2'],
  ],
  simToggle: { key: 'pressed', values: ['no', 'yes'], momentary: true },
  sim: (i) => (i.props.pressed === 'yes' ? [{ kind: 'R', a: 'a1', b: 'b1', r: 0.01 }] : []),
  bb: {
    pins: { a1: pt(0, 0), b1: pt(2, 0), a2: pt(0, 3), b2: pt(2, 3) },
    pivot: pt(1, 1),
    bounds: { x: u(-0.5), y: u(-0.2), w: u(3), h: u(3.4) },
    render: (inst) => {
      const down = inst.props.pressed === 'yes';
      return (
        <g>
          {[[0, 0], [2, 0], [0, 3], [2, 3]].map(([x, y], k) => (
            <Lead key={k} pts={[[u(x), u(y)], [u(x), u(y === 0 ? 0.45 : 2.55)]]} w={3.5} />
          ))}
          <rect x={u(-0.45)} y={u(0.3)} width={u(2.9)} height={u(2.4)} rx={3} fill="#2f3033" />
          <rect x={u(-0.3)} y={u(0.45)} width={u(2.6)} height={u(2.1)} rx={2} fill="#45474b" />
          {[[-0.15, 0.6], [2.15, 0.6], [-0.15, 2.4], [2.15, 2.4]].map(([x, y], k) => (
            <circle key={k} cx={u(x)} cy={u(y)} r={2} fill="#1f2022" />
          ))}
          <circle cx={u(1)} cy={u(1.5)} r={u(0.75)} fill={down ? '#111' : '#1c1c1d'} stroke="#0b0b0b" />
          <circle cx={u(1)} cy={u(1.5)} r={u(down ? 0.55 : 0.62)} fill={down ? '#2b2c2e' : '#3a3b3e'} />
        </g>
      );
    },
  },
  sch: {
    pins: { a1: pt(0, 0), b1: pt(4, 0) },
    pivot: pt(2, 0),
    bounds: { x: 0, y: u(-1.5), w: u(4), h: u(2) },
    render: (inst) => {
      const down = inst.props.pressed === 'yes';
      const y = down ? u(-0.15) : u(-0.6);
      return (
        <g>
          <line x1={0} y1={0} x2={u(1)} y2={0} {...SCH} />
          <line x1={u(3)} y1={0} x2={u(4)} y2={0} {...SCH} />
          <circle cx={u(1)} cy={0} r={2.5} fill="#1d1f22" />
          <circle cx={u(3)} cy={0} r={2.5} fill="#1d1f22" />
          <line x1={u(0.9)} y1={y} x2={u(3.1)} y2={y} {...SCH} />
          <line x1={u(2)} y1={y} x2={u(2)} y2={y - u(0.6)} {...SCH} />
          <line x1={u(1.6)} y1={y - u(0.6)} x2={u(2.4)} y2={y - u(0.6)} {...SCH} />
        </g>
      );
    },
  },
};

const slideSwitch: PartDef = {
  type: 'switch-spdt',
  title: 'Slide Switch',
  category: 'Input',
  description: 'SPDT slide switch: the middle pin connects to either side. While simulating, click it to flip.',
  labelPrefix: 'SW',
  props: [{ key: 'position', label: 'Position', kind: 'select', options: ['A', 'B'], default: 'A' }],
  connectors: [
    { id: 'A', name: 'Throw A' },
    { id: 'C', name: 'Common' },
    { id: 'B', name: 'Throw B' },
  ],
  simToggle: { key: 'position', values: ['A', 'B'] },
  sim: (i) => [{ kind: 'R', a: 'C', b: i.props.position === 'B' ? 'B' : 'A', r: 0.01 }],
  bb: {
    pins: { A: pt(0, 0), C: pt(1, 0), B: pt(2, 0) },
    pivot: pt(1, 0),
    bounds: { x: u(-0.7), y: u(-1.9), w: u(3.4), h: u(2.1) },
    render: (inst) => {
      const b = inst.props.position === 'B';
      return (
        <g>
          {[0, 1, 2].map((x) => (
            <Lead key={x} pts={[[u(x), 0], [u(x), u(-0.4)]]} />
          ))}
          <rect x={u(-0.65)} y={u(-1.5)} width={u(3.3)} height={u(1.15)} rx={2} fill="#b9bcc1" stroke="#8b8e93" />
          <rect x={u(-0.2)} y={u(-1.3)} width={u(2.4)} height={u(0.6)} rx={2} fill="#2c2d30" />
          <rect x={u(b ? 1.1 : -0.1)} y={u(-1.85)} width={u(1)} height={u(1.05)} rx={2} fill="#1b1b1d" />
          <text x={u(-0.4)} y={u(-1.65)} fontSize={7} fill="#4a4d52" fontFamily="system-ui">A</text>
          <text x={u(2.2)} y={u(-1.65)} fontSize={7} fill="#4a4d52" fontFamily="system-ui">B</text>
        </g>
      );
    },
  },
  sch: {
    pins: { C: pt(0, 0), A: pt(3, -1), B: pt(3, 1) },
    pivot: pt(1, 0),
    bounds: { x: 0, y: u(-1.3), w: u(3), h: u(2.6) },
    render: (inst) => {
      const b = inst.props.position === 'B';
      return (
        <g>
          <line x1={0} y1={0} x2={u(1)} y2={0} {...SCH} />
          <line x1={u(2.2)} y1={u(-1)} x2={u(3)} y2={u(-1)} {...SCH} />
          <line x1={u(2.2)} y1={u(1)} x2={u(3)} y2={u(1)} {...SCH} />
          <circle cx={u(1)} cy={0} r={2.5} fill="#1d1f22" />
          <circle cx={u(2.2)} cy={u(-1)} r={2.5} fill="#1d1f22" />
          <circle cx={u(2.2)} cy={u(1)} r={2.5} fill="#1d1f22" />
          <line x1={u(1)} y1={0} x2={u(2.15)} y2={b ? u(0.85) : u(-0.85)} {...SCH} />
          <text x={u(2.6)} y={u(-1.25)} fontSize={8} fill="#6b6f75">A</text>
          <text x={u(2.6)} y={u(1.55)} fontSize={8} fill="#6b6f75">B</text>
        </g>
      );
    },
  },
};

/* ---------------- Potentiometer ---------------- */

const potentiometer: PartDef = {
  type: 'potentiometer',
  title: 'Potentiometer',
  category: 'Input',
  description: 'Variable resistor with a wiper. Turn it with the Position slider — live while simulating.',
  labelPrefix: 'R',
  props: [
    { key: 'resistance', label: 'Max resistance', kind: 'select', options: ['1kΩ', '10kΩ', '50kΩ', '100kΩ'], default: '10kΩ' },
    { key: 'position', label: 'Position (%)', kind: 'range', min: 0, max: 100, default: '50' },
  ],
  connectors: [
    { id: 'p1', name: 'Leg 1' },
    { id: 'w', name: 'Wiper' },
    { id: 'p2', name: 'Leg 2' },
  ],
  valueText: (i) => i.props.resistance,
  sim: (i) => {
    const r = parseValue(i.props.resistance) || 10000;
    const f = Math.min(1, Math.max(0, Number(i.props.position) / 100));
    return [
      { kind: 'R', a: 'p1', b: 'w', r: Math.max(0.5, r * f) },
      { kind: 'R', a: 'w', b: 'p2', r: Math.max(0.5, r * (1 - f)) },
    ];
  },
  bb: {
    pins: { p1: pt(0, 0), w: pt(1, 0), p2: pt(2, 0) },
    pivot: pt(1, 0),
    bounds: { x: u(-0.6), y: u(-3.2), w: u(3.2), h: u(3.4) },
    render: (inst) => {
      const ang = -135 + 2.7 * Number(inst.props.position || 50);
      const cx = u(1), cy = u(-1.75);
      return (
        <g>
          {[0, 1, 2].map((x) => (
            <Lead key={x} pts={[[u(x), 0], [u(x), u(-0.5)]]} />
          ))}
          <rect x={u(-0.55)} y={u(-3.15)} width={u(3.1)} height={u(2.75)} rx={3} fill="#2d5fb0" stroke="#1e4482" />
          <circle cx={cx} cy={cy} r={u(1.05)} fill="#e8e6df" stroke="#a9a69c" />
          <circle cx={cx} cy={cy} r={u(0.8)} fill="#f5f3ec" />
          <g transform={`rotate(${ang} ${cx} ${cy})`}>
            <rect x={cx - 2} y={cy - u(0.8)} width={4} height={u(1.6)} rx={1.5} fill="#7c7a72" />
          </g>
        </g>
      );
    },
  },
  sch: {
    pins: { p1: pt(0, 0), p2: pt(4, 0), w: pt(2, 2) },
    pivot: pt(2, 0),
    bounds: { x: 0, y: u(-0.6), w: u(4), h: u(2.6) },
    render: () => (
      <g>
        <line x1={0} y1={0} x2={u(1)} y2={0} {...SCH} />
        <line x1={u(3)} y1={0} x2={u(4)} y2={0} {...SCH} />
        <path d={zigzag(u(1), u(3))} {...SCH} />
        <Arrow x={u(2)} y={u(2)} dx={0} dy={-u(1.55)} />
      </g>
    ),
  },
};

/* ---------------- Photocell ---------------- */

const photocell: PartDef = {
  type: 'photocell',
  title: 'Photocell (LDR)',
  category: 'Input',
  description: 'Light-dependent resistor: ~1MΩ in the dark, ~1kΩ in bright light.',
  labelPrefix: 'R',
  props: [{ key: 'light', label: 'Light level (%)', kind: 'range', min: 0, max: 100, default: '60' }],
  connectors: [
    { id: 'p0', name: 'Pin 1' },
    { id: 'p1', name: 'Pin 2' },
  ],
  valueText: (i) => formatValue(ldrOhms(i), 'Ω'),
  sim: (i) => [{ kind: 'R', a: 'p0', b: 'p1', r: ldrOhms(i) }],
  bb: {
    pins: { p0: pt(0, 0), p1: pt(1, 0) },
    pivot: pt(0, 0),
    bounds: { x: u(-0.5), y: u(-3), w: u(2), h: u(3.2) },
    render: () => (
      <g>
        <Lead pts={[[0, 0], [0, u(-1.1)]]} />
        <Lead pts={[[u(1), 0], [u(1), u(-1.1)]]} />
        <circle cx={u(0.5)} cy={u(-2)} r={u(0.95)} fill="#efe6cf" stroke="#b9ad8d" />
        <path
          d={`M${u(0)} ${u(-2.5)} h${u(0.8)} q4 0 4 4 t-4 4 h${-u(0.6)} q-4 0 -4 4 t4 4 h${u(0.6)}`}
          fill="none"
          stroke="#c3462f"
          strokeWidth={2}
        />
        <circle cx={u(0.5)} cy={u(-2)} r={u(0.95)} fill="#fff" opacity={0.15} />
      </g>
    ),
  },
  sch: twoPinSch(
    4,
    () => (
      <g>
        <path d={zigzag(u(1), u(3))} {...SCH} />
        <Arrow x={u(1.0)} y={u(-1.6)} dx={8} dy={8} />
        <Arrow x={u(1.6)} y={u(-1.6)} dx={8} dy={8} />
      </g>
    ),
    1,
    3,
  ),
};

photocell.sch!.bounds = { x: 0, y: u(-1.8), w: u(4), h: u(2.2) };

function ldrOhms(i: PartInstance): number {
  const l = Math.min(100, Math.max(0, Number(i.props.light ?? 50))) / 100;
  return Math.pow(10, 6 - 3 * l);
}

/* ---------------- Power ---------------- */

const battery: PartDef = {
  type: 'battery',
  title: 'Battery',
  category: 'Power',
  description: 'DC voltage source with leads. Red is +, black is −.',
  labelPrefix: 'VCC',
  props: [{ key: 'voltage', label: 'Voltage', kind: 'select', options: ['1.5V', '3V', '3.7V', '4.5V', '5V', '6V', '9V', '12V'], default: '9V' }],
  connectors: [
    { id: 'p', name: '+' },
    { id: 'n', name: '−' },
  ],
  valueText: (i) => i.props.voltage,
  sim: (i) => [{ kind: 'V', p: 'p', n: 'n', v: parseValue(i.props.voltage) || 9, r: 0.3 }],
  bb: {
    pins: { p: pt(0, 0), n: pt(1, 0) },
    pivot: pt(0, 0),
    bounds: { x: u(-2.6), y: u(-8.2), w: u(6.2), h: u(8.4) },
    render: (inst) => (
      <g>
        <path d={`M0 0 V${u(-1)} C0 ${u(-2)} ${u(-0.6)} ${u(-2)} ${u(-0.6)} ${u(-3)}`} stroke="#c42b22" strokeWidth={5} fill="none" strokeLinecap="round" />
        <path d={`M${u(1)} 0 V${u(-1)} C${u(1)} ${u(-2)} ${u(1.6)} ${u(-2)} ${u(1.6)} ${u(-3)}`} stroke="#1c1c1c" strokeWidth={5} fill="none" strokeLinecap="round" />
        <circle cx={0} cy={0} r={2.2} fill={LEADTIP} />
        <circle cx={u(1)} cy={0} r={2.2} fill={LEADTIP} />
        <rect x={u(-2.4)} y={u(-7.6)} width={u(5.8)} height={u(4.8)} rx={5} fill="#2a2b2e" />
        <rect x={u(-2.4)} y={u(-7.6)} width={u(5.8)} height={u(1.7)} rx={5} fill="#e17b1f" />
        <rect x={u(-2.4)} y={u(-6.3)} width={u(5.8)} height={u(0.4)} fill="#e17b1f" />
        <rect x={u(-1.5)} y={u(-8.2)} width={u(1.1)} height={u(0.6)} rx={2} fill="#b8bbc0" />
        <rect x={u(1.4)} y={u(-8.2)} width={u(1.1)} height={u(0.6)} rx={2} fill="#b8bbc0" />
        <text x={u(0.5)} y={u(-4.2)} fontSize={16} fontWeight={800} textAnchor="middle" fill="#f4f4f4" fontFamily="system-ui">
          {inst.props.voltage}
        </text>
        <text x={u(-1)} y={u(-6.55)} fontSize={11} fontWeight={800} textAnchor="middle" fill="#2a2b2e">+</text>
        <text x={u(1.95)} y={u(-6.55)} fontSize={11} fontWeight={800} textAnchor="middle" fill="#2a2b2e">−</text>
        <rect x={u(-2.25)} y={u(-5.7)} width={u(0.25)} height={u(2.7)} rx={2} fill="#fff" opacity={0.12} />
      </g>
    ),
  },
  sch: {
    pins: { p: pt(0, 0), n: pt(4, 0) },
    pivot: pt(2, 0),
    bounds: { x: 0, y: u(-1), w: u(4), h: u(2) },
    render: () => (
      <g>
        <line x1={0} y1={0} x2={u(1.55)} y2={0} {...SCH} />
        <line x1={u(2.45)} y1={0} x2={u(4)} y2={0} {...SCH} />
        <line x1={u(1.55)} y1={u(-0.75)} x2={u(1.55)} y2={u(0.75)} {...SCH} />
        <line x1={u(1.85)} y1={u(-0.4)} x2={u(1.85)} y2={u(0.4)} {...SCH} strokeWidth={3.5} />
        <line x1={u(2.15)} y1={u(-0.75)} x2={u(2.15)} y2={u(0.75)} {...SCH} />
        <line x1={u(2.45)} y1={u(-0.4)} x2={u(2.45)} y2={u(0.4)} {...SCH} strokeWidth={3.5} />
        <text x={u(1.1)} y={u(-0.45)} fontSize={11} textAnchor="middle" fill="#1d1f22">+</text>
      </g>
    ),
  },
};

const LEADTIP = '#b9bcc0';

/* ---------------- Transistor ---------------- */

const npn: PartDef = {
  type: 'npn',
  title: 'NPN Transistor',
  category: 'Core',
  description: '2N2222 in a TO-92 package (E-B-C, flat side facing you). Simulated as a saturating switch.',
  labelPrefix: 'Q',
  props: [],
  connectors: [
    { id: 'E', name: 'Emitter' },
    { id: 'B', name: 'Base' },
    { id: 'C', name: 'Collector' },
  ],
  valueText: () => '2N2222',
  sim: () => [{ kind: 'Q', b: 'B', c: 'C', e: 'E' }],
  bb: {
    pins: { E: pt(0, 0), B: pt(1, 0), C: pt(2, 0) },
    pivot: pt(1, 0),
    bounds: { x: u(-0.4), y: u(-2.8), w: u(2.8), h: u(3) },
    render: () => (
      <g>
        {[0, 1, 2].map((x) => (
          <Lead key={x} pts={[[u(x), 0], [u(x), u(-0.9)]]} />
        ))}
        <path d={`M${u(-0.35)} ${u(-0.85)} V${u(-1.9)} Q${u(-0.35)} ${u(-2.75)} ${u(1)} ${u(-2.75)} Q${u(2.35)} ${u(-2.75)} ${u(2.35)} ${u(-1.9)} V${u(-0.85)} Z`} fill="#232427" />
        <text x={u(1)} y={u(-1.55)} fontSize={6.5} textAnchor="middle" fill="#c9cbd0" fontFamily="system-ui">2N2222</text>
        <text x={u(1)} y={u(-1.05)} fontSize={5.5} textAnchor="middle" fill="#8e9196" fontFamily="system-ui">E B C</text>
      </g>
    ),
  },
  sch: {
    pins: { B: pt(0, 0), C: pt(2, -2), E: pt(2, 2) },
    pivot: pt(1, 0),
    bounds: { x: 0, y: u(-2), w: u(2.8), h: u(4) },
    render: () => (
      <g>
        <circle cx={u(1.6)} cy={0} r={u(1.15)} {...SCH} strokeWidth={1.5} />
        <line x1={0} y1={0} x2={u(1.15)} y2={0} {...SCH} />
        <line x1={u(1.15)} y1={u(-0.7)} x2={u(1.15)} y2={u(0.7)} {...SCH} strokeWidth={3} />
        <path d={`M${u(1.15)} ${u(-0.35)} L${u(2)} ${u(-0.95)} V${u(-2)}`} {...SCH} />
        <path d={`M${u(1.15)} ${u(0.35)} L${u(2)} ${u(0.95)} V${u(2)}`} {...SCH} />
        <path d={`M${u(2)} ${u(0.95)} l-8 -1 l4 -5 z`} fill="#1d1f22" />
      </g>
    ),
  },
};

/* ---------------- Buzzer & motor ---------------- */

const buzzer: PartDef = {
  type: 'buzzer',
  title: 'Piezo Buzzer',
  category: 'Output',
  description: 'Active buzzer. Beeps (visually) when current flows from + to −.',
  labelPrefix: 'J',
  props: [],
  connectors: [
    { id: 'p', name: '+' },
    { id: 'n', name: '−' },
  ],
  sim: () => [{ kind: 'D', a: 'p', k: 'n', vf: 1.0, rs: 150 }],
  bb: {
    pins: { p: pt(0, 0), n: pt(2, 0) },
    pivot: pt(1, 0),
    bounds: { x: u(-0.6), y: u(-3.4), w: u(3.2), h: u(3.6) },
    render: (_i, ctx) => {
      const on = (ctx.sim?.level ?? 0) > 0.1;
      return (
        <g>
          <Lead pts={[[0, 0], [0, u(-0.6)]]} />
          <Lead pts={[[u(2), 0], [u(2), u(-0.6)]]} />
          <circle cx={u(1)} cy={u(-1.9)} r={u(1.5)} fill="#1f2022" />
          <circle cx={u(1)} cy={u(-1.9)} r={u(1.15)} fill="#2b2c2f" />
          <circle cx={u(1)} cy={u(-1.9)} r={u(0.25)} fill="#0d0d0e" />
          <text x={u(0.2)} y={u(-2.7)} fontSize={8} fill="#aaa" fontFamily="system-ui">+</text>
          {on && (
            <g className="buzz" fill="none" stroke="#f0a020" strokeWidth={2} strokeLinecap="round">
              <path d={`M${u(2.7)} ${u(-2.6)} q6 7 0 14`} />
              <path d={`M${u(3.1)} ${u(-3.0)} q9 11 0 22`} />
              <path d={`M${u(-0.7)} ${u(-2.6)} q-6 7 0 14`} />
              <path d={`M${u(-1.1)} ${u(-3.0)} q-9 11 0 22`} />
            </g>
          )}
        </g>
      );
    },
  },
  sch: {
    pins: { p: pt(0, 0), n: pt(3, 0) },
    pivot: pt(1, 0),
    bounds: { x: 0, y: u(-1.4), w: u(3), h: u(1.6) },
    render: () => (
      <g>
        <path d={`M0 0 H${u(1)} V${u(-0.4)}`} {...SCH} />
        <path d={`M${u(3)} 0 H${u(2)} V${u(-0.4)}`} {...SCH} />
        <path d={`M${u(0.6)} ${u(-0.4)} H${u(2.4)} A${u(0.9)} ${u(0.9)} 0 0 0 ${u(0.6)} ${u(-0.4)}`} {...SCH} />
        <text x={u(0.4)} y={u(0.55)} fontSize={10} fill="#1d1f22">+</text>
      </g>
    ),
  },
};

const motor: PartDef = {
  type: 'motor',
  title: 'DC Motor',
  category: 'Output',
  description: 'Small hobby motor. Spins in the simulator when enough current flows.',
  labelPrefix: 'M',
  props: [],
  connectors: [
    { id: 'p0', name: 'Pin 1' },
    { id: 'p1', name: 'Pin 2' },
  ],
  sim: () => [{ kind: 'R', a: 'p0', b: 'p1', r: 25 }],
  bb: {
    pins: { p0: pt(0, 0), p1: pt(2, 0) },
    pivot: pt(1, 0),
    bounds: { x: u(-1.8), y: u(-5.8), w: u(5.6), h: u(6) },
    render: (inst, ctx) => {
      const lvl = ctx.sim?.level ?? 0;
      const dir = (ctx.sim?.current ?? 0) >= 0 ? 'normal' : 'reverse';
      return (
        <g>
          <path d={`M0 0 V${u(-1.3)}`} stroke="#c42b22" strokeWidth={4} strokeLinecap="round" />
          <path d={`M${u(2)} 0 V${u(-1.3)}`} stroke="#1c1c1c" strokeWidth={4} strokeLinecap="round" />
          <rect x={u(-1.5)} y={u(-4.2)} width={u(5)} height={u(3)} rx={u(1.1)} fill="#b9bdc3" stroke="#878b91" />
          <rect x={u(-1.5)} y={u(-3.9)} width={u(5)} height={u(0.4)} fill="#fff" opacity={0.35} />
          <rect x={u(0.4)} y={u(-1.4)} width={u(1.2)} height={u(0.4)} fill="#7a3d1a" />
          <rect x={u(0.9)} y={u(-5)} width={u(0.2)} height={u(0.8)} fill="#8b8f95" />
          <g
            className={lvl > 0.05 ? 'spin' : undefined}
            style={{ transformOrigin: `${u(1)}px ${u(-5)}px`, animationDuration: `${Math.max(0.12, 1.2 - lvl)}s`, animationDirection: dir }}
          >
            <ellipse cx={u(0.1)} cy={u(-5)} rx={u(0.9)} ry={u(0.28)} fill="#e65b3a" />
            <ellipse cx={u(1.9)} cy={u(-5)} rx={u(0.9)} ry={u(0.28)} fill="#e65b3a" />
            <circle cx={u(1)} cy={u(-5)} r={3} fill="#555" />
          </g>
          <text x={u(1)} y={u(-2.4)} fontSize={9} textAnchor="middle" fill="#55595f" fontFamily="system-ui" fontWeight={700}>
            {inst.label}
          </text>
        </g>
      );
    },
  },
  sch: twoPinSch(
    4,
    () => (
      <g>
        <circle cx={u(2)} cy={0} r={u(1)} {...SCH} fill="#fffef6" />
        <text x={u(2)} y={5} fontSize={14} textAnchor="middle" fill="#1d1f22" fontFamily="system-ui">M</text>
      </g>
    ),
    1,
    3,
  ),
};

/* ---------------- 555 timer ---------------- */

const T555_PINS = ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'];

function dipPins(n: number): Record<string, Pt> {
  const half = n / 2;
  const pins: Record<string, Pt> = {};
  for (let k = 1; k <= n; k++) pins[`p${k}`] = k <= half ? pt(k - 1, 3) : pt(n - k, 0);
  return pins;
}

const timer555: PartDef = {
  type: 'ic-555',
  title: '555 Timer',
  category: 'ICs',
  description: 'NE555 in a DIP-8 package. Straddle the centre channel; pin 1 is next to the notch.',
  labelPrefix: 'U',
  props: [],
  connectors: T555_PINS.map((n, i) => ({ id: `p${i + 1}`, name: `${i + 1} ${n}` })),
  valueText: () => 'NE555',
  bb: {
    pins: dipPins(8),
    pivot: pt(1, 1),
    bounds: { x: u(-0.5), y: u(-0.1), w: u(4), h: u(3.2) },
    render: () => (
      <g>
        {Object.values(dipPins(8)).map((p, k) => (
          <rect key={k} x={p.x - u(0.18)} y={p.y === 0 ? 0 : u(2.55)} width={u(0.36)} height={u(0.45)} fill="#b6b9be" />
        ))}
        <rect x={u(-0.45)} y={u(0.4)} width={u(3.9)} height={u(2.2)} rx={2} fill="#26272a" />
        <path d={`M${u(-0.45)} ${u(1.15)} A${u(0.35)} ${u(0.35)} 0 0 1 ${u(-0.45)} ${u(1.85)}`} fill="#3c3d41" />
        <circle cx={u(0)} cy={u(2.2)} r={2} fill="#3c3d41" />
        <text x={u(1.5)} y={u(1.65)} fontSize={9} textAnchor="middle" fill="#c9cbd0" fontFamily="system-ui" fontWeight={600}>NE555</text>
      </g>
    ),
  },
  sch: icSchematic(
    'NE555',
    5,
    [
      { id: 'p2', label: 'TRIG', num: '2' },
      { id: 'p6', label: 'THR', num: '6' },
      { id: 'p4', label: 'RESET', num: '4' },
      { id: 'p5', label: 'CTRL', num: '5' },
    ],
    [
      { id: 'p8', label: 'VCC', num: '8' },
      { id: 'p3', label: 'OUT', num: '3' },
      { id: 'p7', label: 'DIS', num: '7' },
      { id: 'p1', label: 'GND', num: '1' },
    ],
  ),
};

/* ---------------- Arduino Uno ---------------- */

const UNO_TOP: [string, number][] = [
  ['SCL', 8], ['SDA', 9], ['AREF', 10], ['GND1', 11], ['D13', 12], ['D12', 13], ['D11', 14], ['D10', 15], ['D9', 16], ['D8', 17],
  ['D7', 19], ['D6', 20], ['D5', 21], ['D4', 22], ['D3', 23], ['D2', 24], ['D1', 25], ['D0', 26],
];
const UNO_BOT: [string, number][] = [
  ['IOREF', 10], ['RESET', 11], ['3V3', 12], ['5V', 13], ['GND2', 14], ['GND3', 15], ['VIN', 16],
  ['A0', 18], ['A1', 19], ['A2', 20], ['A3', 21], ['A4', 22], ['A5', 23],
];
const unoPins: Record<string, Pt> = {};
UNO_TOP.forEach(([id, x]) => (unoPins[id] = pt(x, 1)));
UNO_BOT.forEach(([id, x]) => (unoPins[id] = pt(x, 20)));
const pinLabel = (id: string) => id.replace(/^GND\d/, 'GND');

function highPins(inst: PartInstance): Set<string> {
  return new Set(
    (inst.props.high ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((s) => (/^\d+$/.test(s) ? `D${s}` : s.toUpperCase())),
  );
}

const arduino: PartDef = {
  type: 'arduino-uno',
  title: 'Arduino Uno',
  category: 'Microcontrollers',
  description: 'Arduino Uno (Rev3). In the simulator it supplies 5V/3.3V and drives the pins listed under “HIGH pins”.',
  labelPrefix: 'Arduino',
  props: [{ key: 'high', label: 'HIGH pins', kind: 'text', default: '13', hint: 'Digital pins driven HIGH (5V) in the simulator, e.g. "13, 9"' }],
  connectors: [...UNO_TOP, ...UNO_BOT].map(([id]) => ({ id, name: pinLabel(id) })),
  buses: [['GND1', 'GND2', 'GND3']],
  sim: (inst) => {
    const els: ReturnType<NonNullable<PartDef['sim']>> = [
      { kind: 'V', p: '5V', n: 'GND1', v: 5, r: 0.05, tag: '5V' },
      { kind: 'V', p: '3V3', n: 'GND1', v: 3.3, r: 0.5, tag: '3V3' },
    ];
    for (const pin of highPins(inst)) if (unoPins[pin] && /^[DA]\d+$/.test(pin)) els.push({ kind: 'V', p: pin, n: 'GND1', v: 5, r: 25, tag: pin });
    return els;
  },
  bb: {
    pins: unoPins,
    pivot: pt(13, 10),
    bounds: { x: u(-1.2), y: 0, w: u(28.2), h: u(21) },
    render: (inst, ctx) => {
      const hi = highPins(inst);
      const header = (from: number, to: number, y: number) => (
        <rect x={u(from - 0.5)} y={u(y - 0.5)} width={u(to - from + 1)} height={u(1)} fill="#1a1a1b" rx={1} />
      );
      return (
        <g fontFamily="system-ui, sans-serif">
          <path
            d={`M${u(0.4)} 0 H${u(26.2)} L${u(27)} ${u(0.8)} V${u(20.2)} L${u(26.2)} ${u(21)} H${u(0.4)} Q0 ${u(21)} 0 ${u(20.6)} V${u(0.4)} Q0 0 ${u(0.4)} 0 Z`}
            fill="#13848e"
            stroke="#0c5c63"
            strokeWidth={1.5}
          />
          {[[1.5, 2.2], [26, 2.2], [1.5, 19], [25.2, 19]].map(([x, y], k) => (
            <g key={k}>
              <circle cx={u(x)} cy={u(y)} r={u(0.55)} fill="#d8dadd" />
              <circle cx={u(x)} cy={u(y)} r={u(0.35)} fill="#0f6a72" />
            </g>
          ))}
          <rect x={u(-1.2)} y={u(3.2)} width={u(5.2)} height={u(4.4)} rx={2} fill="#c3c6cb" stroke="#8d9096" />
          <rect x={u(-0.9)} y={u(4.1)} width={u(3.4)} height={u(2.6)} fill="#a6a9ae" />
          <rect x={u(-0.8)} y={u(14.4)} width={u(4.8)} height={u(3.6)} rx={2} fill="#1d1e20" />
          <circle cx={u(1.2)} cy={u(16.2)} r={u(0.9)} fill="#0d0d0e" />
          <rect x={u(13)} y={u(13.2)} width={u(11)} height={u(2.4)} rx={1.5} fill="#1d1e21" />
          <path d={`M${u(13)} ${u(14.05)} a${u(0.35)} ${u(0.35)} 0 0 1 0 ${u(0.7)}`} fill="#36373b" />
          <text x={u(18.5)} y={u(14.7)} fontSize={9} textAnchor="middle" fill="#8f9297">ATMEGA328P</text>
          <rect x={u(5.5)} y={u(2.2)} width={u(1.4)} height={u(1.4)} rx={2} fill="#c3c6cb" />
          <circle cx={u(6.2)} cy={u(2.9)} r={u(0.45)} fill="#b03b2c" />
          <text x={u(14)} y={u(8.6)} fontSize={34} fontWeight={800} fill="#fff" textAnchor="middle" fontStyle="italic" opacity={0.95}>
            UNO
          </text>
          <text x={u(20.5)} y={u(9.6)} fontSize={13} fontWeight={700} fill="#fff" textAnchor="middle" letterSpacing={1}>
            ARDUINO
          </text>
          <text x={u(14)} y={u(11.4)} fontSize={7} fill="#cfe9eb" textAnchor="middle">DIGITAL (PWM ~)</text>
          {/* status LEDs */}
          <rect x={u(9)} y={u(4)} width={u(0.7)} height={u(0.45)} fill={hi.has('D13') && ctx.simulating ? '#ffd23a' : '#d9c58b'} />
          <text x={u(10.1)} y={u(4.4)} fontSize={6} fill="#fff">L</text>
          <rect x={u(24.6)} y={u(10.4)} width={u(0.7)} height={u(0.45)} fill={ctx.simulating ? '#5dff6b' : '#9bc59f'} />
          <text x={u(24.5)} y={u(10.3)} fontSize={6} fill="#fff" textAnchor="end">ON</text>
          {ctx.simulating && <circle cx={u(24.95)} cy={u(10.6)} r={8} fill="#5dff6b" opacity={0.35} />}
          {hi.has('D13') && ctx.simulating && <circle cx={u(9.35)} cy={u(4.2)} r={8} fill="#ffd23a" opacity={0.4} />}
          {header(8, 17, 1)}
          {header(19, 26, 1)}
          {header(10, 16, 20)}
          {header(18, 23, 20)}
          {Object.entries(unoPins).map(([id, p]) => (
            <g key={id}>
              <rect x={p.x - 3} y={p.y - 3} width={6} height={6} fill="#3d3e41" />
              <text
                x={p.x + 2.5}
                y={p.y < u(10) ? p.y + u(0.75) : p.y - u(0.75)}
                fontSize={6}
                fill="#fff"
                textAnchor={p.y < u(10) ? 'end' : 'start'}
                transform={`rotate(-90 ${p.x + 2.5} ${p.y < u(10) ? p.y + u(0.75) : p.y - u(0.75)})`}
              >
                {pinLabel(id).replace(/^D/, '')}
              </text>
            </g>
          ))}
          <text x={u(13)} y={u(18.2)} fontSize={7} fill="#cfe9eb" textAnchor="middle">POWER</text>
          <text x={u(20.5)} y={u(18.2)} fontSize={7} fill="#cfe9eb" textAnchor="middle">ANALOG IN</text>
        </g>
      );
    },
  },
  sch: icSchematic(
    'Arduino Uno (Rev3)',
    8,
    ['VIN', '5V', '3V3', 'AREF', 'IOREF', 'RESET', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map((id) => ({ id, label: id })),
    ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'SDA', 'SCL'].map((id) => ({
      id,
      label: id === 'D0' ? 'D0/RX' : id === 'D1' ? 'D1/TX' : id,
    })),
    [{ id: 'GND1', label: 'GND' }],
  ),
};

export const components: PartDef[] = [
  resistor,
  ceramicCap,
  electrolytic,
  diode,
  npn,
  led,
  buzzer,
  motor,
  pushbutton,
  slideSwitch,
  potentiometer,
  photocell,
  battery,
  timer555,
  arduino,
];
