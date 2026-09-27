/**
 * 2D sketch model: lines, arcs and circles in the XY plane (mm).
 * A sketch turns into profiles (closed loops with holes) for extrusion.
 */
import { z } from 'zod';
import type { Profile, Vec2 } from '../document/types.js';
const Vec2Schema = z.tuple([z.number(), z.number()]);
import { loopsToProfiles } from '../raster/trace.js';
import { signedArea } from '../geometry/profile.js';

export const SketchEntitySchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('line'), a: Vec2Schema, b: Vec2Schema }),
  /** arc from startAngle to endAngle (degrees), counter-clockwise when ccw */
  z.object({ id: z.string(), type: z.literal('arc'), center: Vec2Schema, radius: z.number().positive(), startAngle: z.number(), endAngle: z.number(), ccw: z.boolean().default(true) }),
  z.object({ id: z.string(), type: z.literal('circle'), center: Vec2Schema, radius: z.number().positive() }),
]);
export type SketchEntity = z.infer<typeof SketchEntitySchema>;

export const SketchSchema = z.object({ entities: z.array(SketchEntitySchema) });
export type Sketch = z.infer<typeof SketchSchema>;

const TAU = Math.PI * 2;
const d2r = Math.PI / 180;

/** Number of segments for an arc of `radius` spanning `sweep` radians at chord tolerance `tol` mm. */
export function arcSegments(radius: number, sweep: number, tol = 0.05): number {
  const perFull = Math.ceil(TAU / Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(radius, tol)))));
  return Math.max(4, Math.ceil((Math.abs(sweep) / TAU) * Math.max(16, Math.min(256, perFull))));
}

/** Start and end points of an open entity (lines and arcs). */
export function endpoints(e: SketchEntity): [Vec2, Vec2] | null {
  if (e.type === 'line') return [e.a, e.b];
  if (e.type === 'arc') return [arcPoint(e, e.startAngle), arcPoint(e, e.endAngle)];
  return null;
}

export function arcPoint(e: Extract<SketchEntity, { type: 'arc' }>, angleDeg: number): Vec2 {
  return [e.center[0] + Math.cos(angleDeg * d2r) * e.radius, e.center[1] + Math.sin(angleDeg * d2r) * e.radius];
}

/** Signed sweep in degrees respecting direction, in (0, 360]. */
export function arcSweep(e: Extract<SketchEntity, { type: 'arc' }>): number {
  let s = ((e.endAngle - e.startAngle) % 360 + 360) % 360;
  if (s === 0) s = 360;
  return e.ccw ? s : s - 360;
}

/** Polyline for an entity (includes both endpoints; circles are closed loops without repeated end). */
export function tessellate(e: SketchEntity, tol = 0.05): Vec2[] {
  if (e.type === 'line') return [e.a, e.b];
  if (e.type === 'circle') {
    const n = arcSegments(e.radius, TAU, tol);
    return Array.from({ length: n }, (_, i) => [e.center[0] + Math.cos((i / n) * TAU) * e.radius, e.center[1] + Math.sin((i / n) * TAU) * e.radius] as Vec2);
  }
  const sweep = arcSweep(e);
  const n = arcSegments(e.radius, sweep * d2r, tol);
  return Array.from({ length: n + 1 }, (_, i) => arcPoint(e, e.startAngle + (sweep * i) / n));
}

const key = (p: Vec2, tol: number) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;

/**
 * Chain open entities into closed loops by matching endpoints within `joinTol`.
 * Returns closed loops (point lists) plus the ids of entities left dangling.
 */
export function buildLoops(sketch: Sketch, joinTol = 0.02, tol = 0.05): { loops: Vec2[][]; openIds: string[] } {
  const loops: Vec2[][] = [];
  const openIds: string[] = [];
  const open: { id: string; pts: Vec2[] }[] = [];
  for (const e of sketch.entities) {
    if (e.type === 'circle') { loops.push(tessellate(e, tol)); continue; }
    open.push({ id: e.id, pts: tessellate(e, tol) });
  }
  const used = new Set<number>();
  // index endpoints
  const byEnd = new Map<string, number[]>();
  open.forEach((s, i) => {
    for (const p of [s.pts[0]!, s.pts[s.pts.length - 1]!]) {
      const k = key(p, joinTol);
      (byEnd.get(k) ?? byEnd.set(k, []).get(k)!).push(i);
    }
  });
  for (let start = 0; start < open.length; start++) {
    if (used.has(start)) continue;
    const chain: Vec2[] = [...open[start]!.pts];
    const members = [start];
    used.add(start);
    let guard = 0;
    while (guard++ < open.length + 1) {
      const tail = chain[chain.length - 1]!;
      if (chain.length > 2 && key(tail, joinTol) === key(chain[0]!, joinTol)) break;
      const candidates = (byEnd.get(key(tail, joinTol)) ?? []).filter((i) => !used.has(i));
      const next = candidates[0];
      if (next === undefined) break;
      used.add(next);
      members.push(next);
      const pts = open[next]!.pts;
      const forward = key(pts[0]!, joinTol) === key(tail, joinTol);
      const ordered = forward ? pts : [...pts].reverse();
      chain.push(...ordered.slice(1));
    }
    const closed = chain.length > 3 && key(chain[0]!, joinTol) === key(chain[chain.length - 1]!, joinTol);
    if (closed) {
      chain.pop();
      if (Math.abs(signedArea(chain)) > 1e-6) loops.push(chain);
    } else {
      members.forEach((m) => openIds.push(open[m]!.id));
    }
  }
  return { loops, openIds };
}

/** Closed loops nested into outer profiles with holes (even-odd), ready to extrude. */
export function sketchToProfiles(sketch: Sketch, tol = 0.05): { profiles: Profile[]; openIds: string[] } {
  const { loops, openIds } = buildLoops(sketch, 0.02, tol);
  return { profiles: loopsToProfiles(loops), openIds };
}

/** Axis-aligned bounds of all entities. */
export function sketchBounds(sketch: Sketch): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of sketch.entities) for (const [x, y] of tessellate(e, 0.5)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

let n = 0;
export const sketchId = () => `s${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Convenience constructors for tools. */
export const sk = {
  line: (a: Vec2, b: Vec2): SketchEntity => ({ id: sketchId(), type: 'line', a, b }),
  circle: (center: Vec2, radius: number): SketchEntity => ({ id: sketchId(), type: 'circle', center, radius }),
  arc: (center: Vec2, radius: number, startAngle: number, endAngle: number, ccw = true): SketchEntity => ({ id: sketchId(), type: 'arc', center, radius, startAngle, endAngle, ccw }),
  rect: (a: Vec2, b: Vec2): SketchEntity[] => {
    const [x1, y1] = a, [x2, y2] = b;
    return [sk.line([x1, y1], [x2, y1]), sk.line([x2, y1], [x2, y2]), sk.line([x2, y2], [x1, y2]), sk.line([x1, y2], [x1, y1])];
  },
  /** arc through three points (start, mid, end); falls back to a line when collinear */
  arc3: (p1: Vec2, p2: Vec2, p3: Vec2): SketchEntity => {
    const [ax, ay] = p1, [bx, by] = p2, [cx, cy] = p3;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return sk.line(p1, p3);
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy);
    const ang = (p: Vec2) => (Math.atan2(p[1] - uy, p[0] - ux) / d2r + 360) % 360;
    const a1 = ang(p1), a2 = ang(p2), a3 = ang(p3);
    // ccw if going from a1 to a3 counter-clockwise passes through a2
    const ccwSweep = ((a3 - a1) % 360 + 360) % 360;
    const midSweep = ((a2 - a1) % 360 + 360) % 360;
    const ccw = midSweep < ccwSweep;
    return sk.arc([ux, uy], r, a1, a3, ccw);
  },
};
