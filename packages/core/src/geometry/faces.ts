/**
 * Planar face recovery from a triangle mesh: starting at one triangle, grow
 * the connected set of coplanar triangles and return its boundary loops.
 * Used by push/pull: the user taps a face, the face becomes an outline on a
 * sketch plane, and the outline is extruded or cut interactively.
 *
 * Vertices are matched by position (quantised), not index, because meshes
 * with split normals duplicate vertices along creases.
 */
import type { TriangleMesh } from '../document/types.js';

export type Vec3Tuple = [number, number, number];

export interface PlanarFace {
  /** unit normal of the face */
  normal: Vec3Tuple;
  /** a point on the face (centroid of the clicked triangle) */
  origin: Vec3Tuple;
  /** closed boundary loops in 3D; the first is the outer loop, the rest are holes */
  loops: Vec3Tuple[][];
  /** triangle indices that make up the face */
  triangles: number[];
}

const Q = 1e-4;
const key = (x: number, y: number, z: number) => `${Math.round(x / Q)},${Math.round(y / Q)},${Math.round(z / Q)}`;

function triNormal(p: Float32Array, i: Uint32Array, t: number): Vec3Tuple | null {
  const a = i[t * 3]! * 3, b = i[t * 3 + 1]! * 3, c = i[t * 3 + 2]! * 3;
  const abx = p[b]! - p[a]!, aby = p[b + 1]! - p[a + 1]!, abz = p[b + 2]! - p[a + 2]!;
  const acx = p[c]! - p[a]!, acy = p[c + 1]! - p[a + 1]!, acz = p[c + 2]! - p[a + 2]!;
  const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  const l = Math.hypot(nx, ny, nz);
  return l < 1e-12 ? null : [nx / l, ny / l, nz / l];
}

/**
 * Grow the planar face containing triangle `start`. `angleTol` is the max
 * normal deviation in degrees, `distTol` the max distance from the plane (mm).
 */
export function planarFace(mesh: TriangleMesh, start: number, angleTol = 1, distTol = 0.02): PlanarFace | null {
  const p = mesh.positions, idx = mesh.indices;
  const triCount = idx.length / 3;
  if (start < 0 || start >= triCount) return null;
  const n0 = triNormal(p, idx, start);
  if (!n0) return null;
  const a0 = idx[start * 3]! * 3;
  const d0 = n0[0] * p[a0]! + n0[1] * p[a0 + 1]! + n0[2] * p[a0 + 2]!;
  const cosTol = Math.cos((angleTol * Math.PI) / 180);

  // edge → triangles adjacency by position keys
  const vkey = (vi: number) => key(p[vi * 3]!, p[vi * 3 + 1]!, p[vi * 3 + 2]!);
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeTris = new Map<string, number[]>();
  const triKeys: string[][] = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const ks = [vkey(idx[t * 3]!), vkey(idx[t * 3 + 1]!), vkey(idx[t * 3 + 2]!)];
    triKeys[t] = ks;
    for (let e = 0; e < 3; e++) {
      const ek = edgeKey(ks[e]!, ks[(e + 1) % 3]!);
      const list = edgeTris.get(ek);
      if (list) list.push(t); else edgeTris.set(ek, [t]);
    }
  }
  const inPlane = (t: number) => {
    const n = triNormal(p, idx, t);
    if (!n) return false;
    if (n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] < cosTol) return false;
    for (let e = 0; e < 3; e++) {
      const vi = idx[t * 3 + e]! * 3;
      const d = n0[0] * p[vi]! + n0[1] * p[vi + 1]! + n0[2] * p[vi + 2]! - d0;
      if (Math.abs(d) > distTol) return false;
    }
    return true;
  };

  // flood fill across shared edges
  const inFace = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const t = stack.pop()!;
    const ks = triKeys[t]!;
    for (let e = 0; e < 3; e++) {
      for (const u of edgeTris.get(edgeKey(ks[e]!, ks[(e + 1) % 3]!)) ?? []) {
        if (!inFace.has(u) && inPlane(u)) { inFace.add(u); stack.push(u); }
      }
    }
  }

  // boundary = directed edges whose reverse is not in the face
  const directed = new Map<string, { to: string; toPos: Vec3Tuple; fromPos: Vec3Tuple }>();
  const has = new Set<string>();
  for (const t of inFace) { const ks = triKeys[t]!; for (let e = 0; e < 3; e++) has.add(`${ks[e]}>${ks[(e + 1) % 3]}`); }
  for (const t of inFace) {
    const ks = triKeys[t]!;
    for (let e = 0; e < 3; e++) {
      const a = ks[e]!, b = ks[(e + 1) % 3]!;
      if (has.has(`${b}>${a}`)) continue; // interior edge
      const ai = idx[t * 3 + e]! * 3, bi = idx[t * 3 + ((e + 1) % 3)]! * 3;
      directed.set(a, { to: b, fromPos: [p[ai]!, p[ai + 1]!, p[ai + 2]!], toPos: [p[bi]!, p[bi + 1]!, p[bi + 2]!] });
    }
  }
  const loops: Vec3Tuple[][] = [];
  const used = new Set<string>();
  for (const [startKey] of directed) {
    if (used.has(startKey)) continue;
    const loop: Vec3Tuple[] = [];
    let k: string | undefined = startKey;
    while (k && !used.has(k)) {
      used.add(k);
      const e = directed.get(k);
      if (!e) break;
      loop.push(e.fromPos);
      k = e.to;
    }
    if (loop.length >= 3) loops.push(simplifyCollinear(loop, n0));
  }
  if (loops.length === 0) return null;
  // outer loop = largest absolute area
  loops.sort((x, y) => Math.abs(loopArea(y, n0)) - Math.abs(loopArea(x, n0)));
  const c = idx[start * 3]! * 3, c2 = idx[start * 3 + 1]! * 3, c3 = idx[start * 3 + 2]! * 3;
  const origin: Vec3Tuple = [(p[c]! + p[c2]! + p[c3]!) / 3, (p[c + 1]! + p[c2 + 1]! + p[c3 + 1]!) / 3, (p[c + 2]! + p[c2 + 2]! + p[c3 + 2]!) / 3];
  return { normal: n0, origin, loops, triangles: [...inFace] };
}

/** Signed area of a 3D loop projected along `n` (positive = CCW seen from the normal side). */
export function loopArea(loop: Vec3Tuple[], n: Vec3Tuple): number {
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
    sx += a[1] * b[2] - a[2] * b[1];
    sy += a[2] * b[0] - a[0] * b[2];
    sz += a[0] * b[1] - a[1] * b[0];
  }
  return 0.5 * (sx * n[0] + sy * n[1] + sz * n[2]);
}

/** Drop vertices that sit on a straight line between their neighbours (triangulation leftovers). */
function simplifyCollinear(loop: Vec3Tuple[], n: Vec3Tuple): Vec3Tuple[] {
  const out: Vec3Tuple[] = [];
  const m = loop.length;
  for (let i = 0; i < m; i++) {
    const a = loop[(i - 1 + m) % m]!, b = loop[i]!, c = loop[(i + 1) % m]!;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const cross = cx * n[0] + cy * n[1] + cz * n[2];
    const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
    if (lu < 1e-9) continue;
    if (Math.abs(cross) <= 1e-6 * Math.max(1, lu * lv)) continue;
    out.push(b);
  }
  return out.length >= 3 ? out : loop;
}
