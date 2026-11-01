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
 * Per-mesh adjacency, built once and cached on the mesh object: vertex ids
 * merged by position, the two triangles across each edge, and triangle
 * normals. Everything else here is O(size of the face), not of the mesh.
 */
interface Adjacency {
  /** merged vertex id per corner (3 per triangle) */
  vid: Int32Array;
  /** for corner k of triangle t (edge k→k+1): the triangle across, or -1 */
  across: Int32Array;
  /** unit normals, 3 per triangle; NaN for degenerate triangles */
  normals: Float32Array;
}
const adjacency = new WeakMap<TriangleMesh, Adjacency>();
function adjacencyOf(mesh: TriangleMesh): Adjacency {
  let a = adjacency.get(mesh);
  if (a) return a;
  const p = mesh.positions, idx = mesh.indices;
  const triCount = idx.length / 3;
  const vid = new Int32Array(idx.length);
  const ids = new Map<string, number>();
  for (let c = 0; c < idx.length; c++) {
    const vi = idx[c]! * 3;
    const k = key(p[vi]!, p[vi + 1]!, p[vi + 2]!);
    let id = ids.get(k);
    if (id === undefined) { id = ids.size; ids.set(k, id); }
    vid[c] = id;
  }
  // directed edge (a→b) → corner index; the reverse edge's owner is the triangle across
  const owner = new Map<number, number>();
  const n = ids.size;
  for (let c = 0; c < idx.length; c++) {
    const t = (c / 3) | 0, k = c % 3;
    owner.set(vid[c]! * n + vid[t * 3 + ((k + 1) % 3)]!, c);
  }
  const across = new Int32Array(idx.length).fill(-1);
  for (let c = 0; c < idx.length; c++) {
    const t = (c / 3) | 0, k = c % 3;
    const rev = owner.get(vid[t * 3 + ((k + 1) % 3)]! * n + vid[c]!);
    if (rev !== undefined) across[c] = (rev / 3) | 0;
  }
  const normals = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const nn = triNormal(p, idx, t);
    normals[t * 3] = nn ? nn[0] : NaN; normals[t * 3 + 1] = nn ? nn[1] : NaN; normals[t * 3 + 2] = nn ? nn[2] : NaN;
  }
  a = { vid, across, normals };
  adjacency.set(mesh, a);
  return a;
}

/** Flood-fill the coplanar region containing `start`; `taken` marks triangles already assigned (optional). */
function growFace(mesh: TriangleMesh, adj: Adjacency, start: number, cosTol: number, distTol: number, taken?: Int32Array, mark = 0): Set<number> | null {
  const p = mesh.positions, idx = mesh.indices;
  const nx = adj.normals[start * 3]!, ny = adj.normals[start * 3 + 1]!, nz = adj.normals[start * 3 + 2]!;
  if (Number.isNaN(nx)) return null;
  const a0 = idx[start * 3]! * 3;
  const d0 = nx * p[a0]! + ny * p[a0 + 1]! + nz * p[a0 + 2]!;
  const inPlane = (t: number) => {
    const tx = adj.normals[t * 3]!;
    if (Number.isNaN(tx)) return false;
    if (tx * nx + adj.normals[t * 3 + 1]! * ny + adj.normals[t * 3 + 2]! * nz < cosTol) return false;
    for (let e = 0; e < 3; e++) {
      const vi = idx[t * 3 + e]! * 3;
      if (Math.abs(nx * p[vi]! + ny * p[vi + 1]! + nz * p[vi + 2]! - d0) > distTol) return false;
    }
    return true;
  };
  const face = new Set<number>([start]);
  if (taken) taken[start] = mark;
  const stack = [start];
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      const u = adj.across[t * 3 + k]!;
      if (u < 0 || face.has(u)) continue;
      if (taken && taken[u] !== -1) continue;
      if (!inPlane(u)) continue;
      face.add(u);
      if (taken) taken[u] = mark;
      stack.push(u);
    }
  }
  return face;
}

/** Boundary loops of a set of triangles, as 3D polygons, outer first. */
function faceLoops(mesh: TriangleMesh, adj: Adjacency, face: Set<number>, n0: Vec3Tuple): Vec3Tuple[][] {
  const p = mesh.positions, idx = mesh.indices;
  // boundary corner → next boundary corner, keyed by merged vertex id of the edge start
  const next = new Map<number, number>();
  for (const t of face) for (let k = 0; k < 3; k++) {
    const u = adj.across[t * 3 + k]!;
    if (u >= 0 && face.has(u)) continue;
    next.set(adj.vid[t * 3 + k]!, t * 3 + k);
  }
  const loops: Vec3Tuple[][] = [];
  const used = new Set<number>();
  for (const [startV, corner0] of next) {
    if (used.has(startV)) continue;
    const loop: Vec3Tuple[] = [];
    let v = startV, c: number | undefined = corner0;
    while (c !== undefined && !used.has(v)) {
      used.add(v);
      const vi = idx[c]! * 3;
      loop.push([p[vi]!, p[vi + 1]!, p[vi + 2]!]);
      const t = (c / 3) | 0, k = c % 3;
      v = adj.vid[t * 3 + ((k + 1) % 3)]!;
      c = next.get(v);
    }
    if (loop.length >= 3) loops.push(simplifyCollinear(loop, n0));
  }
  loops.sort((x, y) => Math.abs(loopArea(y, n0)) - Math.abs(loopArea(x, n0)));
  return loops;
}

/**
 * Grow the planar face containing triangle `start`. `angleTol` is the max
 * normal deviation in degrees, `distTol` the max distance from the plane (mm).
 */
export function planarFace(mesh: TriangleMesh, start: number, angleTol = 1, distTol = 0.02): PlanarFace | null {
  const idx = mesh.indices, p = mesh.positions;
  if (start < 0 || start >= idx.length / 3) return null;
  const adj = adjacencyOf(mesh);
  const face = growFace(mesh, adj, start, Math.cos((angleTol * Math.PI) / 180), distTol);
  if (!face) return null;
  const n0: Vec3Tuple = [adj.normals[start * 3]!, adj.normals[start * 3 + 1]!, adj.normals[start * 3 + 2]!];
  const loops = faceLoops(mesh, adj, face, n0);
  if (loops.length === 0) return null;
  const c = idx[start * 3]! * 3, c2 = idx[start * 3 + 1]! * 3, c3 = idx[start * 3 + 2]! * 3;
  const origin: Vec3Tuple = [(p[c]! + p[c2]! + p[c3]!) / 3, (p[c + 1]! + p[c2 + 1]! + p[c3 + 1]!) / 3, (p[c + 2]! + p[c2 + 2]! + p[c3 + 2]!) / 3];
  return { normal: n0, origin, loops, triangles: [...face] };
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
  const adj = adjacencyOf(mesh);
  const p = mesh.positions, idx = mesh.indices;
  const triCount = idx.length / 3;
  const triFace = new Int32Array(triCount).fill(-1);
  const cosTol = Math.cos((1 * Math.PI) / 180);
  for (let t = 0; t < triCount; t++) {
    if (triFace[t] !== -1) continue;
    const id = faces.length;
    const set = growFace(mesh, adj, t, cosTol, 0.02, triFace, id);
    if (!set) { triFace[t] = -2; continue; }
    const n0: Vec3Tuple = [adj.normals[t * 3]!, adj.normals[t * 3 + 1]!, adj.normals[t * 3 + 2]!];
    const loops = faceLoops(mesh, adj, set, n0);
    const c = idx[t * 3]! * 3;
    faces.push({ normal: n0, origin: [p[c]!, p[c + 1]!, p[c + 2]!], loops, triangles: [...set] });
  }
  if (faces.length > 4000) return { faces, edges }; // an organic surface: no straight edges worth picking
  const cosMin = Math.cos((minAngleDeg * Math.PI) / 180);
  const raw: MeshEdge[] = [];
  for (let t = 0; t < triCount; t++) {
    const fa = triFace[t]!;
    if (fa < 0) continue;
    for (let k = 0; k < 3; k++) {
      const u = adj.across[t * 3 + k]!;
      if (u < 0) continue;
      const fb = triFace[u]!;
      if (fb < 0 || fb === fa || fb < fa) continue; // each face pair once, from the lower face id
      const A = faces[fa]!, B = faces[fb]!;
      const dot = A.normal[0] * B.normal[0] + A.normal[1] * B.normal[1] + A.normal[2] * B.normal[2];
      if (dot > cosMin) continue;
      const ai = idx[t * 3 + k]! * 3, bi = idx[t * 3 + ((k + 1) % 3)]! * 3;
      const a: Vec3Tuple = [p[ai]!, p[ai + 1]!, p[ai + 2]!], b: Vec3Tuple = [p[bi]!, p[bi + 1]!, p[bi + 2]!];
      const d: Vec3Tuple = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(...d);
      if (len < 1e-6) continue;
      const cB = centroid(B.loops[0] ?? [B.origin]);
      const side = (cB[0] - a[0]) * A.normal[0] + (cB[1] - a[1]) * A.normal[1] + (cB[2] - a[2]) * A.normal[2];
      raw.push({ a, b, dir: [d[0] / len, d[1] / len, d[2] / len], length: len, nA: A.normal, nB: B.normal, convex: side < 0, faceA: fa, faceB: fb });
    }
  }
  // merge collinear segments between the same face pair into one edge
  const groups = new Map<string, MeshEdge[]>();
  for (const e of raw) { const g = `${e.faceA}|${e.faceB}`; (groups.get(g) ?? groups.set(g, []).get(g)!).push(e); }
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
