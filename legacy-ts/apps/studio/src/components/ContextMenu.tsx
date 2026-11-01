import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { featureById, topLevel } from '@forma/core';
import { useTool } from '../state/tool';
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
  const isSketch = one?.type === 'extrude' && !!one.sketch;
  const others = topLevel(s.doc).filter((f) => !open.ids.includes(f.id));
  const isolated = others.length > 0 && others.every((f) => !f.visible);
  const shared = (
    <>
      <button onClick={run(() => { for (const f of others) if (f.visible) s.toggleVisible(f.id); for (const f of feats) if (!f.visible) s.toggleVisible(f.id); })}>Isolate</button>
      <button disabled={!isolated && others.every((f) => f.visible)} onClick={run(() => { for (const f of topLevel(s.doc)) if (!f.visible) s.toggleVisible(f.id); })}>Show All Bodies</button>
      <h6>Export</h6>
      <button onClick={run(() => { s.select(open.ids); s.exportModel('stl', true); })}>STL...</button>
      <button onClick={run(() => { s.select(open.ids); s.exportModel('obj', true); })}>OBJ...</button>
      <button onClick={run(() => { s.select(open.ids); s.exportModel('3mf', true); })}>3MF...</button>
      {one?.type === 'combine' && <button onClick={run(() => { s.select([one.id]); s.ungroupSelected(); })}>Separate</button>}
    </>
  );
  return (
    <div className="ctx" ref={ref} style={{ left: pos?.x ?? open.x, top: pos?.y ?? open.y, visibility: pos ? 'visible' : 'hidden' }} role="menu">
      <div className="ctx-title">Object · {one ? one.name : `${feats.length} parts`}</div>
      {open.face && open.face.flat && <>
        <h6>Face</h6>
        <button onClick={run(() => useSel.getState().pickFace({ partId: open.face!.partId, faceIndex: open.face!.faceIndex }, false))}>Select Face</button>
        <button onClick={run(() => { const h = faceHit(open.face!.partId, open.face!.faceIndex); if (h) useSketch.getState().startOnFace(open.face!.partId, h.point, h.normal); })}><Icon.sketch />Sketch on this Face</button>
        <button onClick={run(() => { useSel.getState().pickFace({ partId: open.face!.partId, faceIndex: open.face!.faceIndex }, false); useOp.getState().beginPushPull(); })}><Icon.pushpull />Extrude Face</button>
      </>}
      {!isSketch && <>
        <h6>Body</h6>
        {open.face && <button onClick={run(() => { useSel.getState().setNavOnly(false); useSel.getState().pickBody(open.face!.partId, false); })}>Select Body</button>}
        {shared}
      </>}
      {isSketch && <>
        <h6>Sketch</h6>
        <button onClick={run(() => useSketch.getState().start(one!.id))}><Icon.sketch />Edit Sketch</button>
        <button onClick={run(() => { s.select(open.ids); useTool.getState().set('move'); })}><Icon.move />Move</button>
        <button onClick={run(() => { s.select(open.ids); useTool.getState().set('rotate'); })}><Icon.rotate />Rotate</button>
        <button className="danger" onClick={run(() => { s.select(open.ids); s.deleteSelected(); })}><Icon.trash />Delete</button>
        {shared}
      </>}
      {EXTRAS && <>
        <hr />
        {one && <button onClick={run(rename)}>Rename <small>↵</small></button>}
        <button onClick={run(() => { s.select(open.ids); s.duplicateSelected(); })}><Icon.copy />Duplicate <small>⌘D</small></button>
        <button onClick={run(() => { for (const f of feats) if (f.visible === allHidden) s.toggleVisible(f.id); })}><Icon.eye />{allHidden ? 'Show' : 'Hide'}</button>
        <button onClick={run(() => s.toggleRole(open.ids))}><Icon.hole />{feats.every((f) => f.role === 'hole') ? 'Make solid' : 'Make hole'} <small>H</small></button>
        {feats.length > 1 && <button onClick={run(() => { s.select(open.ids); s.combineSelected(); })}><Icon.combine />Combine <small>⌘G</small></button>}
        {feats.some((f) => f.parentId === null && f.role === 'solid') && (
          <div className="ctx-slots">
            <span>Filament</span>
            {s.doc.filaments.map((fl, i) => (
              <button key={i} className={`slot${feats.every((f) => f.filament === i + 1) ? ' on' : ''}`} style={{ '--c': fl.color } as React.CSSProperties} title={`Slot ${i + 1}`}
                onClick={run(() => s.setDoc({ ...s.doc, features: s.doc.features.map((f) => (open.ids.includes(f.id) ? { ...f, filament: i + 1 } : f)) }))}><i /><span>{i + 1}</span></button>
            ))}
          </div>
        )}
      </>}
      <hr />
      {!isSketch && <button className="danger" onClick={run(() => { s.select(open.ids); s.deleteSelected(); })}><Icon.trash />Delete</button>}
      <button onClick={close}>Cancel</button>
    </div>
  );
}

/* ---------- the sketch's own long-press / right-click menu (Materializr: "Selection: n points, n lines, n curves" + Add Constraint ▸) ---------- */

export const useSketchMenu = create<{ open: { x: number; y: number } | null; show(x: number, y: number): void; close(): void }>((set) => ({
  open: null,
  show: (x, y) => set({ open: { x, y } }),
  close: () => set({ open: null }),
}));

export function SketchContextMenu() {
  const open = useSketchMenu((m) => m.open);
  const close = useSketchMenu((m) => m.close);
  const active = useSketch((k) => k.active);
  const doc = useStore((s) => s.doc);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [sub, setSub] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSub(false);
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
  }, [open, sub]);
  if (!open || !active) return null;
  const f = featureById(doc, active.featureId);
  const entities = f?.type === 'extrude' && f.sketch ? f.sketch.entities : [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const picks = active.picks.filter((p) => byId.has(p.id));
  const nPts = picks.filter((p) => p.pt).length;
  const nLines = picks.filter((p) => !p.pt && byId.get(p.id)!.type === 'line').length;
  const nCurves = picks.filter((p) => !p.pt && byId.get(p.id)!.type !== 'line').length;
  const api = useSketch.getState();
  const options = api.constraintOptions();
  const run = (fn: () => void) => () => { fn(); close(); };
  return (
    <div className="ctx" ref={ref} style={{ left: pos?.x ?? open.x, top: pos?.y ?? open.y, visibility: pos ? 'visible' : 'hidden' }} role="menu">
      <div className="ctx-title">Selection: {nPts} point{nPts === 1 ? '' : 's'}, {nLines} line{nLines === 1 ? '' : 's'}, {nCurves} curve{nCurves === 1 ? '' : 's'}</div>
      <button disabled={!options.length} onClick={() => setSub(!sub)}>Add Constraint <small>▸</small></button>
      {sub && options.map((o) => <button key={o.kind} className="sub" onClick={run(() => api.addConstraint(o.kind))}>{o.label}</button>)}
      <hr />
      <button className="danger" disabled={!picks.some((p) => !p.pt)} onClick={run(() => api.deleteSelected())}><Icon.trash />Delete</button>
      <button onClick={close}>Cancel</button>
    </div>
  );
}
