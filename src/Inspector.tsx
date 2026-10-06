import type { Doc, PartInstance, ViewId, Wire } from './types';
import { P } from './types';
import { getDef } from './parts';
import { PartThumb } from './PartsBin';
import type { Routing } from './model';
import { wireLength } from './model';
import type { SimResult } from './sim';
import { formatValue } from './parts/util';
import { connectionsOf } from './io';

export const WIRE_COLORS: [string, string][] = [
  ['#418dd9', 'Blue'], ['#cc1414', 'Red'], ['#404040', 'Black'], ['#ffe24d', 'Yellow'], ['#47cc79', 'Green'], ['#999999', 'Grey'],
  ['#ffffff', 'White'], ['#ff7033', 'Orange'], ['#a38a00', 'Ochre'], ['#33ffc4', 'Cyan'], ['#8c3b00', 'Brown'], ['#b673e6', 'Purple'],
];

interface Props {
  doc: Doc;
  view: ViewId;
  selection: Set<string>;
  routing: Routing;
  sim: SimResult | null;
  simulating: boolean;
  onPartChange: (id: string, fn: (p: PartInstance) => void, mergeKey?: string) => void;
  onWireChange: (id: string, fn: (w: Wire) => void) => void;
  onRotate: (dir: 1 | -1) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export default function Inspector(props: Props) {
  const { doc, selection, view, sim, simulating } = props;
  const parts = doc.parts.filter((p) => selection.has(p.id));
  const wires = doc.wires.filter((w) => selection.has(w.id));

  let body: React.ReactNode;
  if (parts.length === 1 && wires.length === 0) body = <PartPanel {...props} inst={parts[0]} />;
  else if (wires.length === 1 && parts.length === 0) body = <WirePanel {...props} wire={wires[0]} />;
  else if (selection.size > 1)
    body = (
      <div className="insp-section">
        <h3>{selection.size} items selected</h3>
        <p className="muted">
          {parts.length} part{parts.length === 1 ? '' : 's'}, {wires.length} wire{wires.length === 1 ? '' : 's'}
        </p>
        <div className="btn-row">
          <button onClick={() => props.onRotate(1)}>Rotate 90°</button>
          <button onClick={props.onDuplicate}>Duplicate</button>
          <button className="danger" onClick={props.onDelete}>Delete</button>
        </div>
      </div>
    );
  else
    body = (
      <div className="insp-section">
        <h3>Sketch</h3>
        <dl className="kv">
          <dt>Parts</dt>
          <dd>{doc.parts.length}</dd>
          <dt>Wires ({view === 'bb' ? 'breadboard' : 'schematic'})</dt>
          <dd>{doc.wires.filter((w) => w.view === view).length}</dd>
          <dt>Nets</dt>
          <dd>{props.routing.netsToRoute}</dd>
        </dl>
        <h4>Tips</h4>
        <ul className="tips">
          <li>Drag from a pin or breadboard hole to draw a wire.</li>
          <li>Drag the middle of a wire to add a bend point; double-click a bend to remove it.</li>
          <li>Dashed lines are <i>ratsnest</i> connections made in the other view — double-click one to turn it into a wire.</li>
          <li>Parts pressed into the breadboard connect through its strips. Moving the breadboard carries its parts.</li>
          <li>
            <kbd>R</kbd> rotate · <kbd>⌫</kbd> delete · <kbd>⌘D</kbd> duplicate · <kbd>⌘Z</kbd> undo · <kbd>Space</kbd>+drag pan
          </li>
        </ul>
      </div>
    );

  return (
    <aside className="inspector">
      <div className="panel-title">Inspector</div>
      <div className="insp-scroll">
        {body}
        {simulating && sim && (
          <div className="insp-section sim-box">
            <h4>Simulator</h4>
            {sim.warnings.length ? (
              sim.warnings.map((w, i) => (
                <div key={i} className="warn">
                  {w}
                </div>
              ))
            ) : (
              <div className="muted">Circuit OK. Hover a pin to read its voltage.</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function PartPanel({ inst, sim, simulating, view, doc, onPartChange, onRotate, onDelete, onDuplicate }: Props & { inst: PartInstance }) {
  const def = getDef(inst.type);
  const s = sim?.parts.get(inst.id);
  const conns = def.isBreadboard ? [] : connectionsOf(doc, inst);
  const pl = inst[view];
  return (
    <>
      <div className="insp-section insp-head">
        <div className="insp-thumb">
          <PartThumb def={def} view={view === 'sch' && def.sch ? 'sch' : 'bb'} size={64} />
        </div>
        <div>
          <h3>{def.title}</h3>
          <p className="muted small">{def.description}</p>
        </div>
      </div>
      <div className="insp-section">
        <label className="field">
          <span>Label</span>
          <input value={inst.label} onChange={(e) => onPartChange(inst.id, (p) => (p.label = e.target.value), `label-${inst.id}`)} />
        </label>
        {def.props.map((pd) => (
          <label className="field" key={pd.key}>
            <span>{pd.label}</span>
            {pd.kind === 'select' ? (
              <select value={inst.props[pd.key]} onChange={(e) => onPartChange(inst.id, (p) => (p.props[pd.key] = e.target.value))}>
                {[...new Set([...(pd.options ?? []), inst.props[pd.key]])].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : pd.kind === 'range' ? (
              <div className="range">
                <input
                  type="range"
                  min={pd.min}
                  max={pd.max}
                  value={inst.props[pd.key]}
                  onChange={(e) => onPartChange(inst.id, (p) => (p.props[pd.key] = e.target.value), `${pd.key}-${inst.id}`)}
                />
                <output>{inst.props[pd.key]}</output>
              </div>
            ) : pd.kind === 'bool' ? (
              <input
                type="checkbox"
                checked={inst.props[pd.key] === 'yes'}
                onChange={(e) => onPartChange(inst.id, (p) => (p.props[pd.key] = e.target.checked ? 'yes' : 'no'))}
              />
            ) : (
              <input value={inst.props[pd.key]} onChange={(e) => onPartChange(inst.id, (p) => (p.props[pd.key] = e.target.value), `${pd.key}-${inst.id}`)} />
            )}
            {pd.hint && <small className="muted">{pd.hint}</small>}
          </label>
        ))}
        <div className="field">
          <span>Placement</span>
          <div className="placement">
            <span className="mono">
              x {(pl.x / P / 10).toFixed(1)}″ · y {(pl.y / P / 10).toFixed(1)}″ · {pl.rot}°
            </span>
          </div>
        </div>
        <div className="btn-row">
          <button onClick={() => onRotate(-1)} title="Rotate 90° counter-clockwise (Shift+R)">↺ Rotate</button>
          <button onClick={() => onRotate(1)} title="Rotate 90° clockwise (R)">↻ Rotate</button>
          <button onClick={onDuplicate} title="Duplicate (⌘D)">Duplicate</button>
          <button className="danger" onClick={onDelete} title="Delete (⌫)">Delete</button>
        </div>
      </div>
      {simulating && s && (
        <div className="insp-section sim-box">
          <h4>Live readings</h4>
          <dl className="kv">
            {s.current !== undefined && (
              <>
                <dt>Current</dt>
                <dd>{formatValue(Math.abs(s.current), 'A')}</dd>
              </>
            )}
            {s.power !== undefined && (
              <>
                <dt>Power</dt>
                <dd>{formatValue(Math.abs(s.power), 'W')}</dd>
              </>
            )}
            {s.level !== undefined && (
              <>
                <dt>{inst.type === 'led' ? 'Brightness' : 'Activity'}</dt>
                <dd>{Math.round(s.level * 100)}%</dd>
              </>
            )}
          </dl>
          {s.burnt && <div className="warn">This LED has burnt out. Add a resistor in series.</div>}
        </div>
      )}
      {conns.length > 0 && (
        <div className="insp-section">
          <h4>Connections</h4>
          <table className="conn-table">
            <tbody>
              {conns.map(({ conn, root, to }) => {
                const v = simulating ? sim?.netVoltage.get(root) : undefined;
                return (
                  <tr key={conn.id}>
                    <td className={to.length ? 'ok' : 'nc'}>●</td>
                    <td>{conn.name}</td>
                    <td className="muted">{to.length ? to.join(', ') : 'not connected'}</td>
                    {simulating && <td className="mono">{v !== undefined ? formatValue(v, 'V') : ''}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function WirePanel({ wire, view, onWireChange, onDelete }: Props & { wire: Wire }) {
  const ends = wire.ends.map((e) => (e.attach ? 'connected' : 'loose'));
  return (
    <div className="insp-section">
      <h3>{view === 'bb' ? 'Jumper wire' : 'Schematic wire'}</h3>
      <dl className="kv">
        <dt>Length</dt>
        <dd>{(wireLength(wire) / P / 10).toFixed(2)}″</dd>
        <dt>Ends</dt>
        <dd>{ends.join(' · ')}</dd>
        <dt>Bend points</dt>
        <dd>{wire.bends.length}</dd>
      </dl>
      {view === 'bb' && (
        <div className="field">
          <span>Color</span>
          <div className="swatches">
            {WIRE_COLORS.map(([c, name]) => (
              <button
                key={c}
                title={name}
                className={`swatch ${wire.color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => onWireChange(wire.id, (w) => (w.color = c))}
              />
            ))}
          </div>
        </div>
      )}
      <div className="btn-row">
        {wire.bends.length > 0 && <button onClick={() => onWireChange(wire.id, (w) => (w.bends = []))}>Straighten</button>}
        <button className="danger" onClick={onDelete}>
          Delete wire
        </button>
      </div>
    </div>
  );
}
