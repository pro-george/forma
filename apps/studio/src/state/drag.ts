/**
 * Slide the selected parts on the plate by dragging one of them: the press
 * point is tracked on a horizontal plane at the part's height, so the part
 * follows the pointer exactly. Snaps to 1 mm (⇧ 10 mm).
 */
import { create } from 'zustand';
import { featureById, type Transform } from '@forma/core';
import { useStore } from './store';

interface Drag {
  ids: string[];
  /** world plane height the pointer is tracked on */
  z: number;
  /** pointer start on that plane */
  start: [number, number];
  /** transforms at press time */
  from: Map<string, Transform>;
  moved: boolean;
}

let lastEnd = 0;

export const useDrag = create<{
  drag: Drag | null;
  begin(ids: string[], point: [number, number, number]): void;
  /** pointer ray in world space */
  move(origin: [number, number, number], dir: [number, number, number], step: number): void;
  end(): void;
  /** true for the click that follows a real drag, so it does not reselect */
  justDragged(): boolean;
}>((set, get) => ({
  drag: null,
  justDragged: () => performance.now() - lastEnd < 300,
  begin: (ids, point) => {
    const st = useStore.getState();
    const from = new Map<string, Transform>();
    for (const id of ids) { const f = featureById(st.doc, id); if (f && f.parentId === null) from.set(id, f.transform); }
    if (from.size === 0) return;
    st.beginGesture();
    set({ drag: { ids: [...from.keys()], z: point[2], start: [point[0], point[1]], from, moved: false } });
  },
  move: (o, d, step) => {
    const g = get().drag; if (!g) return;
    if (Math.abs(d[2]) < 1e-6) return;
    const t = (g.z - o[2]) / d[2];
    if (t < 0) return;
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t;
    const dx = Math.round((x - g.start[0]) / step) * step, dy = Math.round((y - g.start[1]) / step) * step;
    if (!g.moved && dx === 0 && dy === 0) return;
    const st = useStore.getState();
    for (const id of g.ids) {
      const f0 = g.from.get(id)!;
      st.setTransform(id, { position: { x: f0.position.x + dx, y: f0.position.y + dy, z: f0.position.z } }, { undoable: false });
    }
    if (!g.moved) set({ drag: { ...g, moved: true } });
  },
  end: () => {
    const g = get().drag; if (!g) return;
    useStore.getState().endGesture();
    if (g.moved) lastEnd = performance.now();
    set({ drag: null });
  },
}));
