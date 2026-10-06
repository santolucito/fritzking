import { memo, useMemo, useState } from 'react';
import type { PartDef, PartInstance, ViewId } from './types';
import { CATEGORIES, PART_DEFS } from './parts';

export const PartThumb = memo(function PartThumb({ def, view = 'bb', size = 56 }: { def: PartDef; view?: ViewId; size?: number }) {
  const g = (view === 'sch' ? def.sch : def.bb) ?? def.bb;
  const inst: PartInstance = {
    id: `thumb-${def.type}`,
    type: def.type,
    label: def.labelPrefix,
    props: Object.fromEntries(def.props.map((p) => [p.key, p.default])),
    bb: { x: 0, y: 0, rot: 0 },
    sch: { x: 0, y: 0, rot: 0 },
  };
  const b = g.bounds;
  const pad = Math.max(b.w, b.h) * 0.08 + 2;
  return (
    <svg width={size} height={size} viewBox={`${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`} aria-hidden>
      {g.render(inst, { view, simulating: false })}
    </svg>
  );
});

interface Props {
  view: ViewId;
  onAdd: (type: string) => void;
}

export default function PartsBin({ view, onAdd }: Props) {
  const [q, setQ] = useState('');
  const [hovered, setHovered] = useState<PartDef | null>(null);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return PART_DEFS.filter((d) => !t || `${d.title} ${d.category} ${d.description}`.toLowerCase().includes(t));
  }, [q]);

  return (
    <aside className="bin">
      <div className="panel-title">Parts</div>
      <div className="bin-search">
        <input placeholder="Search parts…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
      </div>
      <div className="bin-scroll">
        {CATEGORIES.map((cat) => {
          const defs = filtered.filter((d) => d.category === cat);
          if (!defs.length) return null;
          return (
            <section key={cat}>
              <h4>{cat}</h4>
              <div className="bin-grid">
                {defs.map((d) => {
                  const unavailable = view === 'sch' && !d.sch;
                  return (
                    <button
                      key={d.type}
                      className="bin-tile"
                      draggable
                      title={unavailable ? `${d.title} (breadboard view only)` : d.title}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-fritz-part', d.type);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => onAdd(d.type)}
                      onMouseEnter={() => setHovered(d)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <PartThumb def={d} view={view === 'sch' && d.sch ? 'sch' : 'bb'} />
                      <span>{d.title}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!filtered.length && <div className="muted pad">No parts match “{q}”.</div>}
      </div>
      <div className="bin-info">
        {hovered ? (
          <>
            <b>{hovered.title}</b>
            <p>{hovered.description}</p>
          </>
        ) : (
          <p className="muted">Drag a part onto the canvas, or click to add it to the centre of the view.</p>
        )}
      </div>
    </aside>
  );
}
