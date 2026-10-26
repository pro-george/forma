import { useEffect } from 'react';
import { useStore } from '../state/store';
import { useUI, type PanelId } from '../state/ui';
import { useSketch } from '../state/sketch';
import { ToolRail } from './ToolRail';
import { Tree } from './Tree';
import { Inspector } from './Inspector';
import { Icon } from './icons';
import { usePushPull } from '../state/pushpull';

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
  const selection = useStore((s) => s.selection);
  const sketching = useSketch((s) => !!s.active);
  const partCount = useStore((s) => s.doc.features.filter((f) => f.parentId === null).length);
  const s = useStore();
  const pushArmed = usePushPull((st) => st.armed);
  useEffect(() => { if (selection.length && !sketching) useUI.setState({ sheet: 'props' }); }, [selection, sketching]);
  useEffect(() => { if (sketching) useUI.setState({ sheet: null }); }, [sketching]);
  return (
    <>
      <header className="m-top glass-dark">
        <span className="logo">F</span>
        <input aria-label="Project name" value={s.doc.name} onChange={(e) => s.setDoc({ ...s.doc, name: e.target.value }, { undoable: false })} />
        <button className="ghost" title="Undo" disabled={!s.canUndo()} onClick={s.undo}><Icon.undo /></button>
        <button className="ghost" title="Redo" disabled={!s.canRedo()} onClick={s.redo}><Icon.redo /></button>
        <button className={pushArmed ? 'on' : ''} onClick={() => (pushArmed ? usePushPull.getState().disarm() : usePushPull.getState().arm())} title="Push / pull a face">Pull</button>
        <button className="primary" onClick={() => s.exportModel('stl')} title="Export STL"><Icon.download /></button>
      </header>
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
