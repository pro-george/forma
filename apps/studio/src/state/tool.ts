/**
 * The active tool — one at a time, like Blender's toolbar or Fusion's
 * commands. The viewport reads it to decide what a press means:
 *
 *  select    click selects a part; drag a part to slide it on the plate
 *  move      the same, plus a gizmo with axis arrows and plane squares
 *  rotate    a gizmo with rings; drag a ring to turn the part
 *  pushpull  flat faces light up; press one and drag along its normal, or
 *            click it and type a distance
 *  edges     edges of the selected part light up; click to pick, then
 *            round or chamfer them
 *
 * Sketching is its own mode (state/sketch.ts) that sits on top of this.
 */
import { create } from 'zustand';
import { usePushPull } from './pushpull';
import { useEdges } from './edges';

export type Tool = 'select' | 'move' | 'rotate' | 'pushpull' | 'edges';

export const TOOL_INFO: Record<Tool, { name: string; key: string; what: string }> = {
  select: { name: 'Select', key: 'V', what: 'Click a part to select it, drag it to slide it on the plate.' },
  move: { name: 'Move', key: 'M', what: 'Drag an arrow to move along one axis, a square to move in a plane, or the part itself to slide it on the plate.' },
  rotate: { name: 'Rotate', key: 'R', what: 'Drag a ring to turn the part around that axis, in 5° steps.' },
  pushpull: { name: 'Push / Pull', key: 'P', what: 'Press a flat face and drag: pull out to add material, push in to cut. Or click a face and type a distance.' },
  edges: { name: 'Fillet', key: 'F', what: 'Click an edge of the selected part (⇧ adds more), then choose Round or Chamfer and a size.' },
};

export const useTool = create<{
  tool: Tool;
  set(tool: Tool): void;
}>((set) => ({
  tool: 'select',
  set: (tool) => {
    set({ tool });
    usePushPull.setState({ armed: tool === 'pushpull', pending: null, typed: '' });
    if (tool !== 'edges') useEdges.getState().clear();
  },
}));
