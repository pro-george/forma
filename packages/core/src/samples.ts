import { addFeature, createDocument, combine, makeFeature } from './document/document.js';
import type { FormaDocument } from './document/types.js';

/** The scene a new user opens: shows booleans, revolve, modifiers and modules at once. */
export function sampleDocument(): FormaDocument {
  let doc = createDocument('Sample scene');
  const plate = makeFeature(doc, 'box', { name: 'Base plate', width: 60, depth: 40, height: 6 });
  doc = addFeature(doc, plate);
  const holeL = makeFeature(doc, 'cylinder', { name: 'Bolt hole L', radius: 2.6, height: 8, segments: 32, role: 'hole', transform: { position: { x: -22, y: 0, z: -1 }, rotation: { x: 0, y: 0, z: 0 } } });
  const holeR = { ...holeL, id: holeL.id + 'r', name: 'Bolt hole R', transform: { ...holeL.transform, position: { x: 22, y: 0, z: -1 } } };
  doc = addFeature(addFeature(doc, holeL), holeR);
  const boss = makeFeature(doc, 'cylinder', { name: 'Boss', radius: 10, height: 15, segments: 64, transform: { position: { x: 0, y: 0, z: 5 }, rotation: { x: 0, y: 0, z: 0 } } });
  doc = addFeature(doc, boss);
  const bore = makeFeature(doc, 'cylinder', { name: 'Bore', radius: 6, height: 30, segments: 48, role: 'hole', transform: { position: { x: 0, y: 0, z: -2 }, rotation: { x: 0, y: 0, z: 0 } } });
  doc = addFeature(doc, bore);
  doc = combine(doc, [plate.id, holeL.id, holeR.id, boss.id, bore.id], 'Mount').doc;

  const vase = makeFeature(doc, 'revolve', {
    name: 'Vase', height: 70, wall: 1.6, floor: 2, smoothing: 3, segments: 128,
    profile: [[20, 0], [27, 0.14], [30, 0.34], [21, 0.56], [24, 0.76], [17, 0.9], [20, 1]],
    transform: { position: { x: 70, y: 30, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    modifiers: { twist: 40, taper: 0, rippleAmplitude: 0, rippleWaves: 6, grooveAmplitude: 1.2, grooveCount: 18 },
  });
  doc = addFeature(doc, vase);
  doc = addFeature(doc, makeFeature(doc, 'module', { name: 'Nametag', moduleId: 'nametag', inputs: {}, transform: { position: { x: -70, y: 35, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }));
  doc = addFeature(doc, makeFeature(doc, 'module', { name: 'Flexi cat', moduleId: 'flexi-chain', inputs: {}, transform: { position: { x: 0, y: 95, z: 0 }, rotation: { x: 0, y: 0, z: 90 } } }));
  doc = addFeature(doc, makeFeature(doc, 'module', { name: 'Screw box', moduleId: 'storage-box', inputs: { innerW: 50, innerD: 30, innerH: 18 }, transform: { position: { x: -60, y: -60, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }));
  doc = addFeature(doc, makeFeature(doc, 'torus', { name: 'Ring', ringRadius: 12, tubeRadius: 3, segments: 64, transform: { position: { x: 60, y: -50, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }));
  return doc;
}
