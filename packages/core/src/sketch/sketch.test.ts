import { describe, it, expect, beforeAll } from 'vitest';
import { sk, sketchToProfiles, buildLoops, arcSweep, tessellate, type Sketch, type SketchEntity } from './sketch.js';
import { initManifold, Evaluator, createDefaultRegistry, createModuleApi, createDocument, addFeature, makeFeature } from '../index.js';

describe('sketch → profiles', () => {
  it('four lines in any order and direction form one loop', () => {
    const [l1, l2, l3, l4] = sk.rect([0, 0], [20, 10]);
    if (!l3 || l3.type !== 'line') throw new Error();
    const flipped: SketchEntity = { id: l3.id, type: 'line', a: l3.b, b: l3.a };
    const sketch: Sketch = { entities: [l4!, flipped, l1!, l2!] };
    const r = sketchToProfiles(sketch);
    expect(r.openIds).toEqual([]);
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0]!.outer).toHaveLength(4);
  });
  it('a circle inside a rectangle becomes a hole; a dangling line is reported', () => {
    const dangling = sk.line([50, 50], [60, 60]);
    const sketch: Sketch = { entities: [...sk.rect([-20, -10], [20, 10]), sk.circle([0, 0], 4), dangling] };
    const r = sketchToProfiles(sketch);
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0]!.holes).toHaveLength(1);
    expect(r.openIds).toEqual([dangling.id]);
  });
  it('two separate loops give two profiles', () => {
    const sketch: Sketch = { entities: [...sk.rect([0, 0], [10, 10]), ...sk.rect([30, 0], [40, 10])] };
    expect(sketchToProfiles(sketch).profiles).toHaveLength(2);
  });
  it('arc + line slot closes (D shape)', () => {
    const arc = sk.arc3([0, -10], [10, 0], [0, 10]);
    expect(arc.type).toBe('arc');
    const sketch: Sketch = { entities: [arc, sk.line([0, 10], [0, -10])] };
    const { loops, openIds } = buildLoops(sketch);
    expect(openIds).toEqual([]);
    expect(loops).toHaveLength(1);
    // half disk area ≈ π·100/2
    const area = Math.abs(loops[0]!.reduce((a, p, i, arr) => { const q = arr[(i + 1) % arr.length]!; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    expect(Math.abs(area - Math.PI * 50) / (Math.PI * 50)).toBeLessThan(0.02);
  });
  it('arc3 picks the direction through the middle point', () => {
    const cw = sk.arc3([0, 10], [10, 0], [0, -10]);
    if (cw.type !== 'arc') throw new Error();
    expect(cw.ccw).toBe(false);
    expect(Math.abs(arcSweep(cw))).toBeCloseTo(180, 0);
    expect(tessellate(cw).length).toBeGreaterThan(8);
  });
});

describe('extrude from sketch through the kernel', () => {
  let ev: Evaluator;
  beforeAll(async () => { ev = new Evaluator(await initManifold(), { registry: createDefaultRegistry(), api: createModuleApi(null) }); });
  it('plate with a round hole has the right volume', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'extrude', { sketch: { entities: [...sk.rect([-20, -10], [20, 10]), sk.circle([0, 0], 4)] }, height: 5 }));
    const [r] = ev.evaluate(doc);
    expect(r!.error).toBeUndefined();
    const expected = (40 * 20 - Math.PI * 16) * 5;
    expect(Math.abs(r!.volume - expected) / expected).toBeLessThan(0.01);
  });
  it('an open sketch reports a friendly error', () => {
    let doc = createDocument();
    doc = addFeature(doc, makeFeature(doc, 'extrude', { sketch: { entities: [sk.line([0, 0], [10, 0])] }, height: 5 }));
    expect(ev.evaluate(doc)[0]!.error).toMatch(/no closed outline/);
  });
});
