/**
 * Gizmo mode for the selected body: `select` shows nothing extra, `move`
 * the translate arrows/planes, `rotate` the rings (W / E). Materializr shows
 * the gizmo on any body selection; here the body outline is always shown
 * and the handles appear with the mode, which keeps a tap from grabbing a
 * handle by accident on a tablet.
 */
import { create } from 'zustand';

export type Tool = 'select' | 'move' | 'rotate';

export const useTool = create<{ tool: Tool; set(tool: Tool): void }>((set) => ({
  tool: 'move',
  set: (tool) => set({ tool }),
}));
