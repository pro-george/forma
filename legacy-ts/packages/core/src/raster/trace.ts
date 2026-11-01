/**
 * Raster → vector outlines (marching squares + loop linking), used to turn
 * canvas-rendered text or uploaded images into extrudable profiles.
 * Pure functions; no DOM.
 */
import type { Vec2, Profile } from '../document/types.js';
import { pointInPolygon, signedArea, simplifyLoop } from '../geometry/profile.js';

export interface Raster {
  /** coverage 0..1 per pixel, row-major */
  data: Float32Array;
  width: number;
  height: number;
}

/** Contours at `iso` in pixel coordinates (y down). The raster is padded so shapes touching the edge close. */
export function traceRaster(raster: Raster, iso = 0.5): Vec2[][] {
  const W = raster.width + 2, H = raster.height + 2;
  const F = new Float32Array(W * H);
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) F[(y + 1) * W + x + 1] = raster.data[y * raster.width + x]!;
  }
  const pts: Vec2[] = [];
  const ptIndex = new Map<string, number>();
  const adj: number[][] = [];
  const ep = (key: string, x1: number, y1: number, v1: number, x2: number, y2: number, v2: number): number => {
    let i = ptIndex.get(key);
    if (i !== undefined) return i;
    const t = (iso - v1) / (v2 - v1 || 1e-9);
    pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    i = pts.length - 1;
    ptIndex.set(key, i);
    return i;
  };
  const link = (i: number, j: number) => { (adj[i] ||= []).push(j); (adj[j] ||= []).push(i); };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const v0 = F[y * W + x]!, v1 = F[y * W + x + 1]!, v2 = F[(y + 1) * W + x + 1]!, v3 = F[(y + 1) * W + x]!;
      const c = (v0 >= iso ? 8 : 0) | (v1 >= iso ? 4 : 0) | (v2 >= iso ? 2 : 0) | (v3 >= iso ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = () => ep(`h${x},${y}`, x, y, v0, x + 1, y, v1);
      const R = () => ep(`v${x + 1},${y}`, x + 1, y, v1, x + 1, y + 1, v2);
      const B = () => ep(`h${x},${y + 1}`, x, y + 1, v3, x + 1, y + 1, v2);
      const L = () => ep(`v${x},${y}`, x, y, v0, x, y + 1, v3);
      switch (c) {
        case 1: case 14: link(L(), B()); break;
        case 2: case 13: link(B(), R()); break;
        case 3: case 12: link(L(), R()); break;
        case 4: case 11: link(T(), R()); break;
        case 6: case 9: link(T(), B()); break;
        case 7: case 8: link(T(), L()); break;
        case 5: if ((v0 + v1 + v2 + v3) / 4 >= iso) { link(T(), R()); link(B(), L()); } else { link(T(), L()); link(B(), R()); } break;
        case 10: if ((v0 + v1 + v2 + v3) / 4 >= iso) { link(T(), L()); link(B(), R()); } else { link(T(), R()); link(B(), L()); } break;
      }
    }
  }
  const used = new Uint8Array(pts.length);
  const loops: Vec2[][] = [];
  for (let s = 0; s < pts.length; s++) {
    if (used[s] || !adj[s]) continue;
    const loop: Vec2[] = [];
    let prev = -1, cur = s;
    while (cur !== -1 && !used[cur]) {
      used[cur] = 1;
      loop.push(pts[cur]!);
      const nb = adj[cur]!;
      const nx = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = nx === undefined ? -1 : nx;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Nest loops into outer shapes with holes (even-odd depth). */
export function loopsToProfiles(loops: Vec2[][]): Profile[] {
  const info = loops.map((pts) => ({ pts, area: Math.abs(signedArea(pts)), depth: 0, holes: [] as Vec2[][] }));
  for (const a of info) for (const b of info) {
    if (a === b || b.area <= a.area) continue;
    if (pointInPolygon(a.pts[0]!, b.pts)) a.depth++;
  }
  const outers = info.filter((i) => i.depth % 2 === 0);
  for (const h of info.filter((i) => i.depth % 2 === 1)) {
    let best: (typeof info)[number] | null = null;
    for (const o of outers) {
      if (o.area > h.area && pointInPolygon(h.pts[0]!, o.pts) && (!best || o.area < best.area)) best = o;
    }
    if (best) best.holes.push(h.pts);
  }
  return outers.map((o) => ({ outer: o.pts, holes: o.holes }));
}

export interface TraceOptions {
  /** mm per pixel */
  scale: number;
  /** simplification tolerance in pixels */
  tolerance?: number;
  /** drop loops smaller than this many px² (noise) */
  minArea?: number;
  iso?: number;
}

/**
 * Full pipeline: raster → simplified, centred profiles in mm with Y up
 * (raster rows go down, model Y goes up, so the image is flipped once here).
 */
export function rasterToProfiles(raster: Raster, opts: TraceOptions): { profiles: Profile[]; width: number; height: number } {
  const tol = opts.tolerance ?? 0.35, minArea = opts.minArea ?? 4;
  const loops = traceRaster(raster, opts.iso ?? 0.5)
    .map((l) => simplifyLoop(l, tol))
    .filter((l) => l.length >= 3 && Math.abs(signedArea(l)) > minArea);
  if (loops.length === 0) return { profiles: [], width: 0, height: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of loops) for (const [x, y] of l) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, s = opts.scale;
  const mm = loops.map((l) => l.map(([x, y]): Vec2 => [round3((x - cx) * s), round3(-(y - cy) * s)]));
  return { profiles: loopsToProfiles(mm), width: (maxX - minX) * s, height: (maxY - minY) * s };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
