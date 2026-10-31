import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { featureById } from '@forma/core';
import { useStore } from '../state/store';
import { useSel } from '../state/sel';
import { useOp } from '../state/op';
import { useSketch } from '../state/sketch';
import { faceHit } from '../shell/actions';
import { Icon } from './icons';
import { EXTRAS } from '../features';

/** Right-click menu for parts, shared by the Layers list and the timeline. */
export interface FaceHit { partId: string; faceIndex: number; flat: boolean }
export const useContextMenu = create<{
  open: { x: number; y: number; ids: string[]; face?: FaceHit } | null;
  show(x: number, y: number, ids: string[], face?: FaceHit): void;
  close(): void;
}>((set) => ({
  open: null,
  show: (x, y, ids, face) => set({ open: { x, y, ids, face } }),
  close: () => set({ open: null }),
}));

/** Attach to a row: opens the menu for that part (and the rest of the selection if it is in it). */
export function onPartContext(id: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const s = useStore.getState();
    const ids = s.selection.includes(id) ? s.selection : [id];
    if (!s.selection.includes(id)) s.select([id]);
    useContextMenu.getState().show(e.clientX, e.clientY, ids);
  };
}

export function ContextMenu() {
  const open = useContextMenu((m) => m.open);
  const close = useContextMenu((m) => m.close);
  const s = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.ctx')) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); };
  }, [open, close]);
  useLayoutEffect(() => {
    if (!open || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(open.x, window.innerWidth - r.width - 8), y: Math.min(open.y, window.innerHeight - r.height - 8) });
  }, [open]);
  if (!open) return null;
  const feats = open.ids.map((id) => featureById(s.doc, id)).filter((f): f is NonNullable<typeof f> => !!f);
  if (!feats.length) return null;
  const one = feats.length === 1 ? feats[0]! : null;
  const allHidden = feats.every((f) => !f.visible);
  const run = (fn: () => void) => () => { fn(); close(); };
  const rename = () => {
    s.select([feats[0]!.id]);
    requestAnimationFrame(() => { const el = document.getElementById('f-name') as HTMLInputElement | null; el?.focus(); el?.select(); });
  };
  return (
    <div className="ctx" ref={ref} style={{ left: pos?.x ?? open.x, top: pos?.y ?? open.y, visibility: pos ? 'visible' : 'hidden' }} role="menu">
      <div className="ctx-title">Object · {one ? one.name : `${feats.length} parts`}</div>
      {open.face && open.face.flat && <>
        <h6>Face</h6>
        <button onClick={run(() => useSel.getState().pickFace({ partId: open.face!.partId, faceIndex: open.face!.faceIndex }, false))}>Select Face</button>
        <button onClick={run(() => { const h = faceHit(open.face!.partId, open.face!.faceIndex); if (h) useSketch.getState().startOnFace(open.face!.partId, h.point, h.normal); })}><Icon.sketch />Sketch on this Face</button>
        <button onClick={run(() => { useSel.getState().pickFace({ partId: open.face!.partId, faceIndex: open.face!.faceIndex }, false); useOp.getState().beginPushPull(); })}><Icon.pushpull />Push/Pull Face</button>
        <h6>Body</h6>
        <button onClick={run(() => { useSel.getState().setNavOnly(false); useSel.getState().pickBody(open.face!.partId, false); })}>Select Body</button>
      </>}
      {one && <button onClick={run(rename)}>Rename <small>↵</small></button>}
      <button onClick={run(() => { s.select(open.ids); s.duplicateSelected(); })}><Icon.copy />Duplicate <small>⌘D</small></button>
      <button onClick={run(() => { for (const f of feats) if (f.visible === allHidden) s.toggleVisible(f.id); })}><Icon.eye />{allHidden ? 'Show' : 'Hide'}</button>
      <button onClick={run(() => s.toggleRole(open.ids))}><Icon.hole />{feats.every((f) => f.role === 'hole') ? 'Make solid' : 'Make hole'} <small>H</small></button>
      {feats.length > 1 && <button onClick={run(() => { s.select(open.ids); s.combineSelected(); })}><Icon.combine />Combine <small>⌘G</small></button>}
      {one?.type === 'combine' && <button onClick={run(() => { s.select([one.id]); s.ungroupSelected(); })}><Icon.ungroup />Ungroup</button>}
      {EXTRAS && feats.some((f) => f.parentId === null && f.role === 'solid') && (
        <div className="ctx-slots">
          <span>Filament</span>
          {s.doc.filaments.map((fl, i) => (
            <button key={i} className={`slot${feats.every((f) => f.filament === i + 1) ? ' on' : ''}`} style={{ '--c': fl.color } as React.CSSProperties} title={`Slot ${i + 1}`}
              onClick={run(() => s.setDoc({ ...s.doc, features: s.doc.features.map((f) => (open.ids.includes(f.id) ? { ...f, filament: i + 1 } : f)) }))}><i /><span>{i + 1}</span></button>
          ))}
        </div>
      )}
      <hr />
      <button className="danger" onClick={run(() => { s.select(open.ids); s.deleteSelected(); })}><Icon.trash />Delete <small>⌫</small></button>
    </div>
  );
}
