import { useStore } from '../state/store';
import { useSketch } from '../state/sketch';
import { Icon } from './icons';

const SHAPES = [
  ['box', 'Box', 'B'], ['cylinder', 'Cylinder', 'C'], ['cone', 'Cone', ''], ['sphere', 'Sphere', 'S'], ['torus', 'Torus', ''], ['tube', 'Tube', ''], ['revolve', 'Revolve', 'V'],
] as const;

/**
 * Everything you can add, in one place: shapes as a grid of tiles, then the
 * parametric modules. A new part lands where the pointer last touched the
 * ground, so "Add → Box" puts it where you were looking.
 */
export function AddMenu({ close }: { close: () => void }) {
  const add = useStore((s) => s.addPrimitive);
  const addModule = useStore((s) => s.addModule);
  const modules = useStore((s) => s.modules);
  return (
    <div className="addmenu">
      <h3>Shapes</h3>
      <div className="tiles">
        {SHAPES.map(([type, label, key]) => {
          const I = Icon[type];
          return <button key={type} className="tile" onClick={() => { add(type); close(); }} title={key ? `${label} (${key})` : label}><I /><span>{label}</span></button>;
        })}
        <button className="tile" onClick={() => { useSketch.getState().createAndStart(); close(); }} title="Draw an outline, then extrude it (K)"><Icon.sketch /><span>Sketch</span></button>
      </div>
      <h3>Ready-made</h3>
      <div className="mods">
        {modules.length === 0 && <div className="module-desc">Loading…</div>}
        {modules.map((m) => (
          <button key={m.id} onClick={() => { addModule(m.id); close(); }}>
            <Icon.module /><span className="nm">{m.name}</span><small>{m.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
