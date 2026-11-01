import type { Vec2 } from '../../document/types.js';
import type { ModuleDefinition, FeatureSpec } from '../registry.js';

/**
 * Artea lampshade. A shade is an open sleeve (no floor, no lid) revolved from
 * a family profile, then shaped with ribs, waves and twist. A flat collar at
 * the bottom holds the lamp socket.
 *
 * Families mirror the Artea catalogue (Tulip, Oli, Cloud, Onda, Lumi). Each
 * family is a radius curve normalised to 0..1 (radius as a fraction of half
 * the width, height as a fraction of the shade height) plus the surface
 * defaults that give the model its character. Every number the customer can
 * change is a module input, so a design is fully described by its inputs.
 */

export interface LampFamily {
  id: string;
  name: string;
  /** [radius fraction 0..1, height fraction 0..1], bottom to top */
  curve: Vec2[];
  socket: 'e14' | 'e27';
  defaults: { height: number; width: number; ribs: number; ribDepth: number; waves: number; waveDepth: number; twist: number };
}

export const LAMP_FAMILIES: LampFamily[] = [
  { id: 'tulip', name: 'Tulip', socket: 'e14',
    curve: [[0.55, 0], [0.8, 0.1], [0.96, 0.25], [1, 0.4], [0.95, 0.56], [0.8, 0.72], [0.58, 0.87], [0.4, 1]],
    defaults: { height: 220, width: 130, ribs: 20, ribDepth: 2.5, waves: 0, waveDepth: 0, twist: 0 } },
  { id: 'oli', name: 'Oli', socket: 'e14',
    curve: [[0.84, 0], [0.97, 0.06], [1, 0.18], [1, 0.82], [0.97, 0.94], [0.84, 1]],
    defaults: { height: 190, width: 120, ribs: 36, ribDepth: 1.2, waves: 0, waveDepth: 0, twist: 0 } },
  { id: 'cloud', name: 'Cloud', socket: 'e27',
    curve: [[0.62, 0], [0.98, 0.1], [1, 0.22], [0.8, 0.34], [0.86, 0.46], [0.82, 0.56], [0.62, 0.66], [0.68, 0.76], [0.6, 0.88], [0.44, 1]],
    defaults: { height: 170, width: 170, ribs: 72, ribDepth: 0.7, waves: 0, waveDepth: 0, twist: 0 } },
  { id: 'onda', name: 'Onda', socket: 'e14',
    curve: [[0.5, 0], [0.82, 0.14], [1, 0.36], [1, 0.62], [0.86, 0.82], [0.62, 1]],
    defaults: { height: 180, width: 170, ribs: 9, ribDepth: 9, waves: 4, waveDepth: 4.5, twist: 24 } },
  { id: 'lumi', name: 'Lumi', socket: 'e14',
    curve: [[0.9, 0], [1, 0.05], [1, 0.95], [0.92, 1]],
    defaults: { height: 180, width: 110, ribs: 0, ribDepth: 0, waves: 0, waveDepth: 0, twist: 0 } },
];

/** Socket opening in the collar, radius in mm. TODO(George): confirm against the real lampholder rings. */
export const SOCKET_HOLE_RADIUS = { e14: 14.5, e27: 20 } as const;
const COLLAR_HEIGHT = 3;
const COLLAR_LIP = 8; // mm of collar between the hole and the shade wall

export const lampshadeModule: ModuleDefinition = {
  id: 'artea-lamp',
  name: 'Artea lampshade',
  category: 'Artea',
  version: '1.0.0',
  description: 'A lampshade from one of the Artea families, shaped with ribs, waves and twist. Open top and bottom, with a collar for the socket.',
  inputs: [
    { key: 'family', type: 'select', label: 'Family', default: 'tulip', options: LAMP_FAMILIES.map((f) => ({ value: f.id, label: f.name })) },
    { key: 'height', type: 'number', label: 'Height', default: 220, min: 120, max: 250, step: 1, unit: 'mm' },
    { key: 'width', type: 'number', label: 'Width', default: 130, min: 90, max: 220, step: 1, unit: 'mm' },
    { key: 'ribs', type: 'number', label: 'Ribs', default: 20, min: 0, max: 72, step: 1 },
    { key: 'ribDepth', type: 'number', label: 'Rib depth', default: 2.5, min: 0, max: 14, step: 0.1, unit: 'mm' },
    { key: 'waves', type: 'number', label: 'Waves', default: 0, min: 0, max: 8, step: 1 },
    { key: 'waveDepth', type: 'number', label: 'Wave depth', default: 0, min: 0, max: 12, step: 0.5, unit: 'mm' },
    { key: 'twist', type: 'number', label: 'Twist', default: 0, min: -180, max: 180, step: 1, unit: '°' },
    { key: 'wall', type: 'number', label: 'Wall', default: 1.6, min: 1.2, max: 3, step: 0.1, unit: 'mm' },
    { key: 'socket', type: 'select', label: 'Socket', default: 'family', options: [{ value: 'family', label: 'As the family' }, { value: 'e14', label: 'E14' }, { value: 'e27', label: 'E27' }] },
    { key: 'detail', type: 'select', label: 'Detail', default: 'print', options: [{ value: 'preview', label: 'Preview (fast)' }, { value: 'print', label: 'Print' }], help: 'Preview keeps sliders responsive; export always uses Print.' },
  ],
  build(i) {
    const fam = LAMP_FAMILIES.find((f) => f.id === i.family) ?? LAMP_FAMILIES[0]!;
    const h = Number(i.height), r = Number(i.width) / 2, wall = Number(i.wall);
    const ribs = Math.round(Number(i.ribs)), ribDepth = Number(i.ribDepth);
    const waves = Math.round(Number(i.waves)), waveDepth = Number(i.waveDepth);
    const socket = i.socket === 'e14' || i.socket === 'e27' ? i.socket : fam.socket;
    const hole = SOCKET_HOLE_RADIUS[socket];

    // the bottom must be wide enough to carry the collar around the socket
    const minBottom = hole + COLLAR_LIP + wall;
    const bottomScale = Math.max(1, minBottom / (fam.curve[0]![0] * r));
    const profile: Vec2[] = fam.curve.map(([rf, t], k) => {
      // widen only the lower part when needed, fading back to the family curve by mid-height
      const lift = k === 0 ? bottomScale : 1 + (bottomScale - 1) * Math.max(0, 1 - t / 0.5);
      return [Math.max(wall + 2, rf * r * lift), t];
    });

    // enough segments around for the ribs to stay round; preview trades smoothness for speed
    const perRib = i.detail === 'preview' ? 5 : 9;
    const segments = Math.min(i.detail === 'preview' ? 288 : 640, Math.max(i.detail === 'preview' ? 96 : 192, ribs * perRib));
    const shade: FeatureSpec = {
      type: 'revolve', name: 'Shade', profile, height: h, wall, floor: 0, smoothing: 2, segments, open: true,
      modifiers: {
        twist: Number(i.twist),
        grooveAmplitude: ribs > 0 ? ribDepth : 0, grooveCount: Math.max(1, ribs),
        rippleAmplitude: waves > 0 ? waveDepth : 0, rippleWaves: Math.max(1, waves),
        coarseness: i.detail === 'preview' ? 2.2 : 1,
      },
    };
    const collarOuter = profile[0]![0] - wall / 2;
    const collar: FeatureSpec = { type: 'tube', name: `Collar ${socket.toUpperCase()}`, radius: collarOuter, innerRadius: hole, height: COLLAR_HEIGHT, segments: 128 };
    return [shade, collar];
  },
};

/** Defaults for a family, as module inputs. Used by Studio when the customer switches family. */
export function familyInputs(id: string): Record<string, string | number> {
  const fam = LAMP_FAMILIES.find((f) => f.id === id) ?? LAMP_FAMILIES[0]!;
  return { family: fam.id, ...fam.defaults, wall: 1.6, socket: 'family' };
}
