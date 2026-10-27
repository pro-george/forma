import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { useViewStore } from '../state/view';
import { useSketch } from '../state/sketch';
import { usePushPull } from '../state/pushpull';
import { useEdges } from '../state/edges';
import { Icon } from './icons';
import { AddMenu } from './AddMenu';

/** A button that opens a popover under itself; closes on outside click or Escape. */
export function Dropdown({ label, title, children, className = '', align = 'left', open: controlled, onOpenChange }: {
  label: ReactNode; title?: string; children: (close: () => void) => ReactNode; className?: string; align?: 'left' | 'right' | 'center'; open?: boolean; onOpenChange?: (v: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (v: boolean) => { setOwn(v); onOpenChange?.(v); };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <div className={`dd ${className}`} ref={ref}>
      <button className={`tool${open ? ' open' : ''}`} title={title} onClick={() => setOpen(!open)} aria-expanded={open}>{label}</button>
      {open && <div className={`popover ${align}`} role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function Tool({ icon, label, title, on, disabled, onClick }: { icon: ReactNode; label: string; title: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`tool${on ? ' on' : ''}`} title={title} disabled={disabled} onClick={onClick} aria-pressed={on}>
      {icon}<span>{label}</span>
    </button>
  );
}

const Sep = () => <i className="tsep" />;

/**
 * The top bar: project on the left, tools in the middle, undo/export on the
 * right. Tools are modes you can see — the active one is lit — so the
 * viewport always tells you what a click will do.
 */
export function Toolbar() {
  const s = useStore();
  const view = useViewStore();
  const sketching = useSketch((st) => !!st.active);
  const pickingFace = useSketch((st) => st.pickingFace);
  const pushArmed = usePushPull((st) => st.armed);
  const edgeMode = useEdges((st) => !!st.selected);
  const fileInput = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  const idle = !sketching && !pickingFace && !pushArmed;
  const selectMode = () => { useSketch.getState().disarmFacePick(); usePushPull.getState().disarm(); useEdges.getState().clear(); };

  return (
    <>
      <header className="bar bar-left glass-dark">
        <span className="logo">F</span>
        <input aria-label="Project name" value={s.doc.name} onChange={(e) => s.setDoc({ ...s.doc, name: e.target.value }, { undoable: false })} />
        <Dropdown label={<><Icon.file /><span>File</span></>} title="New, open, save">{(close) => (
          <div className="menu-list">
            <button onClick={() => { s.newDocument(); close(); }}>New <small>empty scene</small></button>
            <button onClick={() => { s.loadSample(); close(); }}>Open sample scene</button>
            <hr />
            <button onClick={() => { fileInput.current?.click(); close(); }}>Open .forma…</button>
            <button onClick={() => { s.saveFile(); close(); }}>Save .forma <small>⌘S</small></button>
          </div>
        )}</Dropdown>
        <input ref={fileInput} type="file" accept=".forma,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) s.openFile(f); e.target.value = ''; }} />
      </header>

      <nav className="bar bar-tools glass-dark" aria-label="Tools">
        <Tool icon={<Icon.select />} label="Select" title="Select and move parts (Esc)" on={idle && !edgeMode} onClick={selectMode} />
        <Dropdown label={<><Icon.plus /><span>Add</span></>} title="Add a shape, a sketch or a module">{(close) => <AddMenu close={close} />}</Dropdown>
        <Dropdown label={<><Icon.sketch /><span>Sketch</span></>} title="Draw a 2D sketch and extrude it (K)" className={sketching || pickingFace ? 'lit' : ''}>{(close) => (
          <div className="menu-list">
            <button onClick={() => { useSketch.getState().createAndStart(); close(); }}><Icon.sketch />On the ground <small>K</small></button>
            <button onClick={() => { useSketch.getState().armFacePick(); close(); }}><Icon.sketchFace />On a face of a part <small>⇧K</small></button>
          </div>
        )}</Dropdown>
        <Tool icon={<Icon.pushpull />} label="Push/Pull" title="Press a flat face and drag: out adds, in cuts (P)" on={pushArmed} onClick={() => (pushArmed ? usePushPull.getState().disarm() : usePushPull.getState().arm())} />
        <Tool icon={<Icon.combine />} label="Combine" title="Union, cut or intersect the selected parts (⌘G)" disabled={s.selection.length < 2} onClick={s.combineSelected} />
        <Sep />
        <Tool icon={<Icon.move />} label="Move" title="Move gizmo (W)" on={view.gizmoMode === 'translate'} onClick={() => view.setGizmoMode('translate')} />
        <Tool icon={<Icon.rotate />} label="Rotate" title="Rotate gizmo (E)" on={view.gizmoMode === 'rotate'} onClick={() => view.setGizmoMode('rotate')} />
        <Sep />
        <Tool icon={<Icon.grid />} label="Grid" title="Build plate grid (G)" on={s.showGrid} onClick={s.toggleGrid} />
        <Tool icon={<Icon.wire />} label="Wire" title="Wireframe" on={s.wireframe} onClick={s.toggleWireframe} />
        <Tool icon={<Icon.light />} label="Print" title="Matte PLA shading with a hard light: see relief the way the print will show it" on={s.printLook} onClick={s.togglePrintLook} />
        <Dropdown label={<><Icon.camera /><span>View</span></>} title="Camera presets" align="right">{(close) => (
          <div className="menu-list">
            {(['iso', 'top', 'front', 'right'] as const).map((p) => <button key={p} onClick={() => { view.setPreset(p); close(); }}>{p[0]!.toUpperCase() + p.slice(1)}</button>)}
            <hr />
            <button onClick={() => { view.fit(); close(); }}>Fit selection / all <small>F</small></button>
            <button onClick={() => { s.arrangeParts(); view.fit(); close(); }} title="Lay the parts out in rows on a 256 mm plate, no overlaps">Arrange parts on plate</button>
          </div>
        )}</Dropdown>
      </nav>

      <div className="bar bar-right glass-dark">
        <button className="tool" title="Undo (⌘Z)" disabled={!s.canUndo()} onClick={s.undo}><Icon.undo /></button>
        <button className="tool" title="Redo (⇧⌘Z)" disabled={!s.canRedo()} onClick={s.redo}><Icon.redo /></button>
        <Dropdown className="primary" align="right" label={<><Icon.download /><span>Export</span></>} title="Download for your slicer">{(close) => (
          <div className="menu-list export">
            <button onClick={() => { s.exportModel('bambu'); close(); }}><b>3MF for Bambu Studio</b><small>parts land in AMS slots · also Orca</small></button>
            <button onClick={() => { s.exportModel('3mf'); close(); }}><b>3MF with colours</b><small>PrusaSlicer, Cura</small></button>
            <button onClick={() => { s.exportModel('stl'); close(); }}><b>STL</b><small>one unioned shell</small></button>
            <button onClick={() => { s.exportModel('obj'); close(); }}><b>OBJ</b><small>for other 3D apps</small></button>
            {s.selection.length > 0 && <>
              <hr />
              <button onClick={() => { s.exportModel('bambu', true); close(); }}>Selection as 3MF <small>{s.selection.length} part{s.selection.length > 1 ? 's' : ''}</small></button>
              <button onClick={() => { s.exportModel('stl', true); close(); }}>Selection as STL</button>
            </>}
          </div>
        )}</Dropdown>
      </div>
    </>
  );
}
