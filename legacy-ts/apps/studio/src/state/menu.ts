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

/** Where a long-press is currently charging, so the shell can draw the progress ring under the finger. */
export const useLongPress = create<{ pressing: { x: number; y: number; ms: number } | null }>(() => ({ pressing: null }));

/** Long-press detector for touch: call start on pointerdown, cancel on move/up. Fires after `ms` if the finger stayed within 8 px. */
export function longPress(onFire: () => void, ms = 450) {
  let timer = 0, sx = 0, sy = 0;
  const stop = () => { clearTimeout(timer); timer = 0; if (useLongPress.getState().pressing) useLongPress.setState({ pressing: null }); };
  return {
    start(x: number, y: number) { sx = x; sy = y; clearTimeout(timer); useLongPress.setState({ pressing: { x, y, ms } }); timer = window.setTimeout(() => { stop(); onFire(); }, ms); },
    move(x: number, y: number) { if (timer && Math.hypot(x - sx, y - sy) > 8) stop(); },
    cancel() { stop(); },
  };
}
