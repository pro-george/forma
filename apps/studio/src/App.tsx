import { useEffect } from 'react';
import { useStore } from './state/store';
import { TopBar } from './components/TopBar';
import { ToolRail } from './components/ToolRail';
import { Viewport, useViewStore } from './components/Viewport';
import { Tree } from './components/Tree';
import { Inspector } from './components/Inspector';
import { StatusBar } from './components/StatusBar';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement).isContentEditable) return;
      const s = useStore.getState();
      const v = useViewStore.getState();
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (meta && k === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (meta && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (meta && k === 'g') { e.preventDefault(); e.shiftKey ? s.ungroupSelected() : s.combineSelected(); return; }
      if (meta && k === 'd') { e.preventDefault(); s.duplicateSelected(); return; }
      if (meta && k === 's') { e.preventDefault(); s.saveFile(); return; }
      if (meta && k === 'a') { e.preventDefault(); s.select(s.doc.features.filter((f) => f.parentId === null && f.visible).map((f) => f.id)); return; }
      if (meta) return;
      if (e.key === 'Escape') { if (s.tool === 'sketch') s.cancelSketch(); else s.clearSelection(); return; }
      if (e.key === 'Enter' && s.tool === 'sketch') { s.finishSketch(); return; }
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
        case 'k': s.setTool(s.tool === 'sketch' ? 'select' : 'sketch'); break;
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

function SketchHint() {
  const tool = useStore((s) => s.tool);
  const n = useStore((s) => s.sketchPoints.length);
  const s = useStore();
  if (tool !== 'sketch') return null;
  return (
    <div className="overlay-hint">
      <b>Sketch</b> click on the plate to add points ({n}) · click the first point, double-click or Enter to extrude
      <button onClick={s.finishSketch} disabled={n < 3}>Extrude</button>
      <button onClick={s.cancelSketch}>Cancel</button>
    </div>
  );
}

export default function App() {
  useShortcuts();
  const ready = useStore((s) => s.ready);
  return (
    <div className="app">
      <TopBar />
      <main className="work">
        <ToolRail />
        <section className="viewport">
          <Viewport />
          <SketchHint />
          <StatusBar />
          {!ready && <div className="loading"><div><div className="spin" />Loading geometry kernel…</div></div>}
        </section>
        <aside className="side">
          <Tree />
          <Inspector />
        </aside>
      </main>
      <Toasts />
    </div>
  );
}
