import { describe, it, expect } from 'vitest';
import { sk, type Sketch } from './sketch.js';
import { solveSketch, tryAddConstraint, measure, constraintId, type Constraint } from './constraints.js';
import { evalExpr, evalParams } from './expr.js';

const rect = (): Sketch => {
  const [b, r, t, l] = sk.rect([0, 0], [40, 25]);
  return { entities: [b!, r!, t!, l!], constraints: [] };
};
const id = () => constraintId();

describe('expressions', () => {
  it('evaluates units, parameters and functions', () => {
    expect(evalExpr('2 * 10 mm + 1 cm')).toBeCloseTo(30);
    expect(evalExpr('1 in')).toBeCloseTo(25.4);
    expect(evalExpr('w / 2 + sqrt(16)', { w: 40 })).toBeCloseTo(24);
    expect(evalExpr('sin(30) * 10')).toBeCloseTo(5);
    expect(() => evalExpr('w + 1')).toThrow(/Unknown parameter/);
    expect(() => evalExpr('2 +')).toThrow();
  });
  it('resolves parameters in dependency order and reports cycles', () => {
    const r = evalParams([{ name: 'b', expr: 'a * 2' }, { name: 'a', expr: '5 mm' }, { name: 'c', expr: 'd + 1' }, { name: 'd', expr: 'c + 1' }]);
    expect(r.scope).toEqual({ a: 5, b: 10 });
    expect(Object.keys(r.errors).sort()).toEqual(['c', 'd']);
  });
});

describe('sketch solver', () => {
  it('leaves an unconstrained sketch alone and counts its freedom', () => {
    const s = rect();
    const r = solveSketch(s);
    expect(r.status).toBe('solved');
    expect(r.entities).toEqual(s.entities);
    // 4 lines × 4 coords = 16 unknowns, 4 implicit welds × 2 rows = 8 → 8 dof
    expect(r.dof).toBe(8);
    expect(r.fullyConstrained.size).toBe(0);
  });

  it('solves horizontal/vertical and driving lengths, keeping the loop closed', () => {
    let s = rect();
    const [b, rgt, t, l] = s.entities.map((e) => e.id) as [string, string, string, string];
    const cs: Constraint[] = [
      { id: id(), kind: 'horizontal', l: b }, { id: id(), kind: 'horizontal', l: t },
      { id: id(), kind: 'vertical', l: rgt }, { id: id(), kind: 'vertical', l: l },
      { id: id(), kind: 'length', l: b, value: 60 }, { id: id(), kind: 'length', l: rgt, value: 30 },
      { id: id(), kind: 'fix', p: { id: b, pt: 'a' } },
    ];
    for (const c of cs) { const r = tryAddConstraint(s, c); expect(r.ok, c.kind).toBe(true); if (r.ok) s = r.sketch; }
    const r = solveSketch(s);
    expect(r.status).toBe('solved');
    expect(r.dof).toBe(0);
    expect(r.fullyConstrained.size).toBe(4);
    const bottom = r.entities.find((e) => e.id === b)!;
    expect(bottom.type === 'line' && Math.hypot(bottom.b[0] - bottom.a[0], bottom.b[1] - bottom.a[1])).toBeCloseTo(60, 3);
    const right = r.entities.find((e) => e.id === rgt)!;
    expect(right.type === 'line' && Math.abs(right.b[1] - right.a[1])).toBeCloseTo(30, 3);
    // corners still meet
    const top = r.entities.find((e) => e.id === t)!;
    expect(top.type === 'line' && right.type === 'line' && Math.hypot(top.a[0] - right.b[0], top.a[1] - right.b[1])).toBeLessThan(1e-3);
  });

  it('refuses a redundant constraint and a conflicting one', () => {
    let s = rect();
    const [b, , t] = s.entities.map((e) => e.id) as [string, string, string, string];
    for (const c of [{ id: id(), kind: 'horizontal', l: b }, { id: id(), kind: 'horizontal', l: t }] as Constraint[]) { const r = tryAddConstraint(s, c); expect(r.ok).toBe(true); if (r.ok) s = r.sketch; }
    // top and bottom are both horizontal, so "parallel" adds nothing
    const red = tryAddConstraint(s, { id: id(), kind: 'parallel', a: b, b: t });
    expect(red.ok).toBe(false);
    if (!red.ok) expect(red.reason).toMatch(/over-constrain/);
    // a bottom line that is both horizontal and vertical is impossible
    const con = tryAddConstraint(s, { id: id(), kind: 'vertical', l: b });
    expect(con.ok).toBe(false);
  });

  it('keeps dimensions while a point is dragged', () => {
    let s = rect();
    const [b, rgt] = s.entities.map((e) => e.id) as [string, string];
    for (const c of [{ id: id(), kind: 'length', l: b, value: 40 }, { id: id(), kind: 'horizontal', l: b }, { id: id(), kind: 'vertical', l: rgt }] as Constraint[]) { const r = tryAddConstraint(s, c); if (r.ok) s = r.sketch; }
    const r = solveSketch(s, { hold: { p: { id: rgt, pt: 'b' }, at: [45, 40] } });
    expect(r.status).toBe('solved');
    const bottom = r.entities.find((e) => e.id === b)!;
    expect(bottom.type === 'line' && Math.hypot(bottom.b[0] - bottom.a[0], bottom.b[1] - bottom.a[1])).toBeCloseTo(40, 3);
    const right = r.entities.find((e) => e.id === rgt)!;
    expect(right.type === 'line' && Math.abs(right.b[0] - right.a[0])).toBeLessThan(1e-3);
    expect(right.type === 'line' && right.b[1]).toBeCloseTo(40, 1);
  });

  it('dimensions follow parameter expressions', () => {
    let s = rect();
    const [b] = s.entities.map((e) => e.id) as [string];
    const r = tryAddConstraint(s, { id: id(), kind: 'length', l: b, value: 40, expr: 'w * 2' }, { w: 35 });
    expect(r.ok).toBe(true);
    if (r.ok) s = r.sketch;
    const bottom = s.entities.find((e) => e.id === b)!;
    expect(bottom.type === 'line' && Math.hypot(bottom.b[0] - bottom.a[0], bottom.b[1] - bottom.a[1])).toBeCloseTo(70, 3);
  });

  it('measures, tangency and concentric circles', () => {
    const c1 = sk.circle([0, 0], 10), c2 = sk.circle([30, 0], 5), ln = sk.line([-20, 15], [40, 15]);
    let s: Sketch = { entities: [c1, c2, ln], constraints: [] };
    expect(measure(s, { kind: 'diameter', c: c1.id })).toBeCloseTo(20);
    expect(measure(s, { kind: 'distance', p: { id: c1.id, pt: 'c' }, q: { id: c2.id, pt: 'c' } })).toBeCloseTo(30);
    for (const c of [
      { id: id(), kind: 'fix', p: { id: c1.id, pt: 'c' } }, { id: id(), kind: 'radius', c: c1.id, value: 10 },
      { id: id(), kind: 'tangent', a: ln.id, b: c1.id }, { id: id(), kind: 'horizontal', l: ln.id },
      { id: id(), kind: 'concentric', a: c1.id, b: c2.id },
    ] as Constraint[]) { const r = tryAddConstraint(s, c); expect(r.ok, c.kind).toBe(true); if (r.ok) s = r.sketch; }
    const line = s.entities.find((e) => e.id === ln.id)!;
    expect(line.type === 'line' && Math.abs(line.a[1])).toBeCloseTo(10, 3);
    const inner = s.entities.find((e) => e.id === c2.id)!;
    expect(inner.type === 'circle' && Math.hypot(inner.center[0], inner.center[1])).toBeLessThan(1e-3);
  });
});
