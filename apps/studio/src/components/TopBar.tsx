import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Icon } from './icons';

function Menu({ label, children, primary }: { label: React.ReactNode; children: (close: () => void) => React.ReactNode; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={primary ? 'primary' : ''} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{label}</button>
      {open && <div className="popover" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function TopBar() {
  const s = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">F</span>
        <input aria-label="Project name" value={s.doc.name} onChange={(e) => s.setDoc({ ...s.doc, name: e.target.value }, { undoable: false })} />
      </div>
      <Menu label="File">{(close) => (
        <>
          <button onClick={() => { s.newDocument(); close(); }}>New <small>empty scene</small></button>
          <button onClick={() => { s.loadSample(); close(); }}>Open sample scene</button>
          <hr />
          <button onClick={() => { fileInput.current?.click(); close(); }}>Open .forma…</button>
          <button onClick={() => { s.saveFile(); close(); }}>Save .forma <small>⌘S</small></button>
        </>
      )}</Menu>
      <div className="group">
        <button className="ghost" title="Undo (⌘Z)" disabled={!s.canUndo()} onClick={s.undo}><Icon.undo /></button>
        <button className="ghost" title="Redo (⇧⌘Z)" disabled={!s.canRedo()} onClick={s.redo}><Icon.redo /></button>
      </div>
      <div className="spacer" />
      <div className="group">
        <button className={s.showGrid ? 'on' : ''} onClick={s.toggleGrid}>Grid</button>
        <button className={s.wireframe ? 'on' : ''} onClick={s.toggleWireframe}>Wire</button>
      </div>
      <Menu primary label={<><Icon.download /> Export</>}>{(close) => (
        <>
          <button onClick={() => { s.exportModel('stl'); close(); }}>STL <small>one unioned shell</small></button>
          <button onClick={() => { s.exportModel('3mf'); close(); }}>3MF <small>one object per part</small></button>
          <hr />
          <button disabled={!s.selection.length} onClick={() => { s.exportModel('stl', true); close(); }}>STL of selection</button>
          <button disabled={!s.selection.length} onClick={() => { s.exportModel('3mf', true); close(); }}>3MF of selection</button>
        </>
      )}</Menu>
      <input ref={fileInput} type="file" accept=".forma,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) s.openFile(f); e.target.value = ''; }} />
    </header>
  );
}
