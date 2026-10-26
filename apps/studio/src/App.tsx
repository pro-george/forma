import { useEffect } from 'react';
import { useStore } from './state/store';
import { TopBar } from './components/TopBar';
import { ToolRail } from './components/ToolRail';
import { Viewport } from './components/Viewport';
import { useViewStore } from './state/view';
import { useSketch } from './state/sketch';
import { SketchHUD } from './components/SketchHUD';
import { Tree } from './components/Tree';
import { Inspector } from './components/Inspector';
import { StatusBar } from './components/StatusBar';
import { Panel } from './components/Panel';
import { MobileShell } from './components/MobileShell';
import { useIsMobile } from './state/media';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement).isContentEditable) return;
      const s = useStore.getState();
      const v = useViewStore.getState();
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const sketch = useSketch.getState();
      if (sketch.active) {
        if (meta && k === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
        if (meta) return;
        if (/^[0-9.]$/.test(e.key)) { sketch.typeChar(e.key); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { sketch.backspace(); return; }
        if (e.key === 'Enter') { sketch.enter(); return; }
        if (e.key === 'Escape') { sketch.escape(); return; }
        const tool = ({ v: 'select', l: 'line', r: 'rect', c: 'circle', a: 'arc' } as const)[k as 'v' | 'l' | 'r' | 'c' | 'a'];
        if (tool) { sketch.setTool(tool); return; }
        if (k === 'f') v.fit();
        return;
      }
      if (sketch.pickingFace && e.key === 'Escape') { sketch.disarmFacePick(); return; }
      if (meta && k === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (meta && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (meta && k === 'g') { e.preventDefault(); e.shiftKey ? s.ungroupSelected() : s.combineSelected(); return; }
      if (meta && k === 'd') { e.preventDefault(); s.duplicateSelected(); return; }
      if (meta && k === 's') { e.preventDefault(); s.saveFile(); return; }
      if (meta && k === 'a') { e.preventDefault(); s.select(s.doc.features.filter((f) => f.parentId === null && f.visible).map((f) => f.id)); return; }
      if (meta) return;
      if (e.key === 'Escape') { s.clearSelection(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { s.deleteSelected(); return; }
      const nudge = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') { s.moveSelectionBy(-nudge, 0, 0); return; }
      if (e.key === 'ArrowRight') { s.moveSelectionBy(nudge, 0, 0); return; }
      if (e.key === 'ArrowUp') { s.moveSelectionBy(0, nudge, 0); return; }
      if (e.key === 'ArrowDown') { s.moveSelectionBy(0, -nudge, 0); return; }
      switch (k) {
        case 'b': s.addPrimitive('box'); break;
        case 'c': s.addPrimitive('cylinder'); break;
        case 's': s.addPrimitive('sphere'); break;
        case 'v': s.addPrimitive('revolve'); break;
        case 'k': e.shiftKey ? sketch.armFacePick() : sketch.createAndStart(); break;
        case 'h': s.toggleRole(); break;
        case 'r': s.rotateSelected(e.shiftKey ? -90 : 90); break;
        case 'w': v.setGizmoMode('translate'); break;
        case 'e': v.setGizmoMode('rotate'); break;
        case 'f': v.fit(); break;
        case 'g': s.toggleGrid(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind ?? ''}`}>{t.text}</div>)}</div>;
}

export default function App() {
  useShortcuts();
  const ready = useStore((s) => s.ready);
  const selection = useStore((s) => s.selection);
  const partCount = useStore((s) => s.doc.features.filter((f) => f.parentId === null).length);
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <div className="app mobile">
        <section className="viewport">
          <Viewport />
          {!ready && <div className="loading"><div><div className="spin" />Loading geometry kernel…</div></div>}
        </section>
        <MobileShell />
        <SketchHUD />
        <Toasts />
      </div>
    );
  }
  return (
    <div className="app">
      <section className="viewport">
        <Viewport />
        {!ready && <div className="loading"><div><div className="spin" />Loading geometry kernel…</div></div>}
      </section>
      <TopBar />
      <SketchHUD />
      <div className="dock left">
        <Panel id="create" title="Create" side="left"><ToolRail /></Panel>
      </div>
      <div className="dock right">
        <Panel id="parts" title="Parts" side="right" badge={<span className="count">{partCount}</span>}><Tree /></Panel>
        <Panel id="props" title={selection.length ? 'Properties' : 'Scene'} side="right"><Inspector /></Panel>
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}
