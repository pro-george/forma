import { create } from 'zustand';

/** View commands from outside the canvas (toolbar, keyboard, sketch editor). */
export const useViewStore = create<{
  fitToken: number;
  preset: 'iso' | 'top' | 'front' | 'right' | null;
  gizmoMode: 'translate' | 'rotate';
  fit(): void;
  setPreset(p: 'iso' | 'top' | 'front' | 'right'): void;
  setGizmoMode(m: 'translate' | 'rotate'): void;
}>((set) => ({
  fitToken: 0, preset: null, gizmoMode: 'translate',
  fit: () => set((s) => ({ fitToken: s.fitToken + 1 })),
  setPreset: (preset) => set((s) => ({ preset, fitToken: s.fitToken + 1 })),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
}));
