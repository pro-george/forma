/**
 * The tool catalogue: which tools the dock offers for the current selection
 * context, in order, with the sentence each tooltip shows. One list, read by
 * every layout (Toolbar::railTools in Materializr). Tools that would fail
 * on the selection are left out rather than offered and refused.
 */
import type { SelContext } from '../state/sel';
import type { Icon } from '../components/icons';
import { EXTRAS } from '../features';

export type ActionId =
  | 'sketch.xy' | 'sketch.xz' | 'sketch.yz' | 'sketch.face' | 'sketch.edit'
  | 'prim.box' | 'prim.cylinder' | 'prim.sphere' | 'prim.cone' | 'prim.torus' | 'prim.tube' | 'prim.revolve'
  | 'module' // + id
  | 'pushpull' | 'fillet' | 'chamfer'
  | 'move' | 'rotate' | 'mirror' | 'split' | 'duplicate' | 'delete' | 'pattern.linear' | 'pattern.circular'
  | 'bool.union' | 'bool.subtract' | 'bool.intersect' | 'ungroup' | 'hole'
  | 'measure' | 'frame'
  | 'sk.select' | 'sk.line' | 'sk.rect' | 'sk.circle' | 'sk.arc' | 'sk.polygon' | 'sk.trim' | 'sk.finish' | 'sk.exit' | 'sk.lookat';

export interface RailTool {
  id: ActionId;
  label: string;
  icon: keyof typeof Icon;
  tip: string;
  /** opens a popup of children instead of firing */
  children?: RailTool[];
  /** module id for 'module' actions */
  arg?: string;
}

export const SKETCH_PLANES: RailTool[] = [
  { id: 'sketch.xy', label: 'XY plane', icon: 'grid', tip: 'Sketch on the build plate (top view).' },
  { id: 'sketch.xz', label: 'XZ plane', icon: 'grid', tip: 'Sketch on the front plane.' },
  { id: 'sketch.yz', label: 'YZ plane', icon: 'grid', tip: 'Sketch on the side plane.' },
];

export const PRIMITIVES: RailTool[] = [
  { id: 'prim.box', label: 'Box', icon: 'box', tip: 'Add a box.' },
  { id: 'prim.cylinder', label: 'Cylinder', icon: 'cylinder', tip: 'Add a cylinder.' },
  { id: 'prim.sphere', label: 'Sphere', icon: 'sphere', tip: 'Add a sphere.' },
  { id: 'prim.cone', label: 'Cone', icon: 'cone', tip: 'Add a cone.' },
  { id: 'prim.torus', label: 'Torus', icon: 'torus', tip: 'Add a torus.' },
  { id: 'prim.tube', label: 'Tube', icon: 'tube', tip: 'Add a tube (a cylinder with a bore).' },
  { id: 'prim.revolve', label: 'Revolve', icon: 'revolve', tip: 'Add a lathed shape: a side profile spun around the vertical axis.' },
];

export function railTools(ctx: SelContext, opts: { bodies: number; modules: { id: string; name: string; description: string }[]; selectedIsCombine: boolean; selectedIsModule: boolean; ortho: boolean; inSketch?: boolean }): RailTool[] {
  switch (ctx) {
    case 'sketch':
      return [
        { id: 'sk.select', label: 'Select', icon: 'select', tip: 'Pick sketch elements (points, lines, regions). Drag a selection to move it.' },
        { id: 'sk.line', label: 'Line', icon: 'line', tip: 'Draw straight line segments. Tap to add vertices; Finish ends the chain.' },
        { id: 'sk.circle', label: 'Circle', icon: 'circle', tip: 'Draw a circle: centre then a point on it, or two ends of the diameter. Type the diameter for an exact size.' },
        { id: 'sk.rect', label: 'Rectangle', icon: 'rect', tip: 'Draw a rectangle: corner to corner, or centre out. Type width ⏎ height ⏎ for exact sizes.' },
        { id: 'sk.arc', label: 'Arc', icon: 'arc', tip: 'Three-point arc: tap start, end, then a point on the curve.' },
        { id: 'sk.polygon', label: 'Polygon', icon: 'polygon', tip: 'Regular polygon: tap the centre, drag to size. Side count in properties.' },
        { id: 'sk.trim', label: 'Trim', icon: 'trim', tip: 'Remove the piece of a segment or circle between its nearest crossings.' },
        ...(opts.ortho ? [] : [{ id: 'sk.lookat', label: 'Look At', icon: 'camera', tip: 'Snap the camera to look straight down the sketch plane (orthographic).' } as RailTool]),
      ];
    case 'none':
      return [
        { id: 'sketch.xy', label: 'Sketch', icon: 'sketch', tip: 'Start a sketch on a world plane (XY / XZ / YZ)', children: SKETCH_PLANES },
        { id: 'prim.box', label: 'Primitive', icon: 'box', tip: 'Add a primitive solid: box, cylinder, sphere, cone or torus', children: PRIMITIVES },
        ...(EXTRAS ? [{ id: 'module' as const, label: 'Parts', icon: 'module' as const, tip: 'Ready-made parametric parts: vases, boxes, name tags…', children: opts.modules.map((m) => ({ id: 'module' as const, arg: m.id, label: m.name, icon: 'module' as const, tip: m.description })) }] : []),
        { id: 'measure', label: 'Measure', icon: 'ruler', tip: 'Measure distance, length, or angle between picked features.' },
      ];
    case 'face':
      return [
        { id: 'sketch.face', label: 'Sketch', icon: 'sketch', tip: 'Start a sketch on the selected face.' },
        { id: 'pushpull', label: 'Push', icon: 'pushpull', tip: 'Push/pull the face along its normal.' },
        { id: 'measure', label: 'Measure', icon: 'ruler', tip: 'Measure distance, length, or angle between picked features.' },
      ];
    case 'edge':
      return [
        { id: 'fillet', label: 'Fillet', icon: 'edges', tip: 'Round the selected edges with a radius.' },
        { id: 'chamfer', label: 'Chamfer', icon: 'chamfer', tip: 'Cut the selected edges to a flat bevel.' },
      ];
    case 'region':
      return [
        { id: 'pushpull', label: 'Push', icon: 'pushpull', tip: 'Push/pull the region: positive adds a body (or joins the host), negative cuts into the host.' },
        ...(opts.inSketch ? railTools('sketch', opts) : [{ id: 'sketch.edit', label: 'Edit', icon: 'sketch', tip: 'Reopen the sketch this region belongs to.' } as RailTool]),
      ];
    case 'body': {
      const tools: RailTool[] = [
        { id: 'move', label: 'Move', icon: 'move', tip: 'Show the translate gizmo: drag axes or planes to move.' },
        { id: 'rotate', label: 'Rotate', icon: 'rotate', tip: 'Show the rotate gizmo: drag rings to rotate around each axis.' },
      ];
      if (opts.selectedIsModule) tools.push({ id: 'sketch.edit', label: 'Edit', icon: 'module', tip: 'Edit the parameters of this part.' });
      tools.push(
        { id: 'mirror', label: 'Mirror', icon: 'mirror', tip: 'Mirror the body across the X, Y or Z plane (it stays one editable feature).' },
        { id: 'split', label: 'Split', icon: 'split', tip: 'Cut the body in two. Pick the axis and slide the cut off centre.' },
        { id: 'pattern.linear', label: 'Linear', icon: 'pattern', tip: 'Copy the selected body along an axis a fixed distance apart, as many times as you like.' },
        { id: 'pattern.circular', label: 'Circular', icon: 'radial', tip: 'Copy the selected body around an axis, evenly spaced.' },
        { id: 'hole', label: 'Hole', icon: 'hole', tip: 'Make this body cut the bodies it is combined with (toggle solid / hole).' },
        { id: 'duplicate', label: 'Duplicate', icon: 'copy', tip: 'Add an exact copy of the selected body on top of itself. Use Move to reposition. Ctrl+D for keyboard.' },
      );
      if (opts.bodies >= 2) tools.push(
        { id: 'bool.union', label: 'Union', icon: 'combine', tip: 'Merge the selected bodies into one (A ∪ B). Overlapping volumes fuse.' },
        { id: 'bool.subtract', label: 'Subtract', icon: 'subtract', tip: 'Cut bodies out of others. The first selected is kept; the rest are cutters.' },
        { id: 'bool.intersect', label: 'Intersect', icon: 'intersect', tip: 'Keep only the volume the selected bodies share (A ∩ B).' },
      );
      if (opts.selectedIsCombine) tools.push({ id: 'ungroup', label: 'Separate', icon: 'ungroup', tip: 'Split a combined body back into its individual bodies.' });
      tools.push({ id: 'delete', label: 'Delete', icon: 'trash', tip: 'Delete the selected body / bodies. Undoable from the History panel.' });
      return tools;
    }
  }
}
