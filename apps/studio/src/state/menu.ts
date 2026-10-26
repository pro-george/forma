/**
 * Radial "add here" menu: opened by right-click or long-press on the ground
 * or on a face. Remembers where it was opened in 3D so the new part lands
 * exactly there.
 */
import { create } from 'zustand';

export interface MenuHit {
  /** world point under the pointer */
  point: [number, number, number];
  /** face normal when opened on a part, else ground up */
  normal: [number, number, number];
  partId?: string;
  faceIndex?: number;
}

export const useMenu = create<{
  open: { x: number; y: number; hit: MenuHit } | null;
  show(x: number, y: number, hit: MenuHit): void;
  close(): void;
}>((set) => ({
  open: null,
  show: (x, y, hit) => set({ open: { x, y, hit } }),
  close: () => set({ open: null }),
}));

/** Long-press detector for touch: call start on pointerdown, cancel on move/up. */
export function longPress(onFire: () => void, ms = 480) {
  let timer = 0, sx = 0, sy = 0;
  return {
    start(x: number, y: number) { sx = x; sy = y; clearTimeout(timer); timer = window.setTimeout(onFire, ms); },
    move(x: number, y: number) { if (Math.hypot(x - sx, y - sy) > 8) clearTimeout(timer); },
    cancel() { clearTimeout(timer); },
  };
}
