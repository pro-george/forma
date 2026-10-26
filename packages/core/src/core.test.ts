import { describe, it, expect, beforeAll } from 'vitest';
import {
  initManifold, Evaluator, createDefaultRegistry, createModuleApi, createDocument, addFeature, makeFeature,
  combine, ungroup, removeFeatures, duplicate, addToCombine, parseDocument, serializeDocument, History, toBinarySTL, to3MF,
  traceRaster, loopsToProfiles, composeTransforms, sampleDocument, LAMP_FAMILIES, SOCKET_HOLE_RADIUS, familyInputs,
  encodeHeightMap, decodeHeightMap, sampleHeightMap, blurHeightMap, proceduralHeightMap, rasterToHeightMap, VASE_SHAPES,
  type TextRasterizer, type FormaDocument,
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

describe('sketch on a face', () => {
  it('a flipped hole extrude on a side face cuts into the box; addToCombine keeps world placement', () => {
    let doc = createDocument();
    const box = makeFeature(doc, 'box', { width: 40, depth: 30, height: 20, transform: { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } });
    doc = addFeature(doc, box);
    const solidVol = ev.evaluate(doc)[0]!.volume;
    // sketch plane on the +X face (x = 30): local Z = +X means rotation Y = 90°
    const cut = makeFeature(doc, 'extrude', {
      profile: { outer: [[-5, 2], [5, 2], [5, 12], [-5, 12]], holes: [] }, height: 8, flip: true, role: 'hole',
      transform: { position: { x: 30, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 } },
    });
    doc = addFeature(doc, cut);
    const r = combine(doc, [box.id, cut.id]);
    doc = r.doc;
    const [c] = ev.evaluate(doc);
    expect(c!.error).toBeUndefined();
    expect(near(c!.volume, solidVol - 10 * 10 * 8, 0.02)).toBe(true);
    // the same extrude without flip grows outward instead
    const joined = addFeature(createDocument(), { ...box, id: 'b2' });
    const bump = makeFeature(joined, 'extrude', { profile: { outer: [[-5, 2], [5, 2], [5, 12], [-5, 12]], holes: [] }, height: 8, transform: { position: { x: 30, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 } } });
    const j = combine(addFeature(joined, bump), ['b2', bump.id]).doc;
    expect(near(ev.evaluate(j)[0]!.volume, solidVol + 10 * 10 * 8, 0.02)).toBe(true);
    // adding a later cut to the existing combine
    const more = makeFeature(doc, 'extrude', { profile: { outer: [[-2, 14], [2, 14], [2, 18], [-2, 18]], holes: [] }, height: 5, flip: true, role: 'hole', transform: { position: { x: 30, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 } } });
    doc = addToCombine(addFeature(doc, more), r.combineId, more.id);
    const [c2] = ev.evaluate(doc);
    expect(c2!.error).toBeUndefined();
    expect(c2!.volume).toBeLessThan(c!.volume - 1);
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
  it('open revolve makes a sleeve with no floor or lid', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'revolve', { profile: [[10, 0], [10, 1]], height: 20, wall: 2, floor: 0, smoothing: 0, segments: 128, open: true }));
    const [r] = ev.evaluate(doc);
    expect(r!.error).toBeUndefined();
    // a pure ring: pi * (10^2 - 8^2) * 20
    expect(near(r!.volume, Math.PI * (100 - 64) * 20, 0.02)).toBe(true);
  });
  it('every Artea lamp family builds a watertight shade with a socket collar', () => {
    for (const fam of LAMP_FAMILIES) {
      let doc = createDocument();
      doc = addFeature(doc, makeFeature(doc, 'module', { moduleId: 'artea-lamp', inputs: familyInputs(fam.id) }));
      const [r] = ev.evaluate(doc);
      expect(r!.error, fam.id).toBeUndefined();
      expect(r!.bbox.min.z, fam.id).toBeCloseTo(0, 1);
      expect(r!.bbox.max.z, fam.id).toBeCloseTo(fam.defaults.height, 0);
      // a thin shell: far less material than a solid of the same size
      const solid = Math.PI * (fam.defaults.width / 2) ** 2 * fam.defaults.height;
      expect(r!.volume, fam.id).toBeGreaterThan(solid * 0.02);
      expect(r!.volume, fam.id).toBeLessThan(solid * 0.25);
    }
  });
  it('lamp collar keeps the socket hole open and widens a narrow bottom', () => {
    let doc = createDocument();
    const m = makeFeature(doc, 'module', { moduleId: 'artea-lamp', inputs: { ...familyInputs('lumi'), width: 90, socket: 'e27' } });
    doc = addFeature(doc, m);
    const feats = ev.bakeModule(doc, m.id);
    const collar = feats.find((f) => f.type === 'tube');
    expect(collar && collar.type === 'tube' && collar.innerRadius).toBe(SOCKET_HOLE_RADIUS.e27);
    expect(collar && collar.type === 'tube' && collar.radius).toBeGreaterThan(SOCKET_HOLE_RADIUS.e27 + 7);
  });
  it('relief vase: every shape builds watertight, ribs and relief add material', () => {
    for (const shape of VASE_SHAPES) {
      let doc = createDocument();
      doc = addFeature(doc, makeFeature(doc, 'module', { moduleId: 'relief-vase', inputs: { shape: shape.id, height: 60, diameter: 40, ribs: 40, detail: 'preview' } }));
      const [r] = ev.evaluate(doc);
      expect(r!.error, shape.id).toBeUndefined();
      expect(r!.bbox.min.z, shape.id).toBeCloseTo(0, 1);
      expect(r!.bbox.max.z, shape.id).toBeCloseTo(60, 0);
    }
    // the same vase without ribs or relief is slimmer: plain < ribs only < ribs + relief
    const vol = (inputs: Record<string, unknown>) => {
      let doc = createDocument();
      doc = addFeature(doc, makeFeature(doc, 'module', { moduleId: 'relief-vase', inputs: { height: 60, diameter: 40, detail: 'preview', ...inputs } }));
      const [r] = ev.evaluate(doc);
      expect(r!.error).toBeUndefined();
      return { volume: r!.volume, maxX: r!.bbox.max.x };
    };
    const plain = vol({ ribStyle: 'none', pattern: 'none' });
    const ribbed = vol({ ribs: 40, ribDepth: 1, pattern: 'none' });
    const relief = vol({ ribs: 40, ribDepth: 1, pattern: 'flower', depth: 2 });
    expect(ribbed.maxX).toBeGreaterThan(plain.maxX + 0.5);
    expect(relief.maxX).toBeGreaterThan(ribbed.maxX + 1);
    expect(relief.volume).toBeGreaterThan(ribbed.volume);
    // an uploaded map takes precedence over the sample pattern
    const custom = encodeHeightMap(proceduralHeightMap('checker', 32));
    const uploaded = vol({ ribStyle: 'none', pattern: 'upload', image: custom, depth: 3, soften: 0 });
    expect(uploaded.maxX).toBeGreaterThan(plain.maxX + 2);
    // negative depth carves inward instead
    const carved = vol({ ribStyle: 'none', pattern: 'flower', depth: -2 });
    expect(carved.volume).toBeLessThan(plain.volume);
  });
  it('relief vase v2: rib styles, front/back pictures, text and custom profile all build; check() warns', () => {
    const run = (inputs: Record<string, unknown>) => {
      let doc = createDocument();
      doc = addFeature(doc, makeFeature(doc, 'module', { moduleId: 'relief-vase', inputs: { height: 60, diameter: 40, detail: 'preview', pattern: 'none', ...inputs } }));
      const [r] = ev.evaluate(doc);
      expect(r!.error, JSON.stringify(inputs)).toBeUndefined();
      return r!;
    };
    const plain = run({ ribStyle: 'none' });
    for (const style of ['straight', 'beads', 'woven', 'fuzzy']) {
      const r = run({ ribStyle: style, ribs: 40, ribDepth: 1 });
      expect(r.bbox.max.x, style).toBeGreaterThan(plain.bbox.max.x + 0.3);
    }
    // beads add vertical structure: more triangles than straight ribs at the same settings
    expect(run({ ribStyle: 'beads', ribs: 40, beadSize: 2 }).mesh.indices.length).toBeGreaterThan(run({ ribStyle: 'straight', ribs: 40 }).mesh.indices.length);
    // a front picture only raises the front: +x side grows, -x side does not
    const pic = encodeHeightMap(proceduralHeightMap('checker', 32));
    const front = run({ ribStyle: 'none', front: pic, frontWidth: 40, pictureDepth: 3, soften: 0 });
    expect(front.bbox.max.x).toBeGreaterThan(plain.bbox.max.x + 2);
    expect(front.bbox.min.x).toBeCloseTo(plain.bbox.min.x, 0);
    const back = run({ ribStyle: 'none', back: pic, backWidth: 40, pictureDepth: 3, soften: 0 });
    expect(back.bbox.min.x).toBeLessThan(plain.bbox.min.x - 2);
    expect(back.bbox.max.x).toBeCloseTo(plain.bbox.max.x, 0);
    // text goes through the rasterizer (fake in Node) and raises the wall where it sits
    const text = run({ ribStyle: 'none', text: 'ARTEA', textSize: 10, textDepth: 2, textAngle: 90, soften: 0 });
    expect(text.bbox.max.y).toBeGreaterThan(plain.bbox.max.y + 1);
    expect(text.volume).toBeGreaterThan(plain.volume);
    // custom profile: a narrow waist shows up in the volume
    const custom = run({ ribStyle: 'none', shape: 'custom', profile: JSON.stringify([[1, 0], [0.5, 0.5], [1, 1]]) });
    expect(custom.volume).toBeLessThan(plain.volume * 0.9);
    expect(run({ ribStyle: 'none', shape: 'custom', profile: 'not json' }).error).toBeUndefined();
    // printability warnings
    expect(run({ ribs: 400, ribStyle: 'straight' }).warnings?.join(' ')).toMatch(/nozzle/);
    expect(run({ ribs: 40, ribStyle: 'straight' }).warnings).toBeUndefined();
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

describe('height maps', () => {
  it('encode/decode round-trips and rejects garbage', () => {
    const m = proceduralHeightMap('dots', 16);
    const s = encodeHeightMap(m);
    expect(s.startsWith('hm1:16:16:')).toBe(true);
    const back = decodeHeightMap(s)!;
    expect(back.width).toBe(16);
    expect(Array.from(back.data)).toEqual(Array.from(m.data));
    expect(decodeHeightMap('')).toBeNull();
    expect(decodeHeightMap('hm1:4:4:!!!!')).toBeNull();
    expect(decodeHeightMap('hm1:4:4:AAAA')).toBeNull(); // 3 bytes for 16 pixels
  });
  it('samples bilinearly with v=0 at the bottom row and wraps around u', () => {
    const data = new Uint8Array([0, 255, 0, 255]); // 2x2: top row [0,255], bottom row [0,255]
    const m = { width: 2, height: 2, data };
    expect(sampleHeightMap(m, 0.25, 0.25)).toBeCloseTo(0, 5);
    expect(sampleHeightMap(m, 0.75, 0.75)).toBeCloseTo(1, 5);
    expect(sampleHeightMap(m, 0.5, 0.5)).toBeCloseTo(0.5, 5);
    expect(sampleHeightMap(m, 1.25, 0.5)).toBeCloseTo(sampleHeightMap(m, 0.25, 0.5), 5);
    const topHeavy = { width: 1, height: 2, data: new Uint8Array([255, 0]) };
    expect(sampleHeightMap(topHeavy, 0, 0)).toBeLessThan(sampleHeightMap(topHeavy, 0, 1));
  });
  it('blur keeps the mean and softens edges; raster downsampling keeps the aspect', () => {
    const m = proceduralHeightMap('checker', 32);
    const b = blurHeightMap(m, 3);
    const mean = (x: Uint8Array) => x.reduce((a, v) => a + v, 0) / x.length;
    expect(Math.abs(mean(b.data) - mean(m.data))).toBeLessThan(2);
    const edges = (x: Uint8Array) => { let n = 0; for (let i = 1; i < x.length; i++) if (Math.abs(x[i]! - x[i - 1]!) > 200) n++; return n; };
    expect(edges(b.data)).toBeLessThan(edges(m.data));
    const hm = rasterToHeightMap({ data: new Float32Array(1000 * 500).fill(0.5), width: 1000, height: 500 }, 256);
    expect(hm.width).toBe(256);
    expect(hm.height).toBe(128);
    expect(hm.data[0]).toBe(128);
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
