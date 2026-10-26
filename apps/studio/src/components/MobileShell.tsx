import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useUI, type PanelId } from '../state/ui';
import { useSketch } from '../state/sketch';
import { ToolRail } from './ToolRail';
import { Tree } from './Tree';
import { Inspector } from './Inspector';
import { Icon } from './icons';
import { usePushPull } from '../state/pushpull';
import { useMenu } from '../state/menu';
import { useViewStore } from '../state/view';

const TABS: { id: PanelId; label: string }[] = [
  { id: 'create', label: 'Create' },
  { id: 'parts', label: 'Parts' },
  { id: 'props', label: 'Edit' },
];

/**
 * Phone layout: the viewport fills the screen, a bottom tab bar opens one
 * glass sheet at a time. Selecting a part opens its properties; starting a
 * sketch closes the sheet so the plane is visible.
 */
export function MobileShell() {
  const sheet = useUI((s) => s.sheet);
  const open = useUI((s) => s.openSheet);
  const sketching = useSketch((s) => !!s.active);
  const partCount = useStore((s) => s.doc.features.filter((f) => f.parentId === null).length);
  const s = useStore();
  const pushArmed = usePushPull((st) => st.armed);
  const [exp, setExp] = useState(false);
  useEffect(() => { if (sketching) useUI.setState({ sheet: null }); }, [sketching]);
  return (
    <>
      <header className="m-top glass-dark">
        <span className="logo">F</span>
        <input aria-label="Project name" value={s.doc.name} onChange={(e) => s.setDoc({ ...s.doc, name: e.target.value }, { undoable: false })} />
        <button className="ghost" title="Undo" disabled={!s.canUndo()} onClick={s.undo}><Icon.undo /></button>
        <button className="ghost" title="Redo" disabled={!s.canRedo()} onClick={s.redo}><Icon.redo /></button>
        <button className={pushArmed ? 'on' : ''} onClick={() => (pushArmed ? usePushPull.getState().disarm() : usePushPull.getState().arm())} title="Push / pull a face">Pull</button>
        <button className="primary" onClick={() => setExp((v) => !v)} title="Export" aria-expanded={exp}><Icon.download /></button>
      </header>
      {exp && (
        <div className="m-export glass-strong" onClick={() => setExp(false)}>
          {(['stl', '3mf', 'obj'] as const).map((f) => <button key={f} onClick={() => s.exportModel(f)}>{f.toUpperCase()}</button>)}
        </div>
      )}
      {sheet && !sketching && (
        <section className={`m-sheet m-sheet-${sheet}`}>
          <div className="m-handle" onClick={() => open(null)} role="button" aria-label="Close" />
          <div className="m-sheet-body">
            {sheet === 'create' && <ToolRail />}
            {sheet === 'parts' && <Tree />}
            {sheet === 'props' && <Inspector />}
          </div>
        </section>
      )}
      {!sketching && !sheet && (
        <button className="m-fab" aria-label="Add here" onClick={() => {
          const g = useViewStore.getState().ground;
          useMenu.getState().show(window.innerWidth / 2, window.innerHeight / 2 - 40, { point: g ? [g[0], g[1], 0] : [0, 0, 0], normal: [0, 0, 1] });
        }}>+</button>
      )}
      {!sketching && (
        <nav className="m-tabs glass-strong">
          {TABS.map((t) => (
            <button key={t.id} className={sheet === t.id ? 'on' : ''} onClick={() => open(t.id)}>
              {t.label}{t.id === 'parts' && <span className="count">{partCount}</span>}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
