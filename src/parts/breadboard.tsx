import type { ConnectorDef, PartDef, Pt } from '../types';
import { u } from './util';

const ROWS_TOP = ['a', 'b', 'c', 'd', 'e'];
const ROWS_BOT = ['f', 'g', 'h', 'i', 'j'];

function makeBreadboard(type: string, title: string, cols: number, rails: boolean): PartDef {
  const pins: Record<string, Pt> = {};
  const connectors: ConnectorDef[] = [];
  const buses: string[][] = [];
  const off = rails ? 3 : 0; // vertical offset of terminal strips
  const yTop = (i: number) => u(1 + off + i);
  const yBot = (i: number) => u(8 + off + i);
  const xCol = (c: number) => u(c + 2);

  for (let c = 0; c < cols; c++) {
    const top: string[] = [];
    const bot: string[] = [];
    ROWS_TOP.forEach((r, i) => {
      const id = `${r}${c + 1}`;
      pins[id] = { x: xCol(c), y: yTop(i) };
      connectors.push({ id, name: id.toUpperCase() });
      top.push(id);
    });
    ROWS_BOT.forEach((r, i) => {
      const id = `${r}${c + 1}`;
      pins[id] = { x: xCol(c), y: yBot(i) };
      connectors.push({ id, name: id.toUpperCase() });
      bot.push(id);
    });
    buses.push(top, bot);
  }

  const railRows: { key: string; y: number; name: string }[] = rails
    ? [
        { key: 'tp', y: u(1), name: 'Top +' },
        { key: 'tn', y: u(2), name: 'Top −' },
        { key: 'bn', y: u(17), name: 'Bottom −' },
        { key: 'bp', y: u(18), name: 'Bottom +' },
      ]
    : [];
  for (const rr of railRows) {
    const bus: string[] = [];
    for (let c = 0; c < cols; c++) {
      if (c % 6 === 5) continue; // rails come in groups of five
      const id = `${rr.key}${c + 1}`;
      pins[id] = { x: xCol(c), y: rr.y };
      connectors.push({ id, name: `${rr.name} ${c + 1}` });
      bus.push(id);
    }
    buses.push(bus);
  }

  const w = u(cols + 3);
  const h = rails ? u(19) : u(13);
  const holeIds = Object.keys(pins);
  const hs = u(0.42);

  return {
    type,
    title,
    category: 'Core',
    description: `Solderless breadboard with ${cols} columns${rails ? ' and power rails' : ''}. Each column of five holes (a–e, f–j) is connected; rails run along the edges.`,
    labelPrefix: 'BB',
    props: [],
    connectors,
    buses,
    isBreadboard: true,
    bb: {
      pins,
      pivot: { x: u(Math.round((cols + 3) / 2)), y: u(rails ? 10 : 7) },
      bounds: { x: 0, y: 0, w, h },
      render: () => (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={8} fill="#eeede6" stroke="#cbc9bf" strokeWidth={1.5} />
          <rect x={u(1)} y={u(off + 6.1)} width={w - u(2)} height={u(0.8)} rx={3} fill="#dcdad1" />
          {rails && (
            <>
              <rect x={u(0.6)} y={u(0.35)} width={w - u(1.2)} height={u(2.3)} rx={4} fill="#e6e4dc" />
              <rect x={u(0.6)} y={u(16.35)} width={w - u(1.2)} height={u(2.3)} rx={4} fill="#e6e4dc" />
              <line x1={u(1.5)} x2={w - u(1.5)} y1={u(0.45)} y2={u(0.45)} stroke="#d8443a" strokeWidth={2} />
              <line x1={u(1.5)} x2={w - u(1.5)} y1={u(2.55)} y2={u(2.55)} stroke="#3a6fd8" strokeWidth={2} />
              <line x1={u(1.5)} x2={w - u(1.5)} y1={u(16.45)} y2={u(16.45)} stroke="#3a6fd8" strokeWidth={2} />
              <line x1={u(1.5)} x2={w - u(1.5)} y1={u(18.55)} y2={u(18.55)} stroke="#d8443a" strokeWidth={2} />
              <g fontSize={11} fontWeight={700} textAnchor="middle" fontFamily="system-ui">
                <text x={u(0.9)} y={u(1) + 4} fill="#d8443a">+</text>
                <text x={u(0.9)} y={u(2) + 4} fill="#3a6fd8">−</text>
                <text x={u(0.9)} y={u(17) + 4} fill="#3a6fd8">−</text>
                <text x={u(0.9)} y={u(18) + 4} fill="#d8443a">+</text>
                <text x={w - u(0.9)} y={u(1) + 4} fill="#d8443a">+</text>
                <text x={w - u(0.9)} y={u(2) + 4} fill="#3a6fd8">−</text>
                <text x={w - u(0.9)} y={u(17) + 4} fill="#3a6fd8">−</text>
                <text x={w - u(0.9)} y={u(18) + 4} fill="#d8443a">+</text>
              </g>
            </>
          )}
          <g fontSize={8} fill="#9a988f" textAnchor="middle" fontFamily="system-ui">
            {[...ROWS_TOP, ...ROWS_BOT].map((r, i) => {
              const y = i < 5 ? yTop(i) : yBot(i - 5);
              return (
                <g key={r}>
                  <text x={u(0.9)} y={y + 3}>{r}</text>
                  <text x={w - u(0.9)} y={y + 3}>{r}</text>
                </g>
              );
            })}
            {Array.from({ length: cols }, (_, c) =>
              c === 0 || (c + 1) % 5 === 0 ? (
                <g key={c}>
                  <text x={xCol(c)} y={yTop(0) - u(0.55)}>{c + 1}</text>
                  <text x={xCol(c)} y={yBot(4) + u(0.85)}>{c + 1}</text>
                </g>
              ) : null,
            )}
          </g>
          <g fill="#4a4a48">
            {holeIds.map((id) => (
              <rect key={id} x={pins[id].x - hs / 2} y={pins[id].y - hs / 2} width={hs} height={hs} rx={1.5} />
            ))}
          </g>
        </g>
      ),
    },
  };
}

export const breadboards: PartDef[] = [
  makeBreadboard('breadboard-half', 'Breadboard (half+)', 30, true),
  makeBreadboard('breadboard-full', 'Breadboard (full)', 60, true),
  makeBreadboard('breadboard-mini', 'Breadboard (mini)', 17, false),
];
