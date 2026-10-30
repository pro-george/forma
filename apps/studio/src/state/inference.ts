/**
 * Sketch inference (Materializr's SketchTool snapping, in sketch-local mm):
 * the cursor is pulled to the nearest meaningful place and a guide says why.
 *
 * Priority, closest wins inside each tier:
 *  1. points — endpoints, midpoints, centres, intersections (weld tolerance)
 *  2. on-line — a point on an existing segment or circle (pointing tolerance)
 *  3. direction from the anchor — horizontal / vertical, perpendicular or
 *     parallel to an existing line, tangent to a circle, 15° steps
 *  4. the sketch axes through the origin
 *  5. the grid
 * Tolerances come in mm from the caller, who scales pixels by the zoom:
 * 6 px welds, 12 px points.
 */
import type { Sketch, SketchEntity, Vec2 } from '@forma/core';
import { endpoints } from '@forma/core';

export type GuideKind = 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'online' | 'horizontal' | 'vertical' | 'perpendicular' | 'parallel' | 'tangent' | 'angle' | 'axis' | 'grid' | 'free';

export interface Guide {
  kind: GuideKind;
  /** short glyph drawn next to the cursor */
  glyph: string;
  /** optional label (angle, length) */
  label?: string;
  /** a guide line to draw, in sketch mm */
  line?: [Vec2, Vec2];
}

export interface Inference { p: Vec2; guides: Guide[] }

export interface InferenceOpts {
  /** weld tolerance (mm) — points */
  weld: number;
  /** pointing tolerance (mm) — lines, directions */
  point: number;
  grid: number;
  shift: boolean;
  alt: boolean;
  /** extra snap points (e.g. the first draft point so a polyline can close) */
  extra?: Vec2[];
  /** entity ids to ignore (the ones being dragged) */
  ignore?: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const d2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const GLYPH: Record<GuideKind, string> = { endpoint: '□', midpoint: '△', center: '⊙', intersection: '✕', online: '◇', horizontal: '─', vertical: '│', perpendicular: '⟂', parallel: '∥', tangent: '⌒', angle: '∠', axis: '┼', grid: '', free: '' };

function lineLineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0]! * s[1]! - r[1]! * s[0]!;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1]! - (c[1] - a[1]) * s[0]!) / den;
  const u = ((c[0] - a[0]) * r[1]! - (c[1] - a[1]) * r[0]!) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return [a[0] + t * r[0]!, a[1] + t * r[1]!];
}

function lineCircleIntersections(a: Vec2, b: Vec2, c: Vec2, r: number): Vec2[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - c[0], fy = a[1] - c[1];
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-12 || disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out: Vec2[] = [];
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) if (t >= -1e-6 && t <= 1 + 1e-6) out.push([a[0] + t * dx, a[1] + t * dy]);
  return out;
}

/** All point snaps of a sketch: endpoints, midpoints, centres and pairwise intersections. */
export function snapCandidates(sketch: Sketch, ignore: string[] = []): { p: Vec2; kind: GuideKind }[] {
  const ents = sketch.entities.filter((e) => !ignore.includes(e.id));
  const out: { p: Vec2; kind: GuideKind }[] = [];
  for (const e of ents) {
    const ep = endpoints(e);
    if (ep) { out.push({ p: ep[0], kind: 'endpoint' }, { p: ep[1], kind: 'endpoint' }); if (e.type === 'line') out.push({ p: [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], kind: 'midpoint' }); }
    if (e.type === 'circle' || e.type === 'arc') out.push({ p: e.center, kind: 'center' });
  }
  for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) {
    const a = ents[i]!, b = ents[j]!;
    if (a.type === 'line' && b.type === 'line') { const p = lineLineIntersection(a.a, a.b, b.a, b.b); if (p) out.push({ p, kind: 'intersection' }); }
    else if (a.type === 'line' && b.type === 'circle') for (const p of lineCircleIntersections(a.a, a.b, b.center, b.radius)) out.push({ p, kind: 'intersection' });
    else if (a.type === 'circle' && b.type === 'line') for (const p of lineCircleIntersections(b.a, b.b, a.center, a.radius)) out.push({ p, kind: 'intersection' });
  }
  return out;
}

/** Nearest point on an entity and the entity's tangent direction there. */
function nearestOn(e: SketchEntity, p: Vec2): { q: Vec2; dir: Vec2; d: number } | null {
  if (e.type === 'line') {
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = dx * dx + dy * dy;
    if (L < 1e-12) return null;
    const t = Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / L));
    const q: Vec2 = [e.a[0] + t * dx, e.a[1] + t * dy];
    const len = Math.sqrt(L);
    return { q, dir: [dx / len, dy / len], d: d2(p, q) };
  }
  if (e.type === 'circle') {
    const vx = p[0] - e.center[0], vy = p[1] - e.center[1], len = Math.hypot(vx, vy) || 1;
    const q: Vec2 = [e.center[0] + (vx / len) * e.radius, e.center[1] + (vy / len) * e.radius];
    return { q, dir: [-vy / len, vx / len], d: d2(p, q) };
  }
  return null;
}

const DIRS: { kind: GuideKind; dir: Vec2 }[] = [{ kind: 'horizontal', dir: [1, 0] }, { kind: 'vertical', dir: [0, 1] }];

export function infer(raw: Vec2, sketch: Sketch, anchor: Vec2 | null, o: InferenceOpts): Inference {
  if (o.alt) return { p: [r2(raw[0]), r2(raw[1])], guides: [{ kind: 'free', glyph: '' }] };
  const ents = sketch.entities.filter((e) => !o.ignore?.includes(e.id));
  const guides: Guide[] = [];

  // 1. points
  let best: { p: Vec2; kind: GuideKind } | null = null, bd = o.weld;
  for (const c of [...snapCandidates(sketch, o.ignore), ...(o.extra ?? []).map((p) => ({ p, kind: 'endpoint' as GuideKind }))]) {
    const d = d2(c.p, raw); if (d < bd) { bd = d; best = c; }
  }
  if (best) {
    guides.push({ kind: best.kind, glyph: GLYPH[best.kind] });
    // a directional relation to the anchor still reads as info
    if (anchor) addDirectionInfo(best.p, anchor, guides);
    return { p: [r2(best.p[0]), r2(best.p[1])], guides };
  }

  // 3. direction from the anchor (computed first so an on-line hit can be reconciled with it)
  let dirHit: { p: Vec2; guide: Guide } | null = null;
  if (anchor) {
    const dx = raw[0] - anchor[0], dy = raw[1] - anchor[1], len = Math.hypot(dx, dy);
    if (len > o.point) {
      const cands: { kind: GuideKind; dir: Vec2; label?: string; ref?: SketchEntity }[] = [...DIRS];
      for (const e of ents) if (e.type === 'line') {
        const ex = e.b[0] - e.a[0], ey = e.b[1] - e.a[1], L = Math.hypot(ex, ey) || 1;
        cands.push({ kind: 'parallel', dir: [ex / L, ey / L], ref: e }, { kind: 'perpendicular', dir: [-ey / L, ex / L], ref: e });
      }
      if (o.shift) {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
        cands.length = 0; cands.push({ kind: 'angle', dir: [Math.cos(a), Math.sin(a)], label: `${Math.round((a * 180) / Math.PI)}°` });
      }
      let bestD: typeof cands[number] | null = null, bdd = o.point;
      for (const c of cands) {
        // perpendicular distance from raw to the ray anchor + t·dir
        const t = dx * c.dir[0] + dy * c.dir[1];
        if (t <= 0) continue;
        const px = anchor[0] + t * c.dir[0], py = anchor[1] + t * c.dir[1];
        const d = Math.hypot(raw[0] - px, raw[1] - py);
        // horizontal/vertical win ties over parallel/perpendicular (they are the common case)
        const w = c.kind === 'horizontal' || c.kind === 'vertical' ? 0.9 : 1;
        if (d * w < bdd) { bdd = d * w; bestD = c; }
      }
      if (!bestD && !o.shift) {
        // 15° steps as a weaker hint when nothing else is close
        const ang = Math.atan2(dy, dx), step = Math.PI / 12, a = Math.round(ang / step) * step;
        const d = Math.abs(Math.sin(ang - a)) * len;
        if (d < o.point * 0.5 && Math.abs(Math.round(ang / step)) % 6 !== 0) bestD = { kind: 'angle', dir: [Math.cos(a), Math.sin(a)], label: `${((Math.round((a * 180) / Math.PI) % 360) + 360) % 360}°` };
      }
      if (bestD) {
        const t = dx * bestD.dir[0] + dy * bestD.dir[1];
        const L = o.grid > 0 ? Math.round(t / o.grid) * o.grid : t;
        const p: Vec2 = [anchor[0] + L * bestD.dir[0], anchor[1] + L * bestD.dir[1]];
        const g: Guide = { kind: bestD.kind, glyph: GLYPH[bestD.kind], label: bestD.label, line: [anchor, p] };
        if (bestD.ref && bestD.ref.type === 'line') g.line = [anchor, p];
        dirHit = { p, guide: g };
      }
    }
  }

  // 2. on an existing line / circle
  let onHit: { q: Vec2; e: SketchEntity } | null = null, od = o.point;
  for (const e of ents) { const n = nearestOn(e, raw); if (n && n.d < od) { od = n.d; onHit = { q: n.q, e }; } }
  if (onHit && dirHit) {
    // both: intersect the direction ray with the entity if that lands near the cursor
    const ray: [Vec2, Vec2] = [anchor!, [anchor![0] + (dirHit.p[0] - anchor![0]) * 100, anchor![1] + (dirHit.p[1] - anchor![1]) * 100]];
    const hits = onHit.e.type === 'line' ? [lineLineIntersection(ray[0], ray[1], onHit.e.a, onHit.e.b)].filter((x): x is Vec2 => !!x)
      : onHit.e.type === 'circle' ? lineCircleIntersections(ray[0], ray[1], onHit.e.center, onHit.e.radius) : [];
    const near = hits.filter((h) => d2(h, raw) < o.point * 1.5).sort((a, b) => d2(a, raw) - d2(b, raw))[0];
    if (near) return { p: [r2(near[0]), r2(near[1])], guides: [{ kind: 'online', glyph: GLYPH.online }, { ...dirHit.guide, line: [anchor!, near] }] };
  }
  if (onHit) {
    guides.push({ kind: 'online', glyph: GLYPH.online });
    if (anchor) addDirectionInfo(onHit.q, anchor, guides);
    return { p: [r2(onHit.q[0]), r2(onHit.q[1])], guides };
  }
  if (dirHit) return { p: [r2(dirHit.p[0]), r2(dirHit.p[1])], guides: [dirHit.guide] };

  // 4. sketch axes
  const g = o.grid > 0 ? (v: number) => Math.round(v / o.grid) * o.grid : (v: number) => v;
  if (Math.abs(raw[1]) < o.point * 0.6) return { p: [r2(g(raw[0])), 0], guides: [{ kind: 'axis', glyph: GLYPH.axis, label: 'X axis', line: [[raw[0] - 20, 0], [raw[0] + 20, 0]] }] };
  if (Math.abs(raw[0]) < o.point * 0.6) return { p: [0, r2(g(raw[1]))], guides: [{ kind: 'axis', glyph: GLYPH.axis, label: 'Y axis', line: [[0, raw[1] - 20], [0, raw[1] + 20]] }] };

  // 5. grid
  return { p: [r2(g(raw[0])), r2(g(raw[1]))], guides: [{ kind: 'grid', glyph: '' }] };
}

/** When a snapped point happens to be level with / above the anchor, say so. */
function addDirectionInfo(p: Vec2, anchor: Vec2, guides: Guide[]) {
  if (Math.abs(p[1] - anchor[1]) < 1e-6 && Math.abs(p[0] - anchor[0]) > 1e-6) guides.push({ kind: 'horizontal', glyph: GLYPH.horizontal, line: [anchor, p] });
  else if (Math.abs(p[0] - anchor[0]) < 1e-6 && Math.abs(p[1] - anchor[1]) > 1e-6) guides.push({ kind: 'vertical', glyph: GLYPH.vertical, line: [anchor, p] });
}

export { lineLineIntersection, lineCircleIntersections };
