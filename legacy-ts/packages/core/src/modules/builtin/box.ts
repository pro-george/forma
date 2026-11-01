import type { ModuleDefinition, FeatureSpec } from '../registry.js';

/**
 * Storage box with optional dividers and a friction-fit lid. A functional
 * module: everything derives from inner dimensions and wall thickness.
 */
export const storageBoxModule: ModuleDefinition = {
  id: 'storage-box',
  name: 'Storage box',
  category: 'Organisers',
  version: '1.0.0',
  description: 'An open box sized by its inner dimensions, with optional dividers and a lid that drops in with a lip. Good for screws, SD cards, beads.',
  inputs: [
    { key: 'innerW', type: 'number', label: 'Inner width', default: 60, min: 10, max: 250, step: 1, unit: 'mm' },
    { key: 'innerD', type: 'number', label: 'Inner depth', default: 40, min: 10, max: 250, step: 1, unit: 'mm' },
    { key: 'innerH', type: 'number', label: 'Inner height', default: 25, min: 5, max: 150, step: 1, unit: 'mm' },
    { key: 'wall', type: 'number', label: 'Wall', default: 1.6, min: 0.8, max: 5, step: 0.2, unit: 'mm' },
    { key: 'floor', type: 'number', label: 'Floor', default: 1.6, min: 0.8, max: 5, step: 0.2, unit: 'mm' },
    { key: 'radius', type: 'number', label: 'Corner radius', default: 4, min: 0, max: 20, step: 0.5, unit: 'mm' },
    { key: 'columns', type: 'number', label: 'Columns', default: 2, min: 1, max: 8, step: 1 },
    { key: 'rows', type: 'number', label: 'Rows', default: 1, min: 1, max: 8, step: 1 },
    { key: 'dividerH', type: 'number', label: 'Divider height', default: 80, min: 20, max: 100, step: 5, unit: '%' },
    { key: 'lid', type: 'toggle', label: 'Lid (printed beside)', default: true },
    { key: 'lidClearance', type: 'number', label: 'Lid clearance', default: 0.3, min: 0.1, max: 0.6, step: 0.05, unit: 'mm' },
  ],
  build(i, api) {
    const iw = Number(i.innerW), id = Number(i.innerD), ih = Number(i.innerH), wall = Number(i.wall), floor = Number(i.floor);
    const r = Number(i.radius), cols = Number(i.columns), rows = Number(i.rows), divH = ih * Number(i.dividerH) / 100;
    const ow = iw + 2 * wall, od = id + 2 * wall, oh = ih + floor;
    const out: FeatureSpec[] = [];
    out.push({ type: 'extrude', name: 'Shell', profile: { outer: api.roundedRect(ow, od, r), holes: [] }, height: oh, scaleTop: 1, twist: 0 });
    out.push({ type: 'extrude', name: 'Cavity', role: 'hole', profile: { outer: api.roundedRect(iw, id, Math.max(0, r - wall)), holes: [] }, height: ih + 1, scaleTop: 1, twist: 0, position: { z: floor } });
    const divT = Math.max(0.8, wall * 0.75);
    for (let c = 1; c < cols; c++) {
      const x = -iw / 2 + (iw / cols) * c;
      out.push({ type: 'box', name: 'Divider', width: divT, depth: id + 0.2, height: divH, position: { x, z: floor - 0.01 } });
    }
    for (let rI = 1; rI < rows; rI++) {
      const y = -id / 2 + (id / rows) * rI;
      out.push({ type: 'box', name: 'Divider', width: iw + 0.2, depth: divT, height: divH, position: { y, z: floor - 0.01 } });
    }
    if (i.lid) {
      const c = Number(i.lidClearance);
      const lx = ow / 2 + 10 + ow / 2; // beside the box
      out.push({ type: 'extrude', name: 'Lid', profile: { outer: api.roundedRect(ow, od, r), holes: [] }, height: floor, scaleTop: 1, twist: 0, position: { x: lx } });
      out.push({ type: 'extrude', name: 'Lid lip', profile: { outer: api.roundedRect(iw - 2 * c, id - 2 * c, Math.max(0, r - wall - c)), holes: [api.roundedRect(iw - 2 * c - 2 * wall, id - 2 * c - 2 * wall, Math.max(0, r - 2 * wall - c))] }, height: floor + 3, scaleTop: 1, twist: 0, position: { x: lx } });
    }
    return out;
  },
};
