import type { Vec2 } from '../../document/types.js';
import type { ModuleDefinition, FeatureSpec } from '../registry.js';
import { encodeHeightMap, heightMapSize, isHeightMap, proceduralHeightMap } from '../../raster/heightmap.js';

/**
 * Relief vase. A revolved vessel covered in fine vertical ribs, with a picture
 * pushed outward from the wall as low relief: where the picture is "ink", the
 * wall (ribs included) sits a millimetre or two further out, so the drawing
 * reads through light and shadow alone. Printed in spiral-vase mode it is one
 * continuous wall with no seams.
 *
 * Upload any SVG, PNG or JPG as the pattern; dark or filled areas are raised.
 * Flat illustrations give the cleanest relief; photos turn into a soft
 * gradient relief.
 */

export interface VaseShape { id: string; name: string; /** [radius fraction, height fraction] bottom → top */ curve: Vec2[] }

export const VASE_SHAPES: VaseShape[] = [
  { id: 'straight', name: 'Straight', curve: [[1, 0], [1, 1]] },
  { id: 'taper', name: 'Tapered', curve: [[0.82, 0], [1, 1]] },
  { id: 'belly', name: 'Belly', curve: [[0.72, 0], [0.92, 0.2], [1, 0.45], [0.92, 0.75], [0.76, 1]] },
  { id: 'hourglass', name: 'Hourglass', curve: [[1, 0], [0.9, 0.2], [0.74, 0.5], [0.9, 0.8], [1, 1]] },
  { id: 'flare', name: 'Flared', curve: [[0.7, 0], [0.74, 0.3], [0.84, 0.65], [1, 1]] },
  { id: 'bud', name: 'Bud', curve: [[0.64, 0], [0.9, 0.18], [1, 0.4], [0.94, 0.62], [0.7, 0.84], [0.56, 1]] },
];

export const VASE_PATTERNS = [
  { value: 'flower', label: 'Flower (sample)' },
  { value: 'dots', label: 'Dots (sample)' },
  { value: 'waves', label: 'Waves (sample)' },
  { value: 'none', label: 'None (ribs only)' },
] as const;

const sampleMaps = new Map<string, string>();
function sampleMap(kind: string): string {
  let s = sampleMaps.get(kind);
  if (!s) {
    const k = kind === 'dots' || kind === 'waves' ? kind : 'flower';
    s = encodeHeightMap(proceduralHeightMap(k));
    sampleMaps.set(kind, s);
  }
  return s;
}

export const reliefVaseModule: ModuleDefinition = {
  id: 'relief-vase',
  name: 'Relief vase',
  category: 'Vases',
  version: '1.0.0',
  description: 'A ribbed vase with an illustration raised from its wall as low relief. Upload an SVG or PNG; dark areas stand out. Print in spiral-vase mode.',
  inputs: [
    { key: 'shape', type: 'select', label: 'Shape', default: 'straight', options: VASE_SHAPES.map((s) => ({ value: s.id, label: s.name })) },
    { key: 'height', type: 'number', label: 'Height', default: 180, min: 40, max: 300, step: 1, unit: 'mm' },
    { key: 'diameter', type: 'number', label: 'Diameter', default: 80, min: 30, max: 220, step: 1, unit: 'mm' },
    { key: 'wall', type: 'number', label: 'Wall', default: 1.6, min: 0.8, max: 4, step: 0.1, unit: 'mm', help: 'In spiral-vase mode the slicer prints the outer surface only; the wall is its line width.' },
    { key: 'floor', type: 'number', label: 'Floor', default: 2, min: 0.6, max: 6, step: 0.2, unit: 'mm' },
    { key: 'ribs', type: 'number', label: 'Ribs', default: 120, min: 0, max: 400, step: 1, help: 'Fine vertical ribs around the whole vase. ~1.5–2.5 mm between ribs prints well with a 0.4 mm nozzle.' },
    { key: 'ribDepth', type: 'number', label: 'Rib depth', default: 0.7, min: 0, max: 4, step: 0.05, unit: 'mm' },
    { key: 'pattern', type: 'select', label: 'Pattern', default: 'flower', options: [...VASE_PATTERNS] },
    { key: 'image', type: 'image', label: 'Your picture', default: '', help: 'SVG, PNG or JPG. Overrides the sample pattern. Dark or filled areas are raised.' },
    { key: 'depth', type: 'number', label: 'Relief depth', default: 1.6, min: -5, max: 5, step: 0.1, unit: 'mm', help: 'Negative carves the picture into the wall instead.' },
    { key: 'repeat', type: 'number', label: 'Repeat around', default: 3, min: 1, max: 16, step: 1 },
    { key: 'rows', type: 'number', label: 'Rows', default: 1, min: 1, max: 8, step: 1 },
    { key: 'coverFrom', type: 'number', label: 'From', default: 8, min: 0, max: 100, step: 1, unit: '%', help: 'Height band the pattern covers, measured from the bottom.' },
    { key: 'coverTo', type: 'number', label: 'To', default: 92, min: 0, max: 100, step: 1, unit: '%' },
    { key: 'keepAspect', type: 'toggle', label: 'Keep proportions', default: true, help: 'Fit the rows inside the band without stretching the picture.' },
    { key: 'soften', type: 'number', label: 'Soften edges', default: 2, min: 0, max: 16, step: 1, unit: 'px' },
    { key: 'invert', type: 'toggle', label: 'Invert picture', default: false },
    { key: 'twist', type: 'number', label: 'Twist', default: 0, min: -180, max: 180, step: 1, unit: '°' },
    { key: 'detail', type: 'select', label: 'Detail', default: 'preview', options: [{ value: 'preview', label: 'Preview (fast)' }, { value: 'print', label: 'Print' }], help: 'Preview keeps sliders responsive. Switch to Print before exporting.' },
  ],
  build(i) {
    const shape = VASE_SHAPES.find((s) => s.id === i.shape) ?? VASE_SHAPES[0]!;
    const h = Number(i.height), r = Number(i.diameter) / 2, wall = Number(i.wall);
    const ribs = Math.round(Number(i.ribs)), ribDepth = Number(i.ribDepth);
    const preview = i.detail === 'preview';
    const map = isHeightMap(i.image) ? String(i.image) : i.pattern === 'none' ? '' : sampleMap(String(i.pattern));
    let from = Math.min(Number(i.coverFrom), Number(i.coverTo)) / 100;
    let to = Math.max(Number(i.coverFrom), Number(i.coverTo)) / 100;
    const repeat = Math.round(Number(i.repeat)), rows = Math.round(Number(i.rows));
    const size = heightMapSize(map);
    if (i.keepAspect && size) {
      // one tile is circumference / repeat wide; keep its proportions and centre the rows in the band
      const tileW = (2 * Math.PI * r) / repeat;
      const bandH = (rows * tileW * (size.height / size.width)) / h;
      if (bandH < to - from) { const mid = (from + to) / 2; from = mid - bandH / 2; to = mid + bandH / 2; }
    }

    const profile: Vec2[] = shape.curve.map(([rf, t]) => [Math.max(wall + 2, rf * r), t]);
    // enough segments around for ribs to stay round; relief refinement happens in the modifier
    const segments = Math.min(preview ? 256 : 720, Math.max(preview ? 96 : 192, ribs * (preview ? 3 : 4)));
    const vase: FeatureSpec = {
      type: 'revolve', name: 'Vase', profile, height: h, wall, floor: Number(i.floor), smoothing: 3, segments, open: false,
      modifiers: {
        twist: Number(i.twist),
        grooveAmplitude: ribs > 0 ? ribDepth : 0, grooveCount: Math.max(1, ribs),
        relief: {
          map, depth: Number(i.depth), repeat, rows,
          from, to: Math.max(from + 0.02, to), soften: Math.round(Number(i.soften)), invert: Boolean(i.invert), phase: 0,
        },
        coarseness: preview ? 2 : 1,
      },
    };
    return [vase];
  },
};
