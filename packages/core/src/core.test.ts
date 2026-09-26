import { describe, it, expect, beforeAll } from 'vitest';
import {
  initManifold, Evaluator, createDefaultRegistry, createModuleApi, createDocument, addFeature, makeFeature,
  combine, ungroup, removeFeatures, duplicate, parseDocument, serializeDocument, History, toBinarySTL, to3MF,
  traceRaster, loopsToProfiles, composeTransforms, sampleDocument, type TextRasterizer, type FormaDocument,
} from './index.js';

/** Node has no canvas: fake rasterizer draws a filled rectangle with a square hole ("O"-like glyph). */
const fakeText: TextRasterizer = (text, _font, px) => {
  const w = Math.max(8, Math.round(text.length * px * 0.6)), h = px;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x > 2 && x < w - 3 && y > 2 && y < h - 3;
    const hole = x > w * 0.4 && x < w * 0.6 && y > h * 0.4 && y < h * 0.6;
    data[y * w + x] = inside && !hole ? 1 : 0;
  }
  return { data, width: w, height: h, capHeightPx: h * 0.7 };
};

let ev: Evaluator;
beforeAll(async () => {
  const wasm = await initManifold();
  ev = new Evaluator(wasm, { registry: createDefaultRegistry(), api: createModuleApi(fakeText) });
});

const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) / Math.max(1, Math.abs(b)) < tol;

describe('primitives', () => {
  it('box volume and bbox sit on Z=0', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'box', { width: 10, depth: 20, height: 5 }));
    const [r] = ev.evaluate(doc);
    expect(r!.error).toBeUndefined();
    expect(near(r!.volume, 1000)).toBe(true);
    expect(r!.bbox.min.z).toBeCloseTo(0);
    expect(r!.bbox.max.z).toBeCloseTo(5);
  });
  it('cylinder, sphere, torus, tube, cone are watertight with sane volumes', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'cylinder', { radius: 10, height: 10, segments: 128 }));
    doc = addFeature(doc, makeFeature(doc, 'sphere', { radius: 10, segments: 64 }));
    doc = addFeature(doc, makeFeature(doc, 'torus', { ringRadius: 10, tubeRadius: 2, segments: 128 }));
    doc = addFeature(doc, makeFeature(doc, 'tube', { radius: 10, innerRadius: 8, height: 10, segments: 128 }));
    doc = addFeature(doc, makeFeature(doc, 'cone', { radiusBottom: 10, radiusTop: 0, height: 12, segments: 128 }));
    const res = ev.evaluate(doc);
    expect(res.every((r) => !r.error)).toBe(true);
    const [cyl, sph, tor, tube, cone] = res.map((r) => r.volume);
    expect(near(cyl!, Math.PI * 100 * 10)).toBe(true);
    expect(near(sph!, (4 / 3) * Math.PI * 1000, 0.05)).toBe(true);
    expect(near(tor!, 2 * Math.PI * Math.PI * 10 * 4, 0.05)).toBe(true);
    expect(near(tube!, Math.PI * (100 - 64) * 10)).toBe(true);
    expect(near(cone!, (Math.PI * 100 * 12) / 3)).toBe(true);
  });
  it('extrude with a hole and revolve with wall', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'extrude', { profile: { outer: [[-10, -10], [10, -10], [10, 10], [-10, 10]], holes: [[[-5, -5], [5, -5], [5, 5], [-5, 5]]] }, height: 4, scaleTop: 1, twist: 0 }));
    doc = addFeature(doc, makeFeature(doc, 'revolve', { profile: [[10, 0], [10, 1]], height: 20, wall: 0, floor: 0, smoothing: 0, segments: 128 }));
    doc = addFeature(doc, makeFeature(doc, 'revolve', { profile: [[10, 0], [10, 1]], height: 20, wall: 2, floor: 2, smoothing: 0, segments: 128 }));
    const [ex, solid, hollow] = ev.evaluate(doc);
    expect(near(ex!.volume, (400 - 100) * 4)).toBe(true);
    expect(near(solid!.volume, Math.PI * 100 * 20)).toBe(true);
    expect(hollow!.volume).toBeLessThan(solid!.volume * 0.5);
    expect(hollow!.error).toBeUndefined();
  });
  it('modifiers keep the mesh valid and change the shape', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'cylinder', { radius: 10, height: 30, segments: 64, modifiers: { twist: 90, taper: -50, rippleAmplitude: 1, rippleWaves: 4, grooveAmplitude: 0.5, grooveCount: 12 } }));
    const [r] = ev.evaluate(doc);
    expect(r!.error).toBeUndefined();
    expect(r!.volume).toBeGreaterThan(1000);
    expect(r!.volume).toBeLessThan(Math.PI * 100 * 30);
    expect(r!.mesh.indices.length / 3).toBeGreaterThan(2000);
  });
});

describe('combine', () => {
  it('unions solids and subtracts holes; child edits propagate', () => {
    let doc = createDocument();
    const a = makeFeature(doc, 'box', { width: 20, depth: 20, height: 10 });
    doc = addFeature(doc, a);
    const hole = makeFeature(doc, 'cylinder', { radius: 5, height: 20, role: 'hole', transform: { position: { x: 0, y: 0, z: -5 }, rotation: { x: 0, y: 0, z: 0 } } });
    doc = addFeature(doc, hole);
    const c = combine(doc, [a.id, hole.id]);
    doc = c.doc;
    let [r] = ev.evaluate(doc);
    expect(r!.id).toBe(c.combineId);
    expect(near(r!.volume, 4000 - Math.PI * 25 * 10, 0.03)).toBe(true);
    // change the hole radius → recomputed
    doc = { ...doc, features: doc.features.map((f) => (f.id === hole.id && f.type === 'cylinder' ? { ...f, radius: 2 } : f)) };
    [r] = ev.evaluate(doc);
    expect(near(r!.volume, 4000 - Math.PI * 4 * 10, 0.03)).toBe(true);
    // ungroup restores two top-level parts
    doc = ungroup(doc, c.combineId);
    expect(ev.evaluate(doc)).toHaveLength(2);
    // remove cascades
    const c2 = combine(doc, [a.id, hole.id]);
    doc = removeFeatures(c2.doc, [c2.combineId]);
    expect(doc.features).toHaveLength(0);
  });
  it('duplicate deep-copies a combine', () => {
    let doc = createDocument();
    const a = makeFeature(doc, 'box', { width: 5, depth: 5, height: 5 });
    doc = addFeature(doc, a);
    const c = combine(doc, [a.id]).doc;
    const d = duplicate(c, [c.features.find((f) => f.type === 'combine')!.id]);
    expect(d.doc.features).toHaveLength(4);
    expect(ev.evaluate(d.doc)).toHaveLength(2);
  });
});

describe('modules', () => {
  it('nametag builds one watertight solid with a hole', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'module', { moduleId: 'nametag', inputs: { text: 'AB', hole: 5 } }));
    const [r] = ev.evaluate(doc);
    expect(r!.error).toBeUndefined();
    expect(r!.volume).toBeGreaterThan(100);
    expect(r!.bbox.min.z).toBeCloseTo(0, 1);
  });
  it('flexi and storage box evaluate without errors', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'module', { moduleId: 'flexi-chain', inputs: { segments: 3 } }));
    doc = addFeature(doc, makeFeature(doc, 'module', { moduleId: 'storage-box', inputs: {} }));
    const res = ev.evaluate(doc);
    expect(res.map((r) => r.error)).toEqual([undefined, undefined]);
    expect(res[1]!.volume).toBeGreaterThan(0);
  });
  it('bakeModule returns concrete features', () => {
    let doc = createDocument();
    const m = makeFeature(doc, 'module', { moduleId: 'storage-box', inputs: { columns: 3 } });
    doc = addFeature(doc, m);
    const feats = ev.bakeModule(doc, m.id);
    expect(feats.filter((f) => f.name === 'Divider')).toHaveLength(2);
  });
  it('unknown module reports an error instead of throwing', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'module', { moduleId: 'nope', inputs: {} }));
    expect(ev.evaluate(doc)[0]!.error).toMatch(/Unknown module/);
  });
});

describe('document', () => {
  it('round-trips through JSON with validation', () => {
    const doc = sampleDocument();
    const back = parseDocument(JSON.parse(serializeDocument(doc)));
    expect(back.features.length).toBe(doc.features.length);
    expect(() => parseDocument({ version: 1, features: [{ type: 'box' }] })).toThrow();
  });
  it('sample scene evaluates fully', () => {
    const res = ev.evaluate(sampleDocument());
    expect(res.filter((r) => r.error).map((r) => r.error)).toEqual([]);
    expect(res.length).toBeGreaterThanOrEqual(6);
  });
  it('history undo/redo', () => {
    const h = new History(createDocument('a'));
    const b: FormaDocument = { ...h.value, name: 'b' };
    h.commit(b);
    expect(h.undo().name).toBe('a');
    expect(h.redo().name).toBe('b');
  });
  it('composeTransforms', () => {
    const t = composeTransforms({ position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 } }, { position: { x: 5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
    expect(t.position.x).toBeCloseTo(10);
    expect(t.position.y).toBeCloseTo(5);
    expect(t.rotation.z).toBeCloseTo(90);
  });
});

describe('export', () => {
  it('binary STL and 3MF have the right sizes', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'box', { width: 1, depth: 1, height: 1 }));
    const [r] = ev.evaluate(doc);
    const stl = toBinarySTL([r!.mesh]);
    expect(stl.length).toBe(84 + 12 * 50);
    const mf = to3MF([{ name: 'cube', mesh: r!.mesh }]);
    expect(mf.length).toBeGreaterThan(300);
    expect(mf[0]).toBe(0x50); // 'P' of PK zip signature
  });
});

describe('raster tracing', () => {
  it('finds an outer loop and a hole', () => {
    const w = 40, h = 40, data = new Float32Array(w * h);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) data[y * w + x] = 1;
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) data[y * w + x] = 0;
    const loops = traceRaster({ data, width: w, height: h });
    expect(loops).toHaveLength(2);
    const profiles = loopsToProfiles(loops);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.holes).toHaveLength(1);
  });
});
