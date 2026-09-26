import { useStore } from '../state/store';
import { useViewStore } from './Viewport';
import { Icon } from './icons';

export function ToolRail() {
  const s = useStore();
  const view = useViewStore();
  const primitives = [
    ['box', 'Box', 'B'], ['cylinder', 'Cylinder', 'C'], ['cone', 'Cone', ''], ['sphere', 'Sphere', 'S'], ['torus', 'Torus', ''], ['tube', 'Tube', ''], ['revolve', 'Revolve', 'V'],
  ] as const;
  return (
    <aside className="rail">
      <h3>Add</h3>
      {primitives.map(([type, label, key]) => {
        const I = Icon[type];
        return <button key={type} onClick={() => s.addPrimitive(type)}><I />{label}{key && <kbd>{key}</kbd>}</button>;
      })}
      <button className={s.tool === 'sketch' ? 'on' : ''} onClick={() => (s.tool === 'sketch' ? s.cancelSketch() : s.setTool('sketch'))}><Icon.extrude />Sketch → Extrude<kbd>K</kbd></button>

      <h3>Modules</h3>
      {s.modules.length === 0 && <div className="module-desc">Loading…</div>}
      {s.modules.map((m) => (
        <button key={m.id} onClick={() => s.addModule(m.id)} title={m.description}><Icon.module />{m.name}</button>
      ))}

      <h3>Edit</h3>
      <button onClick={s.combineSelected}><Icon.combine />Combine<kbd>⌘G</kbd></button>
      <button onClick={s.ungroupSelected}><Icon.ungroup />Ungroup</button>
      <div className="row">
        <button onClick={s.duplicateSelected} title="⌘D">Duplicate</button>
        <button onClick={s.deleteSelected} title="Delete">Delete</button>
      </div>
      <div className="row">
        <button className={view.gizmoMode === 'translate' ? 'on' : ''} onClick={() => view.setGizmoMode('translate')} title="W">Move</button>
        <button className={view.gizmoMode === 'rotate' ? 'on' : ''} onClick={() => view.setGizmoMode('rotate')} title="E">Rotate</button>
      </div>

      <h3>Camera</h3>
      <div className="row">
        <button onClick={() => view.setPreset('iso')}>Iso</button>
        <button onClick={() => view.setPreset('top')}>Top</button>
        <button onClick={() => view.setPreset('front')}>Front</button>
        <button onClick={() => view.setPreset('right')}>Right</button>
      </div>
      <button onClick={view.fit}>Fit selection / all<kbd>F</kbd></button>
    </aside>
  );
}
