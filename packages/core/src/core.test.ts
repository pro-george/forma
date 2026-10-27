import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  initManifold, Evaluator, createDefaultRegistry, createModuleApi, createDocument, addFeature, makeFeature,
  combine, ungroup, removeFeatures, duplicate, addToCombine, splitFeature, parseDocument, serializeDocument, History, toBinarySTL, to3MF, toOBJ,
  traceRaster, loopsToProfiles, composeTransforms, sampleDocument, LAMP_FAMILIES, SOCKET_HOLE_RADIUS, familyInputs,
  planarFace, loopArea, meshEdges, edgeToolSection, eulerFromBasis,
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

describe('repeat, edges, intersect, split', () => {
  const one = (doc: FormaDocument) => { const [r] = ev.evaluate(doc); expect(r!.error).toBeUndefined(); return r!; };
  it('linear, grid, radial and mirror repeats multiply the volume', () => {
    const base = Math.PI * 25 * 10;
    const mk = (repeat: Record<string, unknown>) => { let doc = createDocument(); doc = addFeature(doc, makeFeature(doc, 'cylinder', { radius: 5, height: 10, segments: 64, repeat })); return one(doc); };
    expect(near(mk({ mode: 'linear', count: 4, step: { x: 20, y: 0, z: 0 } }).volume, base * 4)).toBe(true);
    expect(near(mk({ mode: 'grid', count: 3, count2: 2, step: { x: 20, y: 0, z: 0 }, step2: { x: 0, y: 20, z: 0 } }).volume, base * 6)).toBe(true);
    const radial = mk({ mode: 'radial', count: 6, center: [-30, 0], sweep: 360 });
    expect(near(radial.volume, base * 6)).toBe(true);
    expect(radial.bbox.min.x).toBeLessThan(-50); // copies went all the way around the centre 30 mm away
    expect(near(mk({ mode: 'mirror', axis: 'x', offset: 10 }).volume, base * 2)).toBe(true);
    expect(near(mk({ mode: 'mirror', axis: 'x', offset: 10, keepOriginal: false }).volume, base)).toBe(true);
    // overlapping copies union rather than double-count
    expect(mk({ mode: 'linear', count: 2, step: { x: 2, y: 0, z: 0 } }).volume).toBeLessThan(base * 2);
  });
  it('rounded and chamfered edges remove material and stay watertight', () => {
    const mk = (type: 'box' | 'cylinder', edges: Record<string, unknown>) => {
      let doc = createDocument();
      doc = addFeature(doc, type === 'box' ? makeFeature(doc, 'box', { width: 40, depth: 30, height: 20, edges }) : makeFeature(doc, 'cylinder', { radius: 15, height: 20, segments: 64, edges }));
      return one(doc);
    };
    const plain = mk('box', {}).volume;
    const sides = mk('box', { sides: { kind: 'round', size: 5 } }).volume;
    expect(sides).toBeLessThan(plain);
    // four rounded vertical corners remove (1 - π/4)·r²·h each
    expect(near(sides, plain - 4 * (1 - Math.PI / 4) * 25 * 20, 0.03)).toBe(true);
    const chamfer = mk('box', { sides: { kind: 'chamfer', size: 5 } }).volume;
    expect(chamfer).toBeLessThan(sides); // a chamfer cuts more than a round of the same size
    const top = mk('box', { top: { kind: 'round', size: 4 } });
    expect(top.volume).toBeLessThan(plain);
    expect(top.volume).toBeGreaterThan(plain * 0.9);
    expect(top.bbox.max.z).toBeCloseTo(20, 1);
    const both = mk('cylinder', { top: { kind: 'chamfer', size: 3 }, bottom: { kind: 'round', size: 3 } });
    expect(both.volume).toBeLessThan(mk('cylinder', {}).volume);
    expect(both.bbox.min.z).toBeCloseTo(0, 1);
    // an extrusion with twist keeps rounded corners but skips top/bottom treatments
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'extrude', { profile: { outer: [[-10, -10], [10, -10], [10, 10], [-10, 10]], holes: [] }, height: 20, twist: 30, edges: { sides: { kind: 'round', size: 3 }, top: { kind: 'round', size: 3 } } }));
    expect(one(doc).volume).toBeLessThan(400 * 20);
  });
  it('intersect keeps only the overlap', () => {
    let doc = createDocument();
    const a = makeFeature(doc, 'box', { width: 20, depth: 20, height: 20 });
    const b = makeFeature(doc, 'box', { width: 20, depth: 20, height: 20, role: 'intersect', transform: { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } });
    doc = addFeature(addFeature(doc, a), b);
    doc = combine(doc, [a.id, b.id]).doc;
    expect(near(one(doc).volume, 10 * 20 * 20)).toBe(true);
  });
  it('split makes two parametric halves with a gap', () => {
    let doc = createDocument();
    const box = makeFeature(doc, 'box', { width: 40, depth: 30, height: 20 });
    doc = addFeature(doc, box);
    const r = splitFeature(doc, box.id, { axis: 'z', at: 8, gap: 1 });
    const res = ev.evaluate(r.doc);
    expect(res).toHaveLength(2);
    expect(res.every((x) => !x.error)).toBe(true);
    const [lo, hi] = res.map((x) => x.volume).sort((p, q) => p - q);
    expect(near(lo!, 40 * 30 * 7.5)).toBe(true);
    expect(near(hi!, 40 * 30 * 11.5)).toBe(true);
    const rx = splitFeature(doc, box.id, { axis: 'x', at: 0 });
    expect(ev.evaluate(rx.doc).map((x) => Math.round(x.volume))).toEqual([12000, 12000]);
  });
});

describe('planar faces', () => {
  it('recovers the top face of a box and the ring of a tube, holes included', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'box', { width: 40, depth: 30, height: 20 }));
    const [box] = ev.evaluate(doc);
    // find a triangle on the top (z = 20)
    const m = box!.mesh;
    const topTri = [...Array(m.indices.length / 3).keys()].find((t) => [0, 1, 2].every((k) => Math.abs(m.positions[m.indices[t * 3 + k]! * 3 + 2]! - 20) < 1e-6))!;
    const face = planarFace(m, topTri)!;
    expect(face.normal[2]).toBeCloseTo(1, 5);
    expect(face.loops).toHaveLength(1);
    expect(face.loops[0]).toHaveLength(4);
    expect(Math.abs(loopArea(face.loops[0]!, face.normal))).toBeCloseTo(1200, 3);
    expect(loopArea(face.loops[0]!, face.normal)).toBeGreaterThan(0); // CCW seen from above
    // tube: top ring has an outer loop and a hole loop
    let d2 = createDocument();
    d2 = addFeature(d2, makeFeature(d2, 'tube', { radius: 10, innerRadius: 6, height: 15, segments: 32 }));
    const [tube] = ev.evaluate(d2);
    const tm = tube!.mesh;
    const ringTri = [...Array(tm.indices.length / 3).keys()].find((t) => [0, 1, 2].every((k) => Math.abs(tm.positions[tm.indices[t * 3 + k]! * 3 + 2]! - 15) < 1e-6))!;
    const ring = planarFace(tm, ringTri)!;
    expect(ring.loops).toHaveLength(2);
    expect(loopArea(ring.loops[0]!, ring.normal)).toBeGreaterThan(0);
    expect(loopArea(ring.loops[1]!, ring.normal)).toBeLessThan(0); // hole runs the other way
    expect(Math.abs(loopArea(ring.loops[0]!, ring.normal))).toBeGreaterThan(Math.abs(loopArea(ring.loops[1]!, ring.normal)));
    // a side face of the box is vertical
    const sideTri = [...Array(m.indices.length / 3).keys()].find((t) => [0, 1, 2].every((k) => Math.abs(m.positions[m.indices[t * 3 + k]! * 3]! - 20) < 1e-6))!;
    const side = planarFace(m, sideTri)!;
    expect(side.normal[0]).toBeCloseTo(1, 5);
    expect(Math.abs(loopArea(side.loops[0]!, side.normal))).toBeCloseTo(600, 3);
  });
});

describe('rotation convention', () => {
  it('eulerFromBasis places a part so local axes land on the basis, in the kernel', () => {
    // local x → +y, local y → +z, local z → +x
    const rot = eulerFromBasis({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 });
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'box', { width: 5, depth: 2, height: 9, transform: { position: { x: 0, y: 0, z: 0 }, rotation: rot } }));
    const m = ev.worldManifold(doc);
    const b = m.boundingBox(); m.delete();
    // box authored centred in x/y (±2.5, ±1) base on z=0..9 → after: x 0..9, y ±2.5, z ±1
    expect(b.min.map((v) => +v.toFixed(2))).toEqual([0, -2.5, -1]);
    expect(b.max.map((v) => +v.toFixed(2))).toEqual([9, 2.5, 1]);
  });
});

describe('mesh edges and edge tools', () => {
  it('a box has 12 straight convex edges; a cut box has concave ones too', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'box', { width: 40, depth: 30, height: 20 }));
    const { faces, edges } = meshEdges(ev.evaluate(doc)[0]!.mesh);
    expect(faces).toHaveLength(6);
    expect(edges).toHaveLength(12);
    expect(edges.every((e) => e.convex)).toBe(true);
    const lens = edges.map((e) => Math.round(e.length)).sort((a, b) => a - b);
    expect(lens).toEqual([20, 20, 20, 20, 30, 30, 30, 30, 40, 40, 40, 40]);
    // an L: box minus a corner block → 4 concave edges around the notch
    let d2 = createDocument();
    const b = makeFeature(d2, 'box', { width: 40, depth: 30, height: 20 });
    const cut = makeFeature(d2, 'box', { width: 20, depth: 40, height: 10, role: 'hole', transform: { position: { x: 10, y: 0, z: 10 }, rotation: { x: 0, y: 0, z: 0 } } });
    d2 = combine(addFeature(addFeature(d2, b), cut), [b.id, cut.id]).doc;
    const L = meshEdges(ev.evaluate(d2)[0]!.mesh);
    expect(L.edges.filter((e) => !e.convex).length).toBeGreaterThanOrEqual(1);
    expect(L.edges.filter((e) => e.convex).length).toBeGreaterThan(12);
  });
  it('chamfer and fillet tool bodies remove the expected volume on a box edge', () => {
    let doc = createDocument();
    const box = makeFeature(doc, 'box', { width: 40, depth: 30, height: 20 });
    doc = addFeature(doc, box);
    const mesh = ev.evaluate(doc)[0]!.mesh;
    const { edges } = meshEdges(mesh);
    // the top-front edge: z = 20, y = -15, along x
    const edge = edges.find((e) => Math.abs(e.a[2] - 20) < 1e-6 && Math.abs(e.b[2] - 20) < 1e-6 && Math.abs(e.a[1] + 15) < 1e-6 && Math.abs(e.b[1] + 15) < 1e-6)!;
    expect(edge).toBeTruthy();
    const build = (kind: 'chamfer' | 'round', size: number) => {
      const sec = edgeToolSection(edge, kind, size, 0.02)!;
      expect(sec.role).toBe('hole');
      // place the section as an extrude along the edge: plane normal = edge dir; local X = u, local Y = v
      const { u, v } = sec.frame;
      const dir = edge.dir;
      const rot = eulerFromBasis({ x: u[0], y: u[1], z: u[2] }, { x: v[0], y: v[1], z: v[2] }, { x: dir[0], y: dir[1], z: dir[2] });
      const tool = makeFeature(doc, 'extrude', { role: 'hole', profile: { outer: sec.points, holes: [] }, height: edge.length + 0.04,
        transform: { position: { x: edge.a[0] - dir[0] * 0.02, y: edge.a[1] - dir[1] * 0.02, z: edge.a[2] - dir[2] * 0.02 }, rotation: rot } });
      const d = combine(addFeature(doc, tool), [box.id, tool.id]).doc;
      const r = ev.evaluate(d)[0]!;
      expect(r.error).toBeUndefined();
      return r.volume;
    };
    const plain = 40 * 30 * 20;
    const chamfer = build('chamfer', 5);
    expect(near(chamfer, plain - 0.5 * 5 * 5 * 40, 0.02)).toBe(true);
    const round = build('round', 5);
    expect(near(round, plain - (1 - Math.PI / 4) * 25 * 40, 0.03)).toBe(true);
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
  it('OBJ lists every vertex and face with shared numbering across objects', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'box', { width: 10, depth: 10, height: 10 }));
    const [r] = ev.evaluate(doc);
    const text = new TextDecoder().decode(toOBJ([{ name: 'A box', mesh: r!.mesh }, { name: 'B', mesh: r!.mesh }]));
    const v = (text.match(/^v /gm) ?? []).length, f = (text.match(/^f /gm) ?? []).length;
    expect(v).toBe((r!.mesh.positions.length / 3) * 2);
    expect(f).toBe((r!.mesh.indices.length / 3) * 2);
    expect(text).toContain('o A_box');
    // the second object's faces reference vertices after the first object's
    const lastFace = text.trim().split('\n').pop()!;
    expect(Math.max(...lastFace.slice(2).split(' ').map(Number))).toBe(v);
  });
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
  it('3MF carries filament slots the way Bambu Studio and PrusaSlicer read them', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'box', { width: 10, depth: 10, height: 2 }));
    doc = addFeature(doc, makeFeature(doc, 'cylinder', { radius: 2, height: 6, filament: 3 }));
    const [a, b] = ev.evaluate(doc);
    const files = unzipSync(to3MF([{ name: 'plate', mesh: a!.mesh, filament: 1 }, { name: 'peg', mesh: b!.mesh, filament: 3 }], 'Test', { filaments: doc.filaments, colors: true }));
    const text = (n: string) => strFromU8(files[n]!);
    const model = text('3D/3dmodel.model');
    // two filaments → one assembly object with two component parts in the build
    expect(model).toContain('<components>');
    expect(model.match(/<item /g)!.length).toBe(1);
    expect(model).toContain('<metadata name="Application">Forma</metadata>');
    expect(model).toContain('<m:colorgroup');
    // Bambu: per-part extruder in model_settings.config, matching component ids
    const bambu = text('Metadata/model_settings.config');
    expect(bambu).toContain('<part id="1" subtype="normal_part">');
    expect(bambu).toContain('<part id="2" subtype="normal_part">');
    expect(bambu.match(/key="extruder" value="3"/g)!.length).toBe(1);
    expect(bambu.match(/key="extruder" value="1"/g)!.length).toBe(2); // object default + plate part
    // Prusa: volumes as contiguous triangle ranges
    const prusa = text('Metadata/Slic3r_PE_model.config');
    const plateTris = a!.mesh.indices.length / 3;
    expect(prusa).toContain(`<volume firstid="0" lastid="${plateTris - 1}">`);
    expect(prusa).toContain(`<volume firstid="${plateTris}" lastid="${plateTris + b!.mesh.indices.length / 3 - 1}">`);
    expect(prusa).toContain('key="extruder" value="3"');
    // single filament → independent objects, no colour groups unless asked
    const single = strFromU8(unzipSync(to3MF([{ name: 'a', mesh: a!.mesh }, { name: 'b', mesh: b!.mesh }]))['3D/3dmodel.model']!);
    expect(single).not.toContain('<components>');
    expect(single.match(/<item /g)!.length).toBe(2);
    expect(single).not.toContain('colorgroup');
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
