/**
 * Direct mesh builder for a revolve with surface modifiers.
 *
 * `refineToLength` + `warp` is fine for a few thousand triangles, but a vase
 * with 120 ribs and an image relief needs ~0.5 mm vertices over the whole
 * wall. Subdividing the revolve to that density produces millions of skinny
 * triangles and takes tens of seconds; generating the (angle × height) grid
 * directly costs a few hundred thousand well-shaped triangles and runs in a
 * fraction of a second. Every modifier (taper, twist, ripple, grooves,
 * relief) is evaluated analytically per grid vertex, identical to
 * `applyModifiers`, so the two paths agree.
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { FeatureOf, Modifiers, Relief } from '../document/types.js';
import { defaultRelief } from '../document/types.js';
import { chaikin } from './profile.js';
import { blurHeightMap, decodeHeightMap, sampleHeightMap, type HeightMap } from '../raster/heightmap.js';

const deg2rad = Math.PI / 180;
/** fraction of the covered band over which the relief eases in and out, so bands never start with a ledge */
const RELIEF_FADE = 0.02;
const MAX_ROWS = 720;

export const reliefOf = (m: Modifiers): Relief => ({ ...defaultRelief(), ...(m.relief ?? {}) });
export const hasRelief = (r: Relief) => r.depth !== 0 && r.map !== '';
/** Every relief layer of a part, normalised, including the primary `relief`. */
export const reliefLayers = (m: Modifiers): Relief[] => [reliefOf(m), ...(m.reliefs ?? []).map((r) => ({ ...defaultRelief(), ...r }))].filter(hasRelief);
export const hasModifiers = (m: Modifiers) => m.twist !== 0 || m.taper !== 0 || m.rippleAmplitude !== 0 || m.grooveAmplitude !== 0 || (m.fuzz ?? 0) !== 0 || reliefLayers(m).length > 0;

/** Deterministic hash noise in 0..1 on an integer lattice, smoothly interpolated (value noise). */
function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Decoded (and softened) height maps, keyed by content so slider drags don't re-decode. */
const mapCache = new Map<string, HeightMap | null>();
export function reliefMap(r: Relief): HeightMap | null {
  if (!hasRelief(r)) return null;
  const key = `${r.soften}|${r.map}`;
  const hit = mapCache.get(key);
  if (hit !== undefined) return hit;
  const decoded = decodeHeightMap(r.map);
  const out = decoded ? blurHeightMap(decoded, r.soften) : null;
  mapCache.set(key, out);
  if (mapCache.size > 24) mapCache.delete(mapCache.keys().next().value as string);
  return out;
}

export interface ReliefLayer { relief: Relief; map: HeightMap }
export const decodedLayers = (mods: Modifiers): ReliefLayer[] => reliefLayers(mods).flatMap((relief) => { const map = reliefMap(relief); return map ? [{ relief, map }] : []; });

/**
 * Radial displacement in mm at angle `a` (rad), height fraction `t` and
 * height `z` (mm), from ripple, grooves (optionally beaded), fuzz and every
 * relief layer. `h` is the part height, for the groove bead period and fuzz.
 */
export function displacementAt(mods: Modifiers, layers: ReliefLayer[], a: number, t: number, h: number, radius: number): number {
  let d = 0;
  if (mods.rippleAmplitude) d += mods.rippleAmplitude * Math.sin(t * mods.rippleWaves * Math.PI * 2);
  if (mods.grooveAmplitude) {
    let ridge = 0.5 * (1 + Math.cos(a * mods.grooveCount));
    const wl = mods.grooveWaveLength ?? 0;
    if (wl > 0) {
      // beads: modulate the ridge along z; stagger shifts odd ribs by half a period
      const rib = Math.round((a * mods.grooveCount) / (2 * Math.PI));
      const shift = mods.grooveStagger && rib % 2 !== 0 ? Math.PI : 0;
      ridge *= 0.35 + 0.65 * 0.5 * (1 + Math.cos((t * h * 2 * Math.PI) / wl + shift));
    }
    d += mods.grooveAmplitude * ridge;
  }
  if (mods.fuzz) {
    const cell = Math.max(0.2, mods.fuzzScale ?? 1.5);
    const cells = Math.max(4, Math.round((2 * Math.PI * radius) / cell));
    const u = ((a / (2 * Math.PI)) + 1) % 1 * cells; // wraps seamlessly around
    d += mods.fuzz * (valueNoise(u, (t * h) / cell) - 0.5);
  }
  for (const { relief, map } of layers) {
    const band = Math.max(1e-6, relief.to - relief.from);
    const tv = (t - relief.from) / band;
    if (tv < 0 || tv > 1) continue;
    const u = ((a - relief.phase * deg2rad) / (2 * Math.PI) + 0.5) * relief.repeat;
    // a single (non-repeating) picture covers only its own tile; outside it there is nothing
    if (!relief.tile) {
      const uu = ((u % 1) + 1) % 1;
      if (uu < 0.5 - relief.width / 2 || uu > 0.5 + relief.width / 2) continue;
      let s = sampleHeightMap(map, (uu - 0.5) / relief.width + 0.5, tv);
      if (relief.invert) s = 1 - s;
      const ease = Math.min(1, Math.min(tv, 1 - tv) / RELIEF_FADE);
      d += relief.depth * s * ease;
      continue;
    }
    let s = sampleHeightMap(map, u, tv * relief.rows, relief.rows > 1);
    if (relief.invert) s = 1 - s;
    const ease = Math.min(1, Math.min(tv, 1 - tv) / RELIEF_FADE);
    d += relief.depth * s * ease;
  }
  return d;
}

/** Vertex spacing that resolves every modifier without wasting triangles. */
export function modifierEdgeLength(mods: Modifiers, layers: ReliefLayer[], radius: number, h: number): number {
  let edge = Math.max(0.6, Math.min(h, radius * 2) / 40);
  const circumference = 2 * Math.PI * radius;
  if (mods.grooveAmplitude) {
    edge = Math.min(edge, circumference / (mods.grooveCount * 5));
    if ((mods.grooveWaveLength ?? 0) > 0) edge = Math.min(edge, mods.grooveWaveLength / 4);
  }
  if (mods.fuzz) edge = Math.min(edge, Math.max(0.2, mods.fuzzScale ?? 1.5) / 2);
  for (const { relief, map } of layers) {
    const band = Math.max(0.05, relief.to - relief.from);
    const tileW = relief.tile ? 1 / relief.repeat : relief.width;
    const pxAround = (circumference * tileW) / map.width;
    const pxUp = (h * band) / (relief.rows * map.height);
    edge = Math.min(edge, Math.max(pxAround, pxUp) * 1.2);
  }
  return Math.max(0.45, edge) * (mods.coarseness ?? 1);
}

/** Piecewise-linear radius lookup over a [radius, heightFraction] side profile. */
function radiusFn(side: [number, number][]): (t: number) => number {
  return (t) => {
    if (t <= side[0]![1]) return side[0]![0];
    for (let k = 1; k < side.length; k++) {
      const [r1, t1] = side[k]!;
      if (t <= t1) {
        const [r0, t0] = side[k - 1]!;
        const u = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        return r0 + (r1 - r0) * u;
      }
    }
    return side[side.length - 1]![0];
  };
}

/**
 * Build a revolve (solid, cup with floor, or open sleeve) with its modifiers
 * baked into an indexed grid mesh. Returns a fresh Manifold; caller deletes.
 * Throws a plain Error when the mesh is not watertight (callers wrap it).
 */
export function buildDisplacedRevolve(wasm: ManifoldToplevel, f: FeatureOf<'revolve'>): Manifold {
  const mods = f.modifiers;
  const layers = decodedLayers(mods);
  const h = f.height;
  const side = chaikin(f.profile, f.smoothing).map(([r, t]): [number, number] => [Math.max(0.01, r), Math.min(1, Math.max(0, t))]);
  const R = radiusFn(side);
  const maxR = side.reduce((m, [r]) => Math.max(m, r), 0);

  const edge = modifierEdgeLength(mods, layers, maxR, h);
  const N = Math.max(8, Math.round(f.segments));
  const M = Math.min(MAX_ROWS, Math.max(2, Math.ceil(h / edge)));
  const vessel = f.wall > 0;
  const open = vessel && f.open;
  const floor = vessel && !open ? Math.min(f.floor, h - 0.5) : 0;
  const taper = mods.taper / 100, twist = mods.twist * deg2rad;

  // Vertex layout: outer grid (M+1 rows × N), then inner grid (vessels), then centre points.
  const outerCount = (M + 1) * N;
  const innerCount = vessel ? (M + 1) * N : 0;
  const centres = vessel ? (open ? 0 : 2) : 2;
  const verts = new Float32Array((outerCount + innerCount + centres) * 3);
  let vi = 0;
  const put = (x: number, y: number, z: number) => { verts[vi++] = x; verts[vi++] = y; verts[vi++] = z; };

  const ring = (i: number, inner: boolean) => {
    // inner rows run from the floor to the top so the floor joins cleanly
    const z = inner ? floor + (h - floor) * (i / M) : h * (i / M);
    const t = z / h;
    const base = R(t) - (inner ? f.wall : 0);
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const r = Math.max(0.01, base * (1 + taper * t) + displacementAt(mods, layers, a, t, h, maxR));
      const aa = a + twist * t;
      put(Math.cos(aa) * r, Math.sin(aa) * r, z);
    }
  };
  for (let i = 0; i <= M; i++) ring(i, false);
  if (vessel) for (let i = 0; i <= M; i++) ring(i, true);
  const O = (i: number, j: number) => i * N + (j % N);
  const I = (i: number, j: number) => outerCount + i * N + (j % N);
  let cBottom = -1, cTop = -1;
  if (!open) { cBottom = (vi / 3); put(0, 0, 0); cTop = (vi / 3); put(0, 0, vessel ? floor : h); }

  const quads = M * N;
  const triCount = quads * 2 + (vessel ? quads * 2 + N * 2 /* rim */ + (open ? N * 2 : N * 2) : N * 2);
  const tris = new Uint32Array(triCount * 3);
  let ti = 0;
  const tri = (a: number, b: number, c: number) => { tris[ti++] = a; tris[ti++] = b; tris[ti++] = c; };
  for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
    tri(O(i, j), O(i, j + 1), O(i + 1, j + 1));
    tri(O(i, j), O(i + 1, j + 1), O(i + 1, j));
    if (vessel) {
      tri(I(i, j), I(i + 1, j + 1), I(i, j + 1));
      tri(I(i, j), I(i + 1, j), I(i + 1, j + 1));
    }
  }
  for (let j = 0; j < N; j++) {
    if (vessel) {
      // top rim, facing up
      tri(O(M, j), O(M, j + 1), I(M, j + 1));
      tri(O(M, j), I(M, j + 1), I(M, j));
      if (open) {
        // bottom rim, facing down
        tri(O(0, j), I(0, j + 1), O(0, j + 1));
        tri(O(0, j), I(0, j), I(0, j + 1));
      } else {
        tri(cBottom, O(0, j + 1), O(0, j)); // underside
        tri(cTop, I(0, j), I(0, j + 1)); // floor, facing up
      }
    } else {
      tri(cBottom, O(0, j + 1), O(0, j));
      tri(cTop, O(M, j), O(M, j + 1));
    }
  }
  if (ti !== tris.length) throw new Error(`revolve mesh: expected ${tris.length / 3} triangles, built ${ti / 3}`);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: verts, triVerts: tris });
  const m = wasm.Manifold.ofMesh(mesh);
  if (m.isEmpty()) { m.delete(); throw new Error('revolve mesh is empty'); }
  return m;
}
