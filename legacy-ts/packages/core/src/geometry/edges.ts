/**
 * Edge treatments and repeats on the Manifold kernel.
 *
 * Manifold has no fillet operator, so rounds and chamfers are built from
 * 2D offsets: side corners by an inward-then-outward offset of the outline
 * (round joins round them, square joins chamfer them), and top/bottom edges
 * by stacking thin slices of progressively inset outlines. The slices are
 * at most 0.3 mm tall, which is finer than a printed layer, so the result
 * prints exactly like a true fillet. When OpenCascade lands these become
 * real B-rep fillets behind the same document fields.
 */
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Edges, Repeat } from '../document/types.js';
import type { Vec2 } from '../document/types.js';
import { defaultEdges, defaultRepeat } from '../document/types.js';
import { dispose } from './manifold.js';
import { treatPolygonCorners, signedArea } from './profile.js';

const SLICE = 0.3;
const MAX_SLICES = 40;

export const edgesOf = (e: Edges | undefined): Edges => {
  const d = defaultEdges();
  return { sides: { ...d.sides, ...(e?.sides ?? {}) }, top: { ...d.top, ...(e?.top ?? {}) }, bottom: { ...d.bottom, ...(e?.bottom ?? {}) } };
};
export const hasEdges = (e: Edges) => (e.sides.kind !== 'none' && e.sides.size > 0) || (e.top.kind !== 'none' && e.top.size > 0) || (e.bottom.kind !== 'none' && e.bottom.size > 0);

/** Round or chamfer every corner of each contour (outer loops and holes alike). */
export function treatCorners(contours: Vec2[][], kind: Edges['sides']['kind'], size: number): Vec2[][] {
  if (kind === 'none' || size <= 0) return contours;
  return contours.map((c) => treatPolygonCorners(c, kind, size));
}

/** Inset of the outline at height `t` (0 = edge start, 1 = edge end) for a round or chamfer of `size`. */
function inset(kind: 'round' | 'chamfer', size: number, t: number): number {
  return kind === 'round' ? size - Math.sqrt(Math.max(0, size * size - (size * t) * (size * t))) : size * t;
}

/** Offset a closed polygon inward by `d` (outward for holes) keeping the vertex count: miter offset per vertex. */
export function insetPolygon(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length;
  if (n < 3 || d === 0) return poly;
  const dir = signedArea(poly) > 0 ? 1 : -1; // CCW outer: left normal points inward; CW hole: the other way
  const out: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n]!, p = poly[i]!, b = poly[(i + 1) % n]!;
    let e1x = p[0] - a[0], e1y = p[1] - a[1], e2x = b[0] - p[0], e2y = b[1] - p[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    // left normals of the two edges
    const n1x = -e1y * dir, n1y = e1x * dir, n2x = -e2y * dir, n2y = e2x * dir;
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
    const cosHalf = Math.max(0.25, mx * n1x + my * n1y); // miter limit 4
    out[i] = [p[0] + (mx * d) / cosHalf, p[1] + (my * d) / cosHalf];
  }
  return out;
}

/** Smallest inset that would make a contour fold over itself (half the shortest "width"): conservative bound. */
function safeInset(contours: Vec2[][]): number {
  let best = Infinity;
  for (const c of contours) {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const [x, y] of c) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    best = Math.min(best, (maxx - minx) / 2, (maxy - miny) / 2);
  }
  return Math.max(0, best - 0.05);
}

/**
 * Loft the outline through a list of (inset, z) stations into one closed
 * mesh: side quads between consecutive stations plus triangulated caps.
 * Returns null when the result is not a valid manifold (self-intersecting
 * inset), so the caller can fall back to slices.
 */
function loftStations(wasm: ManifoldToplevel, contours: Vec2[][], stations: { inset: number; z: number }[]): Manifold | null {
  const S = stations.length;
  if (S < 2) return null;
  const rings = stations.map((st) => contours.map((c) => insetPolygon(c, st.inset)));
  const counts = contours.map((c) => c.length);
  const total = counts.reduce((a, b) => a + b, 0);
  const verts = new Float32Array(S * total * 3);
  let vi = 0;
  for (let s = 0; s < S; s++) for (let c = 0; c < contours.length; c++) for (const [x, y] of rings[s]![c]!) { verts[vi++] = x; verts[vi++] = y; verts[vi++] = stations[s]!.z; }
  const base = (s: number, c: number) => { let o = s * total; for (let k = 0; k < c; k++) o += counts[k]!; return o; };
  const tris: number[] = [];
  for (let s = 0; s < S - 1; s++) for (let c = 0; c < contours.length; c++) {
    const n = counts[c]!, b0 = base(s, c), b1 = base(s + 1, c);
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      tris.push(b0 + j, b0 + j1, b1 + j1, b0 + j, b1 + j1, b1 + j);
    }
  }
  const capBottom = wasm.triangulate(rings[0]!, 1e-6), capTop = wasm.triangulate(rings[S - 1]!, 1e-6);
  const offsets = contours.map((_, c) => base(0, c));
  const topOffsets = contours.map((_, c) => base(S - 1, c));
  // triangulate indexes points in polygon order across all contours
  const flatIndex = (offs: number[], k: number) => { let c = 0; while (c < counts.length - 1 && k >= counts[c]!) { k -= counts[c]!; c++; } return offs[c]! + k; };
  for (const [a, b, c] of capBottom) tris.push(flatIndex(offsets, c), flatIndex(offsets, b), flatIndex(offsets, a));
  for (const [a, b, c] of capTop) tris.push(flatIndex(topOffsets, a), flatIndex(topOffsets, b), flatIndex(topOffsets, c));
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: verts, triVerts: new Uint32Array(tris) });
  mesh.merge();
  let m: Manifold;
  try { m = wasm.Manifold.ofMesh(mesh); } catch { return null; }
  if (m.status() !== 'NoError' || m.isEmpty() || m.volume() <= 0) { dispose(m); return null; }
  return m;
}

/** Stations for a round or chamfer band of `size` at the bottom (dir -1) or top (dir +1). */
function bandStations(kind: 'round' | 'chamfer', size: number, z0: number, dir: 1 | -1): { inset: number; z: number }[] {
  const n = kind === 'chamfer' ? 1 : Math.min(MAX_SLICES, Math.max(4, Math.ceil((size * Math.PI) / 2 / 0.8)));
  const out: { inset: number; z: number }[] = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    // round: quarter circle, chamfer: straight line
    const ins = kind === 'round' ? size - size * Math.cos((t * Math.PI) / 2) : size * t;
    const dz = kind === 'round' ? size * Math.sin((t * Math.PI) / 2) : size * t;
    out.push({ inset: ins, z: z0 + dir * dz });
  }
  return out;
}

/**
 * Extrude an outline to `height` with edge treatments. The outline is in
 * the XY plane; the solid is authored base on Z = 0.
 */
export function extrudeWithEdges(wasm: ManifoldToplevel, contours: Vec2[][], height: number, edges: Edges): Manifold {
  const { Manifold, CrossSection } = wasm;
  const e = edgesOf(edges);
  const base = new CrossSection(treatCorners(contours, e.sides.kind, e.sides.size), 'Positive');
  try {
    const treated = treatCorners(contours, e.sides.kind, e.sides.size);
    // a rounded corner of radius r cannot take an inset beyond r without folding
    const cornerCap = e.sides.kind === 'round' && e.sides.size > 0 ? e.sides.size * 0.95 : Infinity;
    const limit = Math.min(height / 2 - 0.01, maxInset(base), safeInset(treated), cornerCap);
    const topSize = e.top.kind === 'none' ? 0 : Math.min(e.top.size, limit);
    const bottomSize = e.bottom.kind === 'none' ? 0 : Math.min(e.bottom.size, limit);
    if (topSize <= 0 && bottomSize <= 0) return base.extrude(height);
    // smooth loft first: flat chamfers and true arcs
    const stations: { inset: number; z: number }[] = [];
    if (bottomSize > 0) stations.push(...bandStations(e.bottom.kind as 'round' | 'chamfer', bottomSize, bottomSize, -1).reverse());
    else stations.push({ inset: 0, z: 0 });
    if (bottomSize > 0) stations.push({ inset: 0, z: bottomSize });
    if (topSize > 0) { stations.push({ inset: 0, z: height - topSize }); stations.push(...bandStations(e.top.kind as 'round' | 'chamfer', topSize, height - topSize, 1)); }
    else stations.push({ inset: 0, z: height });
    const lofted = loftStations(wasm, treated, stations);
    if (lofted) return lofted;
    const parts: Manifold[] = [];
    const bodyZ0 = bottomSize, bodyZ1 = height - topSize;
    if (bodyZ1 - bodyZ0 > 1e-4) {
      const body = base.extrude(bodyZ1 - bodyZ0);
      parts.push(bodyZ0 ? body.translate([0, 0, bodyZ0]) : body);
      if (bodyZ0) dispose(body);
    }
    const stack = (size: number, kind: 'round' | 'chamfer', fromZ: number, dir: 1 | -1) => {
      const n = Math.min(MAX_SLICES, Math.max(3, Math.ceil(size / SLICE)));
      for (let k = 0; k < n; k++) {
        // slice k spans t ∈ [k/n, (k+1)/n] of the edge; use its inner (larger) inset so no slice pokes out
        const t1 = (k + 1) / n;
        const ins = inset(kind, size, t1);
        const cs = base.offset(-ins, 'Round', 2, 8);
        if (cs.isEmpty()) { dispose(cs); break; }
        const dz = size / n;
        const z = dir === 1 ? fromZ + k * dz : fromZ - (k + 1) * dz;
        const m = cs.extrude(dz + 1e-3);
        parts.push(m.translate([0, 0, z]));
        dispose(cs, m);
      }
    };
    if (topSize > 0) stack(topSize, e.top.kind as 'round' | 'chamfer', bodyZ1, 1);
    if (bottomSize > 0) stack(bottomSize, e.bottom.kind as 'round' | 'chamfer', bodyZ0, -1);
    const out = parts.length === 1 ? parts[0]!.translate([0, 0, 0]) : Manifold.union(parts);
    dispose(...parts);
    return out;
  } finally { dispose(base); }
}

/** Largest inward offset that keeps something of the outline (half the smaller bounding dimension). */
function maxInset(cs: CrossSection): number {
  const b = cs.bounds();
  return Math.max(0, Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 - 0.05);
}

const d2r = Math.PI / 180;

/** Union of the repeated copies of `m` (in the feature's authoring frame). Returns a new Manifold; caller deletes. */
export function applyRepeat(wasm: ManifoldToplevel, m: Manifold, repeat: Repeat | undefined): Manifold {
  const r = { ...defaultRepeat(), ...(repeat ?? {}) };
  if (r.mode === 'none') return m;
  const { Manifold } = wasm;
  const copies: Manifold[] = [];
  switch (r.mode) {
    case 'linear':
      for (let i = 0; i < r.count; i++) copies.push(m.translate([r.step.x * i, r.step.y * i, r.step.z * i]));
      break;
    case 'grid':
      for (let i = 0; i < r.count; i++) for (let j = 0; j < r.count2; j++) copies.push(m.translate([r.step.x * i + r.step2.x * j, r.step.y * i + r.step2.y * j, r.step.z * i + r.step2.z * j]));
      break;
    case 'radial': {
      const full = Math.abs(r.sweep) >= 359.999;
      const stepDeg = r.count > 1 ? r.sweep / (full ? r.count : r.count - 1) : 0;
      const [cx, cy] = r.center;
      for (let i = 0; i < r.count; i++) {
        const t = m.translate([-cx, -cy, 0]);
        const rot = t.rotate([0, 0, stepDeg * i]);
        copies.push(rot.translate([cx, cy, 0]));
        dispose(t, rot);
      }
      break;
    }
    case 'mirror': {
      const n: [number, number, number] = r.axis === 'x' ? [1, 0, 0] : r.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      const off: [number, number, number] = [n[0] * r.offset, n[1] * r.offset, n[2] * r.offset];
      const t = m.translate([-off[0], -off[1], -off[2]]);
      const mir = t.mirror(n);
      copies.push(mir.translate(off));
      if (r.keepOriginal) copies.push(m.translate([0, 0, 0]));
      dispose(t, mir);
      break;
    }
  }
  if (copies.length === 0) return m;
  const out = copies.length === 1 ? copies[0]! : Manifold.union(copies);
  if (copies.length > 1) dispose(...copies);
  dispose(m);
  return out;
}
