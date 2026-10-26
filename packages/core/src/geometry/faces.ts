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

/** A straight edge where two flat faces meet. Normals are outward; `convex` is true for an outside corner. */
export interface MeshEdge {
  a: Vec3Tuple;
  b: Vec3Tuple;
  /** unit direction a → b */
  dir: Vec3Tuple;
  length: number;
  nA: Vec3Tuple;
  nB: Vec3Tuple;
  convex: boolean;
  /** indices into the faces array returned alongside */
  faceA: number;
  faceB: number;
}

const EDGE_INDEX_LIMIT = 300_000;

/**
 * All planar faces of a mesh and the straight edges between them. Faces are
 * grown from every triangle not yet assigned; edges are the boundary
 * segments shared by two different faces, merged while collinear.
 */
export function meshEdges(mesh: TriangleMesh, minAngleDeg = 8): { faces: PlanarFace[]; edges: MeshEdge[] } {
  const faces: PlanarFace[] = [];
  const edges: MeshEdge[] = [];
  if (mesh.indices.length > EDGE_INDEX_LIMIT || mesh.indices.length === 0) return { faces, edges };
  const triFace = new Int32Array(mesh.indices.length / 3).fill(-1);
  for (let t = 0; t < triFace.length; t++) {
    if (triFace[t] !== -1) continue;
    const f = planarFace(mesh, t);
    if (!f) { triFace[t] = -2; continue; }
    const id = faces.push(f) - 1;
    for (const k of f.triangles) triFace[k] = id;
  }
  // directed boundary edges per face, keyed by quantised endpoints, with the owning face
  const p = mesh.positions, idx = mesh.indices;
  const vk = (vi: number) => key(p[vi * 3]!, p[vi * 3 + 1]!, p[vi * 3 + 2]!);
  const owner = new Map<string, { face: number; a: Vec3Tuple; b: Vec3Tuple }>();
  for (let t = 0; t < triFace.length; t++) {
    const f = triFace[t]!;
    if (f < 0) continue;
    for (let e = 0; e < 3; e++) {
      const ai = idx[t * 3 + e]!, bi = idx[t * 3 + ((e + 1) % 3)]!;
      owner.set(`${vk(ai)}>${vk(bi)}`, { face: f, a: [p[ai * 3]!, p[ai * 3 + 1]!, p[ai * 3 + 2]!], b: [p[bi * 3]!, p[bi * 3 + 1]!, p[bi * 3 + 2]!] });
    }
  }
  const cosMin = Math.cos((minAngleDeg * Math.PI) / 180);
  const seen = new Set<string>();
  const raw: MeshEdge[] = [];
  for (const [k, e] of owner) {
    const [ka = '', kb = ''] = k.split('>');
    const rev = owner.get(`${kb}>${ka}`);
    if (!rev || rev.face === e.face) continue;
    const ek = ka < kb ? ka + kb : kb + ka;
    const pair = `${Math.min(e.face, rev.face)}|${Math.max(e.face, rev.face)}|${ek}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const A = faces[e.face]!, B = faces[rev.face]!;
    const dot = A.normal[0] * B.normal[0] + A.normal[1] * B.normal[1] + A.normal[2] * B.normal[2];
    if (dot > cosMin) continue; // nearly coplanar: not a real edge
    const d: Vec3Tuple = [e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2]];
    const len = Math.hypot(...d);
    if (len < 1e-6) continue;
    // convex when face B's centre lies behind face A's plane
    const cB = centroid(B.loops[0]!);
    const side = (cB[0] - e.a[0]) * A.normal[0] + (cB[1] - e.a[1]) * A.normal[1] + (cB[2] - e.a[2]) * A.normal[2];
    raw.push({ a: e.a, b: e.b, dir: [d[0] / len, d[1] / len, d[2] / len], length: len, nA: A.normal, nB: B.normal, convex: side < 0, faceA: e.face, faceB: rev.face });
  }
  // merge collinear segments between the same face pair into one edge
  const groups = new Map<string, MeshEdge[]>();
  for (const e of raw) { const g = `${Math.min(e.faceA, e.faceB)}|${Math.max(e.faceA, e.faceB)}`; (groups.get(g) ?? groups.set(g, []).get(g)!).push(e); }
  for (const list of groups.values()) {
    const used = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let cur = { ...list[i]! };
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < list.length; j++) {
          if (used[j]) continue;
          const o = list[j]!;
          if (Math.abs(Math.abs(o.dir[0] * cur.dir[0] + o.dir[1] * cur.dir[1] + o.dir[2] * cur.dir[2]) - 1) > 1e-4) continue;
          if (same(o.a, cur.b)) { cur = extend(cur, cur.a, o.b); used[j] = true; grew = true; }
          else if (same(o.b, cur.a)) { cur = extend(cur, o.a, cur.b); used[j] = true; grew = true; }
          else if (same(o.b, cur.b)) { cur = extend(cur, cur.a, o.a); used[j] = true; grew = true; }
          else if (same(o.a, cur.a)) { cur = extend(cur, o.b, cur.b); used[j] = true; grew = true; }
        }
      }
      edges.push(cur);
    }
  }
  return { faces, edges };
}

const same = (p: Vec3Tuple, q: Vec3Tuple) => Math.abs(p[0] - q[0]) < 1e-4 && Math.abs(p[1] - q[1]) < 1e-4 && Math.abs(p[2] - q[2]) < 1e-4;
function extend(e: MeshEdge, a: Vec3Tuple, b: Vec3Tuple): MeshEdge {
  const d: Vec3Tuple = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  return { ...e, a, b, dir: [d[0] / len, d[1] / len, d[2] / len], length: len };
}
function centroid(loop: Vec3Tuple[]): Vec3Tuple {
  let x = 0, y = 0, z = 0;
  for (const p of loop) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / loop.length, y / loop.length, z / loop.length];
}

/**
 * Cross-section polygon (in the plane perpendicular to the edge, expressed
 * in a 2D frame given by `u`,`v` unit vectors) of the tool body that rounds
 * or chamfers an edge. For a convex edge it is the material to remove; for a
 * concave edge it is the material to add. `eps` nudges the body past the
 * faces so the boolean never fights a coplanar wall.
 */
export function edgeToolSection(edge: MeshEdge, kind: 'round' | 'chamfer', size: number, eps = 0.02): { points: [number, number][]; role: 'solid' | 'hole'; frame: { u: Vec3Tuple; v: Vec3Tuple; origin: Vec3Tuple } } | null {
  const { nA, nB, dir, convex } = edge;
  // tangent directions along each face, away from the edge
  const cross = (p: Vec3Tuple, q: Vec3Tuple): Vec3Tuple => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const dotv = (p: Vec3Tuple, q: Vec3Tuple) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const norm = (p: Vec3Tuple): Vec3Tuple => { const l = Math.hypot(...p) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
  let dA = norm(cross(nA, dir)), dB = norm(cross(nB, dir));
  const want = convex ? -1 : 1; // convex: moving along A goes behind B's plane
  if (Math.sign(dotv(dA, nB)) !== want) dA = [-dA[0], -dA[1], -dA[2]];
  if (Math.sign(dotv(dB, nA)) !== want) dB = [-dB[0], -dB[1], -dB[2]];
  const psi = Math.acos(Math.max(-1, Math.min(1, dotv(dA, dB)))); // wedge angle between the faces
  if (psi < 0.05 || psi > Math.PI - 0.05) return null;
  const m = norm([dA[0] + dB[0], dA[1] + dB[1], dA[2] + dB[2]]); // bisector, into the wedge
  // 2D frame in the section plane: u along dA, v = dir × u
  const u = dA, v = norm(cross(dir, u));
  const to2 = (p: Vec3Tuple): [number, number] => [dotv(p, u), dotv(p, v)];
  const sgn = convex ? 1 : -1; // outward along normals for a cut, inward for a fill
  const E: Vec3Tuple = [-(m[0]) * eps * sgn, -(m[1]) * eps * sgn, -(m[2]) * eps * sgn]; // corner nudged outward (cut) / inward (fill)
  const pts: Vec3Tuple[] = [E];
  if (kind === 'chamfer') {
    pts.push([dA[0] * size + nA[0] * eps * sgn, dA[1] * size + nA[1] * eps * sgn, dA[2] * size + nA[2] * eps * sgn]);
    pts.push([dB[0] * size + nB[0] * eps * sgn, dB[1] * size + nB[1] * eps * sgn, dB[2] * size + nB[2] * eps * sgn]);
  } else {
    const r = size, d = r / Math.tan(psi / 2), cdist = r / Math.sin(psi / 2);
    const C: Vec3Tuple = [m[0] * cdist, m[1] * cdist, m[2] * cdist];
    const TA: Vec3Tuple = [dA[0] * d, dA[1] * d, dA[2] * d], TB: Vec3Tuple = [dB[0] * d, dB[1] * d, dB[2] * d];
    pts.push([TA[0] + nA[0] * eps * sgn, TA[1] + nA[1] * eps * sgn, TA[2] + nA[2] * eps * sgn]);
    // arc from TA to TB on the circle around C, on the near side of the corner
    const a0 = to2([TA[0] - C[0], TA[1] - C[1], TA[2] - C[2]]), a1 = to2([TB[0] - C[0], TB[1] - C[1], TB[2] - C[2]]);
    const c2 = to2(C);
    let s0 = Math.atan2(a0[1], a0[0]), s1 = Math.atan2(a1[1], a1[0]);
    let sweep = s1 - s0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const n = Math.max(4, Math.ceil((Math.abs(sweep) * r) / 0.5));
    const arc: [number, number][] = [];
    for (let k = 1; k < n; k++) { const t = s0 + (sweep * k) / n; arc.push([c2[0] + Math.cos(t) * r, c2[1] + Math.sin(t) * r]); }
    pts.push([TB[0] + nB[0] * eps * sgn, TB[1] + nB[1] * eps * sgn, TB[2] + nB[2] * eps * sgn]);
    const flat = pts.map(to2);
    const out = [flat[0]!, flat[1]!, ...arc, flat[2]!];
    return { points: out, role: convex ? 'hole' : 'solid', frame: { u, v, origin: edge.a } };
  }
  return { points: pts.map(to2), role: convex ? 'hole' : 'solid', frame: { u, v, origin: edge.a } };
}
