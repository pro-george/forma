import type { Relief, Vec2 } from '../../document/types.js';
import { defaultRelief } from '../../document/types.js';
import type { ModuleDefinition, ModuleInput, ModuleInputValues, FeatureSpec } from '../registry.js';
import { encodeHeightMap, heightMapSize, isHeightMap, proceduralHeightMap } from '../../raster/heightmap.js';

/**
 * Relief vase. A revolved vessel covered in fine vertical ribs, with pictures
 * and text pushed outward from the wall as low relief: where a picture is
 * "ink", the wall (ribs included) sits a millimetre or two further out, so
 * the drawing reads through light and shadow alone. Printed in spiral-vase
 * mode it is one continuous wall with no seams.
 *
 * Layers, all optional and summed:
 *  - a tiled pattern (sample or uploaded) repeated around the vase
 *  - a front picture and a back picture, each placed once
 *  - a line of text
 * Ribs come in styles: straight, beads (each rib is a stack of pearls),
 * woven (beads staggered on alternate ribs), fuzzy (random skin).
 */

export interface VaseShape { id: string; name: string; /** [radius fraction, height fraction] bottom → top */ curve: Vec2[] }

export const VASE_SHAPES: VaseShape[] = [
  { id: 'straight', name: 'Straight', curve: [[1, 0], [1, 1]] },
  { id: 'taper', name: 'Tapered', curve: [[0.82, 0], [1, 1]] },
  { id: 'belly', name: 'Belly', curve: [[0.72, 0], [0.92, 0.2], [1, 0.45], [0.92, 0.75], [0.76, 1]] },
  { id: 'hourglass', name: 'Hourglass', curve: [[1, 0], [0.9, 0.2], [0.74, 0.5], [0.9, 0.8], [1, 1]] },
  { id: 'flare', name: 'Flared', curve: [[0.7, 0], [0.74, 0.3], [0.84, 0.65], [1, 1]] },
  { id: 'bud', name: 'Bud', curve: [[0.64, 0], [0.9, 0.18], [1, 0.4], [0.94, 0.62], [0.7, 0.84], [0.56, 1]] },
  { id: 'custom', name: 'Custom (draw it)', curve: [[0.9, 0], [1, 0.3], [0.85, 0.7], [0.7, 1]] },
];

export const VASE_PATTERNS = [
  { value: 'flower', label: 'Flower (sample)' },
  { value: 'dots', label: 'Dots (sample)' },
  { value: 'waves', label: 'Waves (sample)' },
  { value: 'upload', label: 'Uploaded picture' },
  { value: 'none', label: 'None' },
] as const;

export const RIB_STYLES = [
  { value: 'straight', label: 'Straight ribs' },
  { value: 'beads', label: 'Beads (pearl rows)' },
  { value: 'woven', label: 'Woven (staggered beads)' },
  { value: 'fuzzy', label: 'Fuzzy skin' },
  { value: 'none', label: 'Smooth (no ribs)' },
] as const;

export const VASE_FONTS = [
  { value: '"IBM Plex Sans", sans-serif', label: 'Plex Sans' },
  { value: '"IBM Plex Mono", monospace', label: 'Plex Mono' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
];

/** Suggested slicer settings; the relief and ribs are tuned for these. */
export const VASE_PRINT_NOTES = 'Slice in spiral vase mode (Bambu/Orca: "Spiral vase"; Cura: "Spiralize outer contour"). 0.4 mm nozzle, 0.6 mm line width, 0.2 mm layers, 3 bottom layers, 0 top layers, no infill. PLA or PETG, print slow (30–40 mm/s) so the beads and relief stay crisp.';
const NOZZLE = 0.4;

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

const num = (v: unknown) => Number(v);
const ribStyleShown = { ribStyle: ['straight', 'beads', 'woven', 'fuzzy'] };
const beadsShown = { ribStyle: ['beads', 'woven'] };

const inputs: ModuleInput[] = [
  // shape
  { key: 'shape', type: 'select', label: 'Shape', default: 'straight', group: 'Shape', options: VASE_SHAPES.map((s) => ({ value: s.id, label: s.name })) },
  { key: 'profile', type: 'profile', label: 'Side profile', default: JSON.stringify(VASE_SHAPES[VASE_SHAPES.length - 1]!.curve), group: 'Shape', showWhen: { shape: ['custom'] }, help: 'Drag the points; radius is relative to the diameter below.' },
  { key: 'height', type: 'number', label: 'Height', default: 180, min: 40, max: 300, step: 1, unit: 'mm', group: 'Shape' },
  { key: 'diameter', type: 'number', label: 'Diameter', default: 80, min: 30, max: 220, step: 1, unit: 'mm', group: 'Shape' },
  { key: 'wall', type: 'number', label: 'Wall', default: 1.6, min: 0.8, max: 4, step: 0.1, unit: 'mm', group: 'Shape', help: 'In spiral-vase mode the slicer prints the outer surface only; the wall is its line width.' },
  { key: 'floor', type: 'number', label: 'Floor', default: 2, min: 0.6, max: 6, step: 0.2, unit: 'mm', group: 'Shape' },
  { key: 'twist', type: 'number', label: 'Twist', default: 0, min: -180, max: 180, step: 1, unit: '°', group: 'Shape', help: 'Turns the ribs into diagonals.' },
  // ribs
  { key: 'ribStyle', type: 'select', label: 'Style', default: 'straight', group: 'Ribs', options: [...RIB_STYLES] },
  { key: 'ribs', type: 'number', label: 'Ribs', default: 120, min: 8, max: 400, step: 1, group: 'Ribs', showWhen: ribStyleShown, help: 'Around the whole vase. ~1.5–2.5 mm between ribs prints well with a 0.4 mm nozzle.' },
  { key: 'ribDepth', type: 'number', label: 'Rib depth', default: 0.7, min: 0.1, max: 4, step: 0.05, unit: 'mm', group: 'Ribs', showWhen: ribStyleShown },
  { key: 'beadSize', type: 'number', label: 'Bead height', default: 2, min: 0.6, max: 12, step: 0.1, unit: 'mm', group: 'Ribs', showWhen: beadsShown, help: 'Vertical distance between beads on a rib.' },
  { key: 'fuzzSize', type: 'number', label: 'Fuzz size', default: 1.2, min: 0.4, max: 6, step: 0.1, unit: 'mm', group: 'Ribs', showWhen: { ribStyle: ['fuzzy'] } },
  // pattern
  { key: 'pattern', type: 'select', label: 'Pattern', default: 'flower', group: 'Pattern (repeated)', options: [...VASE_PATTERNS] },
  { key: 'image', type: 'image', label: 'Pattern picture', default: '', group: 'Pattern (repeated)', showWhen: { pattern: ['upload'] }, help: 'SVG, PNG or JPG. Dark or filled areas are raised.' },
  { key: 'depth', type: 'number', label: 'Relief depth', default: 1.6, min: -5, max: 5, step: 0.1, unit: 'mm', group: 'Pattern (repeated)', showWhen: { pattern: ['flower', 'dots', 'waves', 'upload'] }, help: 'Negative carves the picture into the wall instead.' },
  { key: 'repeat', type: 'number', label: 'Repeat around', default: 3, min: 1, max: 16, step: 1, group: 'Pattern (repeated)', showWhen: { pattern: ['flower', 'dots', 'waves', 'upload'] } },
  { key: 'rows', type: 'number', label: 'Rows', default: 1, min: 1, max: 8, step: 1, group: 'Pattern (repeated)', showWhen: { pattern: ['flower', 'dots', 'waves', 'upload'] } },
  { key: 'coverFrom', type: 'number', label: 'From', default: 8, min: 0, max: 100, step: 1, unit: '%', group: 'Pattern (repeated)', showWhen: { pattern: ['flower', 'dots', 'waves', 'upload'] }, help: 'Height band the pattern covers, measured from the bottom.' },
  { key: 'coverTo', type: 'number', label: 'To', default: 92, min: 0, max: 100, step: 1, unit: '%', group: 'Pattern (repeated)', showWhen: { pattern: ['flower', 'dots', 'waves', 'upload'] } },
  { key: 'keepAspect', type: 'toggle', label: 'Keep proportions', default: true, group: 'Pattern (repeated)', showWhen: { pattern: ['flower', 'dots', 'waves', 'upload'] }, help: 'Fit the rows inside the band without stretching the picture.' },
  { key: 'invert', type: 'toggle', label: 'Invert picture', default: false, group: 'Pattern (repeated)', showWhen: { pattern: ['flower', 'dots', 'waves', 'upload'] } },
  // front / back pictures
  { key: 'front', type: 'image', label: 'Front picture', default: '', group: 'Front & back pictures', help: 'Placed once, centred on the front. Dark areas are raised.' },
  { key: 'frontWidth', type: 'number', label: 'Front width', default: 45, min: 5, max: 100, step: 1, unit: '%', group: 'Front & back pictures', help: 'Of the circumference.' },
  { key: 'frontCenter', type: 'number', label: 'Front height', default: 50, min: 0, max: 100, step: 1, unit: '%', group: 'Front & back pictures', help: 'Where the picture centre sits, from the bottom.' },
  { key: 'back', type: 'image', label: 'Back picture', default: '', group: 'Front & back pictures' },
  { key: 'backWidth', type: 'number', label: 'Back width', default: 45, min: 5, max: 100, step: 1, unit: '%', group: 'Front & back pictures' },
  { key: 'backCenter', type: 'number', label: 'Back height', default: 50, min: 0, max: 100, step: 1, unit: '%', group: 'Front & back pictures' },
  { key: 'pictureDepth', type: 'number', label: 'Picture depth', default: 1.6, min: -5, max: 5, step: 0.1, unit: 'mm', group: 'Front & back pictures' },
  // text
  { key: 'text', type: 'text', label: 'Text', default: '', placeholder: 'e.g. a name', group: 'Text' },
  { key: 'font', type: 'select', label: 'Font', default: VASE_FONTS[0]!.value, group: 'Text', options: VASE_FONTS, showWhen: {} },
  { key: 'textSize', type: 'number', label: 'Letter height', default: 14, min: 4, max: 60, step: 1, unit: 'mm', group: 'Text' },
  { key: 'textAngle', type: 'number', label: 'Position around', default: 0, min: -180, max: 180, step: 5, unit: '°', group: 'Text', help: '0 = front, 180 = back.' },
  { key: 'textCenter', type: 'number', label: 'Text height', default: 50, min: 0, max: 100, step: 1, unit: '%', group: 'Text' },
  { key: 'textDepth', type: 'number', label: 'Text depth', default: 1.2, min: -5, max: 5, step: 0.1, unit: 'mm', group: 'Text' },
  // finish
  { key: 'soften', type: 'number', label: 'Soften edges', default: 1, min: 0, max: 16, step: 1, unit: 'px', group: 'Finish', help: 'Rounds the edges of all relief. 0 = crisp.' },
  { key: 'detail', type: 'select', label: 'Detail', default: 'preview', group: 'Finish', options: [{ value: 'preview', label: 'Preview (fast)' }, { value: 'print', label: 'Print' }], help: 'Preview keeps sliders responsive. Export always uses Print.' },
];

/** Parse a custom profile input; falls back to the preset when malformed. */
export function parseProfileInput(v: unknown, fallback: Vec2[]): Vec2[] {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    const p = JSON.parse(v);
    if (!Array.isArray(p) || p.length < 2) return fallback;
    const pts = p.map((q): Vec2 => [Math.max(0.05, Number(q[0])), Math.min(1, Math.max(0, Number(q[1])))]);
    if (pts.some(([r, t]) => !Number.isFinite(r) || !Number.isFinite(t))) return fallback;
    return pts;
  } catch { return fallback; }
}

export const reliefVaseModule: ModuleDefinition = {
  id: 'relief-vase',
  name: 'Relief vase',
  category: 'Vases',
  version: '2.0.0',
  description: 'A ribbed vase with pictures and text raised from its wall as low relief. Upload an SVG or PNG; dark areas stand out. Print in spiral-vase mode.',
  printNotes: VASE_PRINT_NOTES,
  inputs,
  build(i, api) {
    const shapeDef = VASE_SHAPES.find((s) => s.id === i.shape) ?? VASE_SHAPES[0]!;
    const curve = shapeDef.id === 'custom' ? parseProfileInput(i.profile, shapeDef.curve) : shapeDef.curve;
    const h = num(i.height), r = num(i.diameter) / 2, wall = num(i.wall);
    const preview = i.detail === 'preview';
    const soften = Math.round(num(i.soften));
    const ribStyle = String(i.ribStyle);
    const ribs = ribStyle === 'none' || ribStyle === 'fuzzy' ? 0 : Math.round(num(i.ribs));

    const profile: Vec2[] = curve.map(([rf, t]) => [Math.max(wall + 2, rf * r), t]);
    const circumference = 2 * Math.PI * r;

    // tiled pattern
    const layers: Relief[] = [];
    const patternMap = i.pattern === 'upload' ? (isHeightMap(i.image) ? String(i.image) : '') : i.pattern === 'none' ? '' : sampleMap(String(i.pattern));
    if (patternMap) {
      let from = Math.min(num(i.coverFrom), num(i.coverTo)) / 100;
      let to = Math.max(num(i.coverFrom), num(i.coverTo)) / 100;
      const repeat = Math.round(num(i.repeat)), rows = Math.round(num(i.rows));
      const size = heightMapSize(patternMap);
      if (i.keepAspect && size) {
        // one tile is circumference / repeat wide; keep its proportions and centre the rows in the band
        const tileW = circumference / repeat;
        const bandH = (rows * tileW * (size.height / size.width)) / h;
        if (bandH < to - from) { const mid = (from + to) / 2; from = mid - bandH / 2; to = mid + bandH / 2; }
      }
      layers.push({ ...defaultRelief(), map: patternMap, depth: num(i.depth), repeat, rows, from, to: Math.max(from + 0.02, to), soften, invert: Boolean(i.invert) });
    }

    // single pictures: width as a fraction of the circumference, height from the picture's aspect
    const single = (map: string, widthPct: number, centerPct: number, phase: number, depth: number) => {
      const size = heightMapSize(map);
      if (!size) return;
      const width = Math.min(1, Math.max(0.02, widthPct / 100));
      const bandH = Math.min(1, (width * circumference * (size.height / size.width)) / h);
      const c = centerPct / 100;
      const from = Math.min(1 - bandH, Math.max(0, c - bandH / 2));
      layers.push({ ...defaultRelief(), map, depth, tile: false, width, phase, from, to: Math.min(1, from + bandH), soften });
    };
    if (isHeightMap(i.front)) single(String(i.front), num(i.frontWidth), num(i.frontCenter), 0, num(i.pictureDepth));
    if (isHeightMap(i.back)) single(String(i.back), num(i.backWidth), num(i.backCenter), 180, num(i.pictureDepth));

    // text, rendered to a map with the environment's rasterizer
    const text = String(i.text ?? '').trim();
    if (text && api.hasText) {
      const tm = api.textMap(text, { family: String(i.font), weight: 600 }, num(i.textSize));
      const widthPct = Math.min(100, (tm.width / circumference) * 100);
      single(tm.map, widthPct, num(i.textCenter), num(i.textAngle), num(i.textDepth));
    }

    // enough segments around for ribs to stay round; relief refinement happens in the mesh builder
    const segments = Math.min(preview ? 256 : 720, Math.max(preview ? 96 : 192, ribs * (preview ? 3 : 4)));
    const [primary, ...rest] = layers;
    const vase: FeatureSpec = {
      type: 'revolve', name: 'Vase', profile, height: h, wall, floor: num(i.floor), smoothing: 3, segments, open: false,
      modifiers: {
        twist: num(i.twist),
        grooveAmplitude: ribs > 0 ? num(i.ribDepth) : 0, grooveCount: Math.max(1, ribs),
        grooveWaveLength: ribStyle === 'beads' || ribStyle === 'woven' ? num(i.beadSize) : 0,
        grooveStagger: ribStyle === 'woven',
        fuzz: ribStyle === 'fuzzy' ? num(i.ribDepth) : 0, fuzzScale: num(i.fuzzSize),
        relief: primary ?? defaultRelief(),
        reliefs: rest,
        coarseness: preview ? 2 : 1,
      },
    };
    return [vase];
  },
  check(i) {
    const out: string[] = [];
    const r = num(i.diameter) / 2, circumference = 2 * Math.PI * r;
    const ribStyle = String(i.ribStyle);
    if (ribStyle !== 'none' && ribStyle !== 'fuzzy') {
      const pitch = circumference / Math.max(1, Math.round(num(i.ribs)));
      if (pitch < NOZZLE * 2.5) out.push(`Ribs are ${pitch.toFixed(2)} mm apart — a ${NOZZLE} mm nozzle cannot follow that; use ${Math.floor(circumference / (NOZZLE * 2.5))} ribs or fewer.`);
      if (num(i.ribDepth) > num(i.wall) * 1.5) out.push('Rib depth is much larger than the wall; in vase mode deep ribs can leave gaps between layers.');
      if ((ribStyle === 'beads' || ribStyle === 'woven') && num(i.beadSize) < 1) out.push('Beads under 1 mm tall blur into a straight rib at 0.2 mm layers.');
    }
    if (ribStyle === 'fuzzy' && num(i.fuzzSize) < NOZZLE * 2) out.push('Fuzz cells smaller than twice the nozzle print as noise rather than texture.');
    for (const [key, label] of [['depth', 'Pattern'], ['pictureDepth', 'Picture'], ['textDepth', 'Text']] as const) {
      if (Math.abs(num(i[key])) > 4) out.push(`${label} relief deeper than 4 mm overhangs too steeply for a single wall.`);
    }
    if (String(i.text ?? '').trim() && num(i.textSize) < 8) out.push('Letters under 8 mm lose their shape in relief; 12 mm and up reads well.');
    if (num(i.wall) < 0.8) out.push('Wall under 0.8 mm: set the slicer line width to match or the vase will be fragile.');
    return out;
  },
};

export type { ModuleInputValues };
