/**
 * Height maps: small grayscale images (0..255) that drive surface relief.
 *
 * They travel inside documents and module inputs as one compact string,
 * `hm1:<width>:<height>:<base64 bytes>`, so a `.forma` file stays plain JSON
 * and the evaluator cache key stays content-addressed. A 256×256 map is
 * ~88 kB of text. Pure functions; no DOM (base64 via globalThis.btoa/atob,
 * which Node ≥ 16, browsers and workers all provide).
 */
import type { Raster } from './trace.js';

export interface HeightMap {
  width: number;
  height: number;
  /** row-major, 0 = flat, 255 = full depth; row 0 is the TOP of the image */
  data: Uint8Array;
}

const PREFIX = 'hm1';
/** Largest map side we store; anything bigger is downsampled when encoding. */
export const HEIGHTMAP_MAX_SIDE = 256;

export function encodeHeightMap(map: HeightMap): string {
  if (map.data.length !== map.width * map.height) throw new Error('height map size mismatch');
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < map.data.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(map.data.subarray(i, i + chunk)));
  return `${PREFIX}:${map.width}:${map.height}:${globalThis.btoa(bin)}`;
}

/** Returns null for an empty or malformed string. */
export function decodeHeightMap(s: string): HeightMap | null {
  if (!s || !s.startsWith(PREFIX + ':')) return null;
  const parts = s.split(':');
  if (parts.length !== 4) return null;
  const width = Number(parts[1]), height = Number(parts[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  let bin: string;
  try { bin = globalThis.atob(parts[3]!); } catch { return null; }
  if (bin.length !== width * height) return null;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = bin.charCodeAt(i);
  return { width, height, data };
}

export const isHeightMap = (s: unknown): s is string => typeof s === 'string' && s.startsWith(PREFIX + ':');

/** Width and height from the header alone, without decoding the pixels. */
export function heightMapSize(s: string): { width: number; height: number } | null {
  if (!isHeightMap(s)) return null;
  const [, w, h] = s.split(':', 3);
  const width = Number(w), height = Number(h);
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : null;
}

/** Coverage raster (0..1) → height map, downsampled with box filtering so it fits `maxSide`. */
export function rasterToHeightMap(raster: Raster, maxSide = HEIGHTMAP_MAX_SIDE): HeightMap {
  const scale = Math.min(1, maxSide / Math.max(raster.width, raster.height));
  const width = Math.max(1, Math.round(raster.width * scale)), height = Math.max(1, Math.round(raster.height * scale));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.floor((y + 1) / scale));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.floor((x + 1) / scale));
      let sum = 0, n = 0;
      for (let yy = y0; yy < Math.min(y1, raster.height); yy++) for (let xx = x0; xx < Math.min(x1, raster.width); xx++) { sum += raster.data[yy * raster.width + xx]!; n++; }
      data[y * width + x] = n ? Math.round(255 * Math.min(1, Math.max(0, sum / n))) : 0;
    }
  }
  return { width, height, data };
}

/** Separable box blur run twice (≈ gaussian). `radius` in pixels; 0 returns the input. Wraps horizontally when `wrapX`. */
export function blurHeightMap(map: HeightMap, radius: number, wrapX = true): HeightMap {
  const r = Math.round(radius);
  if (r <= 0) return map;
  const { width: W, height: H } = map;
  let src = Float32Array.from(map.data);
  let dst = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    // horizontal
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + idx(k, W, wrapX)]!;
      for (let x = 0; x < W; x++) {
        dst[row + x] = acc / n;
        acc += src[row + idx(x + r + 1, W, wrapX)]! - src[row + idx(x - r, W, wrapX)]!;
      }
    }
    [src, dst] = [dst, src];
    // vertical (clamped)
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[idx(k, H, false) * W + x]!;
      for (let y = 0; y < H; y++) {
        dst[y * W + x] = acc / n;
        acc += src[idx(y + r + 1, H, false) * W + x]! - src[idx(y - r, H, false) * W + x]!;
      }
    }
    [src, dst] = [dst, src];
  }
  const data = new Uint8Array(W * H);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(src[i]!);
  return { width: W, height: H, data };
}

function idx(i: number, n: number, wrap: boolean): number {
  if (wrap) return ((i % n) + n) % n;
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Bilinear sample in 0..1. `u` runs left→right and wraps (the map is tiled
 * around a part); `v` runs bottom→top of the *part*, so v = 0 reads the
 * bottom row of the image.
 */
export function sampleHeightMap(map: HeightMap, u: number, v: number, wrapV = false): number {
  const { width: W, height: H, data } = map;
  const fx = ((u % 1) + 1) % 1 * W - 0.5;
  const vv = wrapV ? ((v % 1) + 1) % 1 : Math.min(1, Math.max(0, v));
  const fy = (1 - vv) * H - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const xa = idx(x0, W, true), xb = idx(x0 + 1, W, true);
  const ya = idx(y0, H, wrapV), yb = idx(y0 + 1, H, wrapV);
  const a = data[ya * W + xa]!, b = data[ya * W + xb]!, c = data[yb * W + xa]!, d = data[yb * W + xb]!;
  return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) / 255;
}

/** Procedural maps so a relief module shows something before anything is uploaded. */
export function proceduralHeightMap(kind: 'flower' | 'dots' | 'waves' | 'checker', size = 128): HeightMap {
  const data = new Uint8Array(size * size);
  const set = (x: number, y: number, v: number) => { data[y * size + x] = Math.round(255 * Math.min(1, Math.max(0, v))); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    switch (kind) {
      case 'flower': {
        // five round petals around a centre disc, like a naive daisy
        const cx = u - 0.5, cy = v - 0.5;
        let on = Math.hypot(cx, cy) < 0.12 ? 1 : 0;
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * 0.27, py = Math.sin(a) * 0.27;
          if (Math.hypot(cx - px, cy - py) < 0.17) on = 1;
        }
        set(x, y, on);
        break;
      }
      case 'dots': {
        const gx = (u * 4) % 1 - 0.5, gy = (v * 4) % 1 - 0.5;
        set(x, y, Math.hypot(gx, gy) < 0.3 ? 1 : 0);
        break;
      }
      case 'waves':
        set(x, y, 0.5 + 0.5 * Math.sin((u * 2 + 0.25 * Math.sin(v * Math.PI * 4)) * Math.PI * 2));
        break;
      case 'checker':
        set(x, y, (Math.floor(u * 4) + Math.floor(v * 4)) % 2);
        break;
    }
  }
  return { width: size, height: size, data };
}
