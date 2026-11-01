import type { ModuleDefinition, FeatureSpec } from '../registry.js';
import type { Vec2 } from '../../document/types.js';

/**
 * Nametag keychain: a plate sized around the text, keyring hole, optional
 * rim, text raised or cut through. Everything is a single extrusion with
 * holes where possible, so it evaluates instantly.
 */
export const nametagModule: ModuleDefinition = {
  id: 'nametag',
  name: 'Nametag keychain',
  category: 'Keychains',
  version: '1.0.0',
  description: 'A flat tag with your text, a keyring hole and an optional rim. Raised text prints in two colours with a filament swap; cut-through text works as a stencil.',
  inputs: [
    { key: 'text', type: 'text', label: 'Text', default: 'FORMA', placeholder: 'Name' },
    { key: 'font', type: 'select', label: 'Font', default: '"IBM Plex Sans", sans-serif', options: [
      { value: '"IBM Plex Sans", sans-serif', label: 'Plex Sans' },
      { value: '"IBM Plex Mono", monospace', label: 'Plex Mono' },
      { value: 'system-ui, sans-serif', label: 'System sans' },
      { value: 'Georgia, serif', label: 'Serif' },
      { value: 'cursive', label: 'Script' },
      { value: 'Impact, fantasy', label: 'Display' },
    ] },
    { key: 'weight', type: 'select', label: 'Weight', default: '700', options: [{ value: '400', label: 'Regular' }, { value: '700', label: 'Bold' }] },
    { key: 'letterHeight', type: 'number', label: 'Letter height', default: 9, min: 4, max: 40, step: 0.5, unit: 'mm' },
    { key: 'mode', type: 'select', label: 'Text style', default: 'raised', options: [{ value: 'raised', label: 'Raised' }, { value: 'cut', label: 'Cut through' }] },
    { key: 'relief', type: 'number', label: 'Text relief', default: 1.2, min: 0.4, max: 6, step: 0.2, unit: 'mm' },
    { key: 'plate', type: 'select', label: 'Plate shape', default: 'rounded', options: [{ value: 'rounded', label: 'Rounded' }, { value: 'pill', label: 'Pill' }, { value: 'tag', label: 'Tag' }] },
    { key: 'thickness', type: 'number', label: 'Plate thickness', default: 3, min: 1.2, max: 10, step: 0.2, unit: 'mm' },
    { key: 'padding', type: 'number', label: 'Padding', default: 4, min: 1, max: 20, step: 0.5, unit: 'mm' },
    { key: 'hole', type: 'number', label: 'Hole diameter', default: 4.5, min: 0, max: 12, step: 0.5, unit: 'mm' },
    { key: 'rim', type: 'toggle', label: 'Raised rim', default: true },
  ],
  build(i, api) {
    const text = String(i.text).trim() || ' ';
    const t = api.text(text, { family: String(i.font), weight: String(i.weight) }, Number(i.letterHeight));
    const pad = Number(i.padding), hole = Number(i.hole), thick = Number(i.thickness), relief = Number(i.relief), rim = Boolean(i.rim);
    const rimW = rim ? 1.6 : 0;
    const holeZone = hole > 0 ? hole + pad : 0;
    const width = t.width + 2 * pad + holeZone + 2 * rimW;
    const depth = Math.max(t.height, Number(i.letterHeight)) + 2 * pad + 2 * rimW;
    const radius = i.plate === 'pill' ? depth / 2 : i.plate === 'tag' ? 2.5 : Math.min(5, depth / 3);
    let outer: Vec2[] = api.roundedRect(width, depth, radius);
    if (i.plate === 'tag') {
      // pointed left end: keep the right half of the rounded rect, replace the left edge with a tip
      const tipX = -width / 2 - depth * 0.35;
      const keep = outer.filter((p) => p[0] >= -width / 2 + radius - 1e-6);
      const splitAt = keep.findIndex((p, k) => k > 0 && p[1] < 0 && keep[k - 1]![1] > 0);
      outer = [...keep.slice(0, splitAt), [tipX, 0], ...keep.slice(splitAt)];
    }
    const holes: Vec2[][] = [];
    const holeX = -width / 2 + rimW + pad / 2 + hole / 2 + (i.plate === 'tag' ? 1 : 0);
    if (hole > 0) holes.push(api.circle(hole / 2, 40, holeX, 0));
    const textX = holeZone / 2;
    const glyphs = t.profiles.map((p) => ({ outer: api.translate(p.outer, textX, 0), holes: p.holes.map((h) => api.translate(h, textX, 0)) }));
    const out: FeatureSpec[] = [];
    if (i.mode === 'cut') {
      for (const g of glyphs) {
        holes.push(g.outer);
        // counters (the inside of an "O") come back as islands so they survive the cut
        for (const h of g.holes) out.push({ type: 'extrude', name: 'Island', profile: { outer: h, holes: [] }, height: thick, scaleTop: 1, twist: 0 });
      }
    }
    out.unshift({ type: 'extrude', name: 'Plate', profile: { outer, holes }, height: thick, scaleTop: 1, twist: 0 });
    if (i.mode === 'raised') {
      for (const g of glyphs) out.push({ type: 'extrude', name: 'Letter', profile: g, height: relief + 0.05, scaleTop: 1, twist: 0, position: { z: thick - 0.05 } });
    }
    if (rim) {
      const inner = api.roundedRect(width - 2 * rimW, depth - 2 * rimW, Math.max(0.5, radius - rimW));
      const rimOuter = i.plate === 'tag' ? api.roundedRect(width, depth, radius) : outer;
      out.push({ type: 'extrude', name: 'Rim', profile: { outer: rimOuter, holes: [inner] }, height: relief + 0.05, scaleTop: 1, twist: 0, position: { z: thick - 0.05 } });
    }
    return out;
  },
};
