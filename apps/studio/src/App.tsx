import { useEffect } from 'react';
import { topLevel } from '@forma/core';
import { useStore } from './state/store';
import { Viewport } from './components/Viewport';
import { useViewStore } from './state/view';
import { useSketch } from './state/sketch';
import { useSel } from './state/sel';
import { useOp } from './state/op';
import { useTool } from './state/tool';
import { useUI } from './state/ui';
import { SketchHUD } from './components/SketchHUD';
import { RadialMenu } from './components/RadialMenu';
import { Shell } from './shell/Shell';
import { dispatch } from './shell/actions';
import { EXTRAS } from './features';

/**
 * Key bindings (Materializr's KeyBindings): Ctrl+Z/Y undo/redo, Ctrl+S save,
 * Ctrl+D duplicate, Ctrl+A select all, Delete, Escape (cancel the action →
 * cancel the shape → exit the sketch → clear the selection), Enter confirms
 * the action, Home resets the camera, F frames the selection, W/E gizmo
 * modes. Sketch drawing tools: L R C A (toolbar-only in Materializr; keys
 * are a convenience here).
 */
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
      const op = useOp.getState();
      if (e.key === 'Escape' && document.querySelector('.ctx, .modal-back, .popup')) return; // an open menu or dialog takes Escape itself
      if (meta && k === 'z') { e.preventDefault(); if (op.op) op.cancel(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (meta && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (meta && k === 's') { e.preventDefault(); s.saveFile(); return; }
      if (op.op) {
        if (e.key === 'Enter') { op.confirm(); return; }
        if (e.key === 'Escape') { op.cancel(); return; }
        if (/^[0-9.-]$/.test(e.key)) { const el = document.querySelector<HTMLInputElement>('.well input'); if (el) { el.focus(); el.select(); } return; }
        return;
      }
      if (sketch.active) {
        if (meta) return;
        if (/^[0-9.]$/.test(e.key)) { sketch.typeChar(e.key); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { sketch.backspace(); return; }
        if (e.key === 'Enter') { sketch.enter(); return; }
        if (sketch.active.tool === 'select' && sketch.active.selected && e.key.startsWith('Arrow')) {
          const n = e.shiftKey ? 10 : 1;
          const d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, n], ArrowDown: [0, -n] }[e.key] as [number, number] | undefined;
          if (d) { e.preventDefault(); sketch.nudgeSelected(d[0], d[1]); return; }
        }
        if (e.key === 'Escape') { if (sketch.active.draft.length) sketch.escape(); else sketch.finish(); return; }
        if (sketch.active.dimEdit) return; // the inline editor owns the keys
        const tool = ({ v: 'select', l: 'line', r: 'rect', c: 'circle', a: 'arc', g: 'polygon', t: 'trim', d: 'dim' } as const)[k as 'v'];
        if (tool) { sketch.setTool(tool); return; }
        if (k === 'f') v.fit();
        return;
      }
      if (sketch.pickingFace && e.key === 'Escape') { sketch.disarmFacePick(); return; }
      if (meta && k === 'd') { e.preventDefault(); s.duplicateSelected(); return; }
      if (meta && k === 'a') { e.preventDefault(); useSel.setState({ faces: [], edges: [], regions: [] }); s.select(topLevel(s.doc).filter((f) => f.visible).map((f) => f.id)); return; }
      if (meta) return;
      if (e.key === 'Escape') { if (useTool.getState().tool !== 'select') { useTool.getState().set('select'); return; } useSel.getState().clear(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { s.deleteSelected(); useSel.getState().clear(); return; }
      if (e.key === 'Home') { v.setPreset('iso'); return; }
      if (e.key === 'F9') { useUI.getState().setTree(!useUI.getState().tree); return; }
      const nudge = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') { s.moveSelectionBy(-nudge, 0, 0); return; }
      if (e.key === 'ArrowRight') { s.moveSelectionBy(nudge, 0, 0); return; }
      if (e.key === 'ArrowUp') { s.moveSelectionBy(0, nudge, 0); return; }
      if (e.key === 'ArrowDown') { s.moveSelectionBy(0, -nudge, 0); return; }
      const sel = useSel.getState();
      switch (k) {
        case 'w': useTool.getState().set('move'); break;
        case 'e': useTool.getState().set('rotate'); break;
        case 'f': v.fit(); break;
        case 'p': if (sel.faces.length) dispatch('pushpull'); else s.toast('Push/Pull: select a flat face first.'); break;
        case 'q': if (sel.edges.length) dispatch('fillet'); else s.toast('Fillet: click an edge first.'); break;
        case 'k': if (sel.faces.length) dispatch('sketch.face'); else if (sketch.pickingFace) sketch.disarmFacePick(); else sketch.armFacePick(); break;
        case 'h': s.toggleRole(); break;
        case 'g': s.toggleGrid(); break;
        case 'b': s.addPrimitive('box'); break;
        case 'c': s.addPrimitive('cylinder'); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Tablet gestures: a two-finger tap is undo, a three-finger tap is redo (under 300 ms, barely moved). */
function useTouchGestures() {
  useEffect(() => {
    // Active touches by pointer id (a long-press that turned into a context
    // menu can end without a pointerup, so stale entries expire after 1.5 s).
    const active = new Map<number, { x: number; y: number; t: number }>();
    let maxFingers = 0, t0 = 0, moved = false;
    const prune = (now: number) => { for (const [id, p] of active) if (now - p.t > 1500) active.delete(id); };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const now = performance.now(); prune(now);
      if (active.size === 0) { t0 = now; moved = false; maxFingers = 0; }
      active.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
      maxFingers = Math.max(maxFingers, active.size);
    };
    const move = (e: PointerEvent) => { if (e.pointerType !== 'touch') return; const p = active.get(e.pointerId); if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) moved = true; };
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      active.delete(e.pointerId);
      if (active.size === 0) {
        const quick = performance.now() - t0 < 300 && !moved;
        if (quick && maxFingers === 2) useStore.getState().undo();
        else if (quick && maxFingers === 3) useStore.getState().redo();
        maxFingers = 0;
      }
    };
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); };
  }, []);
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind ?? ''}`}>{t.text}</div>)}</div>;
}

export default function App() {
  useShortcuts();
  useTouchGestures();
  const ready = useStore((s) => s.ready);
  const touch = useUI((u) => u.touch);
  return (
    <div className={`app${touch ? ' touch' : ''}`}>
      <section className="viewport">
        <Viewport />
        {!ready && <div className="loading"><div><div className="spin" />Loading geometry kernel…</div></div>}
      </section>
      <Shell />
      {EXTRAS && <SketchHUD />}
      {EXTRAS && <RadialMenu />}
      <Toasts />
    </div>
  );
}
