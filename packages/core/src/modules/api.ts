/**
 * Helpers handed to module build() functions.
 */
import type { Profile, Vec2 } from '../document/types.js';
import { circle, regularPolygon, roundedRect, translatePoints, bounds } from '../geometry/profile.js';
import { rasterToProfiles, type Raster } from '../raster/trace.js';

export interface TextFont {
  /** CSS font-family, e.g. '"IBM Plex Sans", sans-serif' */
  family: string;
  weight?: number | string;
  italic?: boolean;
}

export interface TextRaster extends Raster {
  /** pixel height of a capital H, used to scale to the requested mm height */
  capHeightPx: number;
}

/** Environment hook: render text to a coverage raster (canvas in browsers/workers). */
export type TextRasterizer = (text: string, font: TextFont, fontPx: number) => TextRaster;

export interface TextResult {
  profiles: Profile[];
  /** overall bounds in mm, centred on the origin */
  width: number;
  height: number;
}

export interface ModuleApi {
  roundedRect: typeof roundedRect;
  circle: typeof circle;
  regularPolygon: typeof regularPolygon;
  translate: typeof translatePoints;
  bounds: typeof bounds;
  /** Outline text at a given capital-letter height in mm. Throws if no rasterizer is installed. */
  text(text: string, font: TextFont, capHeightMm: number): TextResult;
  /** Convert any coverage raster (e.g. an uploaded logo) to profiles. */
  traceRaster(raster: Raster, mmPerPixel: number): TextResult;
  /** true when text() is available in this environment */
  readonly hasText: boolean;
}

export function createModuleApi(rasterizer: TextRasterizer | null): ModuleApi {
  const cache = new Map<string, TextResult>();
  return {
    roundedRect, circle, regularPolygon, translate: translatePoints, bounds,
    get hasText() { return rasterizer !== null; },
    text(text, font, capHeightMm) {
      if (!rasterizer) throw new Error('Text rendering is not available in this environment');
      const key = JSON.stringify([text, font, capHeightMm]);
      const hit = cache.get(key);
      if (hit) return hit;
      const fontPx = 128;
      const r = rasterizer(text, font, fontPx);
      const scale = capHeightMm / Math.max(1, r.capHeightPx);
      const res = rasterToProfiles(r, { scale, tolerance: 0.35, minArea: 6 });
      const out: TextResult = { profiles: res.profiles, width: res.width, height: res.height };
      cache.set(key, out);
      if (cache.size > 200) cache.delete(cache.keys().next().value as string);
      return out;
    },
    traceRaster(raster, mmPerPixel) {
      const res = rasterToProfiles(raster, { scale: mmPerPixel, tolerance: 0.6, minArea: 9 });
      return { profiles: res.profiles, width: res.width, height: res.height };
    },
  };
}

/**
 * Canvas-based rasterizer for browsers and workers. Pass a factory so the
 * caller decides between HTMLCanvasElement and OffscreenCanvas.
 */
export function canvasTextRasterizer(createCanvas: (w: number, h: number) => { getContext(id: '2d'): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null; width: number; height: number }): TextRasterizer {
  return (text, font, fontPx) => {
    const css = `${font.italic ? 'italic ' : ''}${font.weight ?? 400} ${fontPx}px ${font.family}`;
    const probe = createCanvas(4, 4);
    let ctx = probe.getContext('2d')!;
    ctx.font = css;
    const capHeightPx = ctx.measureText('H').actualBoundingBoxAscent || fontPx * 0.7;
    const m = ctx.measureText(text);
    const pad = 4;
    const w = Math.max(2, Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2);
    const h = Math.max(2, Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + pad * 2);
    const c = createCanvas(w, h);
    ctx = c.getContext('2d')!;
    ctx.font = css;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);
    const img = ctx.getImageData(0, 0, w, h).data;
    const data = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = img[i * 4 + 3]! / 255;
    return { data, width: w, height: h, capHeightPx };
  };
}

export type { Vec2, Profile, Raster };
