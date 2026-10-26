import { create } from 'zustand';

/** View commands from outside the canvas (toolbar, keyboard, sketch editor). */
export const useViewStore = create<{
  fitToken: number;
  preset: 'iso' | 'top' | 'front' | 'right' | null;
  gizmoMode: 'translate' | 'rotate';
  /** look straight at a plane (sketch on a face) */
  align: { token: number; point: [number, number, number]; normal: [number, number, number] } | null;
  /** last pointer position on the ground plane (mm), for placing new parts */
  ground: [number, number] | null;
  setGround(g: [number, number] | null): void;
  fit(): void;
  alignTo(point: [number, number, number], normal: [number, number, number]): void;
  setPreset(p: 'iso' | 'top' | 'front' | 'right'): void;
  setGizmoMode(m: 'translate' | 'rotate'): void;
}>((set) => ({
  fitToken: 0, preset: null, gizmoMode: 'translate', align: null, ground: null,
  setGround: (ground) => set({ ground }),
  fit: () => set((s) => ({ fitToken: s.fitToken + 1 })),
  alignTo: (point, normal) => set((s) => ({ align: { token: (s.align?.token ?? 0) + 1, point, normal } })),
  setPreset: (preset) => set((s) => ({ preset, fitToken: s.fitToken + 1 })),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
}));
