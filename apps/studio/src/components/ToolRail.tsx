import { useStore } from '../state/store';
import { useViewStore } from '../state/view';
import { useTool } from '../state/tool';
import { useSketch } from '../state/sketch';
import { usePushPull } from '../state/pushpull';
import { Icon } from './icons';

export function ToolRail() {
  const s = useStore();
  const view = useViewStore();
  const tool = useTool((t) => t.tool);
  const setTool = useTool((t) => t.set);
  const sketching = useSketch((st) => !!st.active);
  const pickingFace = useSketch((st) => st.pickingFace);
  const pushArmed = usePushPull((st) => st.armed);
  const primitives = [
    ['box', 'Box', 'B'], ['cylinder', 'Cylinder', 'C'], ['cone', 'Cone', ''], ['sphere', 'Sphere', 'S'], ['torus', 'Torus', ''], ['tube', 'Tube', ''], ['revolve', 'Revolve', 'V'],
  ] as const;
  return (
    <div className="rail">
      <h3>Add</h3>
      {primitives.map(([type, label, key]) => {
        const I = Icon[type];
        return <button key={type} onClick={() => s.addPrimitive(type)}><I />{label}{key && <kbd>{key}</kbd>}</button>;
      })}
      <button className={sketching || pickingFace ? 'on' : ''} onClick={() => (pickingFace ? useSketch.getState().disarmFacePick() : useSketch.getState().armFacePick())} title="Tap the plate or a flat face, draw an outline, then extrude it"><Icon.sketch />Sketch<kbd>K</kbd></button>

      <h3>Modules</h3>
      {s.modules.length === 0 && <div className="module-desc">Loading…</div>}
      {s.modules.map((m) => (
        <button key={m.id} onClick={() => s.addModule(m.id)} title={m.description}><Icon.module />{m.name}</button>
      ))}

      <h3>Edit</h3>
      <button className={pushArmed ? 'on' : ''} onClick={() => (pushArmed ? usePushPull.getState().disarm() : usePushPull.getState().arm())} title="Press on a flat face and drag: out adds material, in cuts"><Icon.pushpull />Push / Pull<kbd>P</kbd></button>
      <button className={tool === 'edges' ? 'on' : ''} onClick={() => setTool(tool === 'edges' ? 'select' : 'edges')} title="Round or chamfer edges of the selected part"><Icon.edges />Fillet / Chamfer<kbd>F</kbd></button>
      <button onClick={s.combineSelected}><Icon.combine />Combine<kbd>⌘G</kbd></button>
      <button onClick={s.ungroupSelected}><Icon.ungroup />Ungroup</button>
      <div className="row">
        <button onClick={s.duplicateSelected} title="⌘D">Duplicate</button>
        <button onClick={s.deleteSelected} title="Delete">Delete</button>
      </div>
      <div className="row">
        <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title="V">Select</button>
        <button className={tool === 'move' ? 'on' : ''} onClick={() => setTool('move')} title="M">Move</button>
        <button className={tool === 'rotate' ? 'on' : ''} onClick={() => setTool('rotate')} title="R">Rotate</button>
      </div>

      <h3>Camera</h3>
      <div className="row">
        <button onClick={() => view.setPreset('iso')}>Iso</button>
        <button onClick={() => view.setPreset('top')}>Top</button>
        <button onClick={() => view.setPreset('front')}>Front</button>
        <button onClick={() => view.setPreset('right')}>Right</button>
      </div>
      <button onClick={view.fit}>Fit selection / all<kbd>Z</kbd></button>
    </div>
  );
}
