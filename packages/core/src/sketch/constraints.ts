/**
 * Sketch constraints and the solver, after SolidCraft's `sketch` crate.
 *
 * Unknowns are the coordinates of every point (line ends, circle and arc
 * centres), every circle / arc radius and every arc end angle. Each
 * constraint contributes residuals that are zero when it holds, in mm so the
 * rows share a scale (angles are scaled by ANGLE_MM). The system is solved
 * with damped Gauss–Newton (Levenberg–Marquardt) on a dense Jacobian built from
 * central differences, starting from the current positions and preferring
 * small moves, so an under-constrained sketch moves as little as possible.
 * Afterwards the rank of the Jacobian gives the remaining degrees of freedom
 * and which unknowns are fully determined.
 *
 * Forma's entities keep their own coordinates (a closed loop is lines whose
 * ends share values), so endpoints that coincide are held together by implicit
 * coincident constraints added at solve time.
 */
import { z } from 'zod';
import type { Vec2 } from '../document/types.js';
import type { Sketch, SketchEntity } from './sketch.js';
import { evalExpr, type Scope } from './expr.js';

/** A point handle: a line's `a` / `b`, a circle's or arc's centre `c`, an arc's start `a` / end `b`. */
export const PointRefSchema = z.object({ id: z.string(), pt: z.enum(['a', 'b', 'c']) });
export type PointRef = z.infer<typeof PointRefSchema>;

const Dim = { value: z.number(), expr: z.string().optional() };
export const ConstraintSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('coincident'), p: PointRefSchema, q: PointRefSchema }),
  z.object({ id: z.string(), kind: z.literal('pointOnCurve'), p: PointRefSchema, c: z.string() }),
  z.object({ id: z.string(), kind: z.literal('horizontal'), l: z.string() }),
  z.object({ id: z.string(), kind: z.literal('vertical'), l: z.string() }),
  z.object({ id: z.string(), kind: z.literal('parallel'), a: z.string(), b: z.string() }),
  z.object({ id: z.string(), kind: z.literal('perpendicular'), a: z.string(), b: z.string() }),
  z.object({ id: z.string(), kind: z.literal('tangent'), a: z.string(), b: z.string() }),
  z.object({ id: z.string(), kind: z.literal('equal'), a: z.string(), b: z.string() }),
  z.object({ id: z.string(), kind: z.literal('concentric'), a: z.string(), b: z.string() }),
  z.object({ id: z.string(), kind: z.literal('midpoint'), p: PointRefSchema, l: z.string() }),
  z.object({ id: z.string(), kind: z.literal('fix'), p: PointRefSchema }),
  // driving dimensions
  z.object({ id: z.string(), kind: z.literal('distance'), p: PointRefSchema, q: PointRefSchema, ...Dim }),
  z.object({ id: z.string(), kind: z.literal('distanceX'), p: PointRefSchema, q: PointRefSchema, ...Dim }),
  z.object({ id: z.string(), kind: z.literal('distanceY'), p: PointRefSchema, q: PointRefSchema, ...Dim }),
  z.object({ id: z.string(), kind: z.literal('length'), l: z.string(), ...Dim }),
  z.object({ id: z.string(), kind: z.literal('radius'), c: z.string(), ...Dim }),
  z.object({ id: z.string(), kind: z.literal('diameter'), c: z.string(), ...Dim }),
  /** angle from line a to line b, degrees, counter-clockwise */
  z.object({ id: z.string(), kind: z.literal('angle'), a: z.string(), b: z.string(), ...Dim }),
]);
export type Constraint = z.infer<typeof ConstraintSchema>;
export type ConstraintKind = Constraint['kind'];
export const DIMENSION_KINDS: ConstraintKind[] = ['distance', 'distanceX', 'distanceY', 'length', 'radius', 'diameter', 'angle'];
export const isDimension = (c: Constraint): c is Extract<Constraint, { value: number }> => DIMENSION_KINDS.includes(c.kind);

let n = 0;
export const constraintId = () => `k${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Residual scale for angles: 1 rad counts as this many mm. */
const ANGLE_MM = 10;
const WELD = 1e-6;
const d2r = Math.PI / 180;

/* ---------- variables ---------- */

interface Layout { index: Map<string, number>; n: number; ids: string[] }

/** Variable layout: line a.x a.y b.x b.y; circle c.x c.y r; arc c.x c.y r a0 a1 (angles in radians). */
function layoutOf(entities: SketchEntity[]): Layout {
  const index = new Map<string, number>();
  let n = 0;
  for (const e of entities) {
    index.set(e.id, n);
    n += e.type === 'line' ? 4 : e.type === 'circle' ? 3 : 5;
  }
  return { index, n, ids: entities.map((e) => e.id) };
}

function pack(entities: SketchEntity[], lay: Layout): Float64Array {
  const x = new Float64Array(lay.n);
  for (const e of entities) {
    const i = lay.index.get(e.id)!;
    if (e.type === 'line') { x[i] = e.a[0]; x[i + 1] = e.a[1]; x[i + 2] = e.b[0]; x[i + 3] = e.b[1]; }
    else if (e.type === 'circle') { x[i] = e.center[0]; x[i + 1] = e.center[1]; x[i + 2] = e.radius; }
    else { x[i] = e.center[0]; x[i + 1] = e.center[1]; x[i + 2] = e.radius; x[i + 3] = e.startAngle * d2r; x[i + 4] = e.endAngle * d2r; }
  }
  return x;
}

function unpack(entities: SketchEntity[], lay: Layout, x: Float64Array): SketchEntity[] {
  const r2 = (v: number) => Math.round(v * 1e4) / 1e4;
  return entities.map((e) => {
    const i = lay.index.get(e.id)!;
    if (e.type === 'line') return { ...e, a: [r2(x[i]!), r2(x[i + 1]!)] as Vec2, b: [r2(x[i + 2]!), r2(x[i + 3]!)] as Vec2 };
    if (e.type === 'circle') return { ...e, center: [r2(x[i]!), r2(x[i + 1]!)] as Vec2, radius: Math.max(0.01, r2(x[i + 2]!)) };
    return { ...e, center: [r2(x[i]!), r2(x[i + 1]!)] as Vec2, radius: Math.max(0.01, r2(x[i + 2]!)), startAngle: r2(x[i + 3]! / d2r), endAngle: r2(x[i + 4]! / d2r) };
  });
}

/** Variable indices (x, y) that a point handle reads; for arc ends the point is derived from centre, radius and angle. */
function pointVars(e: SketchEntity, pt: PointRef['pt'], base: number): number[] {
  if (e.type === 'line') return pt === 'b' ? [base + 2, base + 3] : [base, base + 1];
  if (e.type === 'circle') return [base, base + 1];
  if (pt === 'c') return [base, base + 1];
  return [base, base + 1, base + 2, pt === 'a' ? base + 3 : base + 4];
}

/* ---------- residuals ---------- */

type Residual = (x: Float64Array, out: number[]) => void;

function compile(sketch: Sketch, lay: Layout, constraints: Constraint[], scope: Scope): { residuals: Residual[]; owners: number[][] } {
  const byId = new Map(sketch.entities.map((e) => [e.id, e]));
  const residuals: Residual[] = [];
  const owners: number[][] = []; // variable indices each residual block touches (for the rank analysis)
  const P = (r: PointRef): ((x: Float64Array) => [number, number]) | null => {
    const e = byId.get(r.id); if (!e) return null;
    const base = lay.index.get(e.id)!;
    if (e.type === 'arc' && r.pt !== 'c') { const ang = r.pt === 'a' ? base + 3 : base + 4; return (x) => [x[base]! + Math.cos(x[ang]!) * x[base + 2]!, x[base + 1]! + Math.sin(x[ang]!) * x[base + 2]!]; }
    const [ix, iy] = pointVars(e, r.pt, base) as [number, number];
    return (x) => [x[ix]!, x[iy]!];
  };
  const vars = (r: PointRef): number[] => { const e = byId.get(r.id); return e ? pointVars(e, r.pt, lay.index.get(e.id)!) : []; };
  const L = (id: string) => { const e = byId.get(id); if (!e || e.type !== 'line') return null; const b = lay.index.get(id)!; return { ax: b, ay: b + 1, bx: b + 2, by: b + 3 }; };
  const C = (id: string) => { const e = byId.get(id); if (!e || e.type === 'line') return null; const b = lay.index.get(id)!; return { cx: b, cy: b + 1, r: b + 2 }; };
  const dir = (l: { ax: number; ay: number; bx: number; by: number }, x: Float64Array): [number, number, number] => { const dx = x[l.bx]! - x[l.ax]!, dy = x[l.by]! - x[l.ay]!; const len = Math.hypot(dx, dy) || 1e-9; return [dx / len, dy / len, len]; };
  const value = (c: Extract<Constraint, { value: number }>) => (c.expr ? safeEval(c.expr, scope, c.value) : c.value);

  for (const c of constraints) {
    switch (c.kind) {
      case 'coincident': { const p = P(c.p), q = P(c.q); if (!p || !q) break; residuals.push((x, o) => { const a = p(x), b = q(x); o.push(a[0] - b[0], a[1] - b[1]); }); owners.push([...vars(c.p), ...vars(c.q)]); break; }
      case 'pointOnCurve': {
        const p = P(c.p); if (!p) break;
        const l = L(c.c); const k = C(c.c);
        if (l) { residuals.push((x, o) => { const [ux, uy] = dir(l, x); const q = p(x); o.push(-(q[0] - x[l.ax]!) * uy + (q[1] - x[l.ay]!) * ux); }); owners.push([...vars(c.p), l.ax, l.ay, l.bx, l.by]); }
        else if (k) { residuals.push((x, o) => { const q = p(x); o.push(Math.hypot(q[0] - x[k.cx]!, q[1] - x[k.cy]!) - x[k.r]!); }); owners.push([...vars(c.p), k.cx, k.cy, k.r]); }
        break;
      }
      case 'horizontal': { const l = L(c.l); if (!l) break; residuals.push((x, o) => o.push(x[l.by]! - x[l.ay]!)); owners.push([l.ay, l.by]); break; }
      case 'vertical': { const l = L(c.l); if (!l) break; residuals.push((x, o) => o.push(x[l.bx]! - x[l.ax]!)); owners.push([l.ax, l.bx]); break; }
      case 'parallel': { const a = L(c.a), b = L(c.b); if (!a || !b) break; residuals.push((x, o) => { const u = dir(a, x), v = dir(b, x); o.push((u[0] * v[1] - u[1] * v[0]) * ANGLE_MM); }); owners.push([a.ax, a.ay, a.bx, a.by, b.ax, b.ay, b.bx, b.by]); break; }
      case 'perpendicular': { const a = L(c.a), b = L(c.b); if (!a || !b) break; residuals.push((x, o) => { const u = dir(a, x), v = dir(b, x); o.push((u[0] * v[0] + u[1] * v[1]) * ANGLE_MM); }); owners.push([a.ax, a.ay, a.bx, a.by, b.ax, b.ay, b.bx, b.by]); break; }
      case 'tangent': {
        const la = L(c.a), lb = L(c.b), ka = C(c.a), kb = C(c.b);
        const l = la ?? lb, k = la ? kb : ka;
        if (l && k) { residuals.push((x, o) => { const [ux, uy] = dir(l, x); const d = -(x[k.cx]! - x[l.ax]!) * uy + (x[k.cy]! - x[l.ay]!) * ux; o.push(Math.abs(d) - x[k.r]!); }); owners.push([l.ax, l.ay, l.bx, l.by, k.cx, k.cy, k.r]); }
        else if (ka && kb) {
          // external or internal tangency, whichever is closer now
          const x0 = pack(sketch.entities, lay);
          const d0 = Math.hypot(x0[ka.cx]! - x0[kb.cx]!, x0[ka.cy]! - x0[kb.cy]!);
          const internal = Math.abs(d0 - Math.abs(x0[ka.r]! - x0[kb.r]!)) < Math.abs(d0 - (x0[ka.r]! + x0[kb.r]!));
          residuals.push((x, o) => { const d = Math.hypot(x[ka.cx]! - x[kb.cx]!, x[ka.cy]! - x[kb.cy]!); o.push(d - (internal ? Math.abs(x[ka.r]! - x[kb.r]!) : x[ka.r]! + x[kb.r]!)); });
          owners.push([ka.cx, ka.cy, ka.r, kb.cx, kb.cy, kb.r]);
        }
        break;
      }
      case 'equal': {
        const la = L(c.a), lb = L(c.b), ka = C(c.a), kb = C(c.b);
        if (la && lb) { residuals.push((x, o) => o.push(dir(la, x)[2] - dir(lb, x)[2])); owners.push([la.ax, la.ay, la.bx, la.by, lb.ax, lb.ay, lb.bx, lb.by]); }
        else if (ka && kb) { residuals.push((x, o) => o.push(x[ka.r]! - x[kb.r]!)); owners.push([ka.r, kb.r]); }
        break;
      }
      case 'concentric': { const a = C(c.a), b = C(c.b); if (!a || !b) break; residuals.push((x, o) => o.push(x[a.cx]! - x[b.cx]!, x[a.cy]! - x[b.cy]!)); owners.push([a.cx, a.cy, b.cx, b.cy]); break; }
      case 'midpoint': { const p = P(c.p), l = L(c.l); if (!p || !l) break; residuals.push((x, o) => { const q = p(x); o.push(q[0] - (x[l.ax]! + x[l.bx]!) / 2, q[1] - (x[l.ay]! + x[l.by]!) / 2); }); owners.push([...vars(c.p), l.ax, l.ay, l.bx, l.by]); break; }
      case 'fix': { const p = P(c.p); if (!p) break; const x0 = pack(sketch.entities, lay); const at = p(x0); residuals.push((x, o) => { const q = p(x); o.push(q[0] - at[0], q[1] - at[1]); }); owners.push(vars(c.p)); break; }
      case 'distance': { const p = P(c.p), q = P(c.q); if (!p || !q) break; residuals.push((x, o) => { const a = p(x), b = q(x); o.push(Math.hypot(a[0] - b[0], a[1] - b[1]) - value(c)); }); owners.push([...vars(c.p), ...vars(c.q)]); break; }
      case 'distanceX': { const p = P(c.p), q = P(c.q); if (!p || !q) break; residuals.push((x, o) => { const a = p(x), b = q(x); o.push(Math.abs(a[0] - b[0]) - value(c)); }); owners.push([...vars(c.p), ...vars(c.q)]); break; }
      case 'distanceY': { const p = P(c.p), q = P(c.q); if (!p || !q) break; residuals.push((x, o) => { const a = p(x), b = q(x); o.push(Math.abs(a[1] - b[1]) - value(c)); }); owners.push([...vars(c.p), ...vars(c.q)]); break; }
      case 'length': { const l = L(c.l); if (!l) break; residuals.push((x, o) => o.push(dir(l, x)[2] - value(c))); owners.push([l.ax, l.ay, l.bx, l.by]); break; }
      case 'radius': { const k = C(c.c); if (!k) break; residuals.push((x, o) => o.push(x[k.r]! - value(c))); owners.push([k.r]); break; }
      case 'diameter': { const k = C(c.c); if (!k) break; residuals.push((x, o) => o.push(2 * x[k.r]! - value(c))); owners.push([k.r]); break; }
      case 'angle': {
        const a = L(c.a), b = L(c.b); if (!a || !b) break;
        residuals.push((x, o) => { const u = dir(a, x), v = dir(b, x); let ang = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) / d2r - value(c); ang = ((ang + 180) % 360 + 360) % 360 - 180; o.push(ang * d2r * ANGLE_MM); });
        owners.push([a.ax, a.ay, a.bx, a.by, b.ax, b.ay, b.bx, b.by]);
        break;
      }
    }
  }
  return { residuals, owners };
}

function safeEval(expr: string, scope: Scope, fallback: number): number {
  try { return evalExpr(expr, scope); } catch { return fallback; }
}

/** Endpoints that share coordinates are welded: Forma's loops close by equal values, not by shared points. */
export function implicitCoincidences(entities: SketchEntity[]): Constraint[] {
  const pts: { ref: PointRef; p: Vec2 }[] = [];
  for (const e of entities) {
    if (e.type === 'line') pts.push({ ref: { id: e.id, pt: 'a' }, p: e.a }, { ref: { id: e.id, pt: 'b' }, p: e.b });
    else if (e.type === 'arc') { const a = [e.center[0] + Math.cos(e.startAngle * d2r) * e.radius, e.center[1] + Math.sin(e.startAngle * d2r) * e.radius] as Vec2; const b = [e.center[0] + Math.cos(e.endAngle * d2r) * e.radius, e.center[1] + Math.sin(e.endAngle * d2r) * e.radius] as Vec2; pts.push({ ref: { id: e.id, pt: 'a' }, p: a }, { ref: { id: e.id, pt: 'b' }, p: b }); }
  }
  const out: Constraint[] = [];
  // union-find style chaining: each point welds to the first point of its cluster
  const first: { ref: PointRef; p: Vec2 }[] = [];
  for (const q of pts) {
    const f = first.find((x) => Math.hypot(x.p[0] - q.p[0], x.p[1] - q.p[1]) < 1e-4);
    if (f) out.push({ id: `~${f.ref.id}${f.ref.pt}-${q.ref.id}${q.ref.pt}`, kind: 'coincident', p: f.ref, q: q.ref });
    else first.push(q);
  }
  return out;
}

/* ---------- linear algebra ---------- */

function jacobian(F: (x: Float64Array) => number[], x: Float64Array, m: number): number[][] {
  const n = x.length;
  const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]!));
    const xp = Float64Array.from(x); xp[j] = x[j]! + h;
    const xm = Float64Array.from(x); xm[j] = x[j]! - h;
    const fp = F(xp), fm = F(xm);
    for (let i = 0; i < m; i++) J[i]![j] = (fp[i]! - fm[i]!) / (2 * h);
  }
  return J;
}

/** Solve (A) δ = b for symmetric positive definite A by Cholesky; returns null when singular. */
function cholSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const Lm: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k++) s -= Lm[i]![k]! * Lm[j]![k]!;
      if (i === j) { if (s <= 1e-14) return null; Lm[i]![i] = Math.sqrt(s); } else Lm[i]![j] = s / Lm[j]![j]!;
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) { let s = b[i]!; for (let k = 0; k < i; k++) s -= Lm[i]![k]! * y[k]!; y[i] = s / Lm[i]![i]!; }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]!; for (let k = i + 1; k < n; k++) s -= Lm[k]![i]! * x[k]!; x[i] = s / Lm[i]![i]!; }
  return x;
}

/** Row-reduce J (copy) and report its rank and which columns are determined (no freedom left). */
function rankAnalysis(J: number[][], n: number): { rank: number; determined: boolean[] } {
  const m = J.length;
  const A = J.map((r) => r.slice());
  const pivots: number[] = [];
  let row = 0;
  const scale = Math.max(1e-12, ...A.flat().map(Math.abs));
  const eps = 1e-7 * scale;
  for (let col = 0; col < n && row < m; col++) {
    let best = row;
    for (let i = row + 1; i < m; i++) if (Math.abs(A[i]![col]!) > Math.abs(A[best]![col]!)) best = i;
    if (Math.abs(A[best]![col]!) < eps) continue;
    [A[row], A[best]] = [A[best]!, A[row]!];
    const pv = A[row]![col]!;
    for (let j = 0; j < n; j++) A[row]![j] = A[row]![j]! / pv;
    for (let i = 0; i < m; i++) if (i !== row) { const f = A[i]![col]!; if (f !== 0) for (let j = 0; j < n; j++) A[i]![j] = A[i]![j]! - f * A[row]![j]!; }
    pivots.push(col); row++;
  }
  const free = new Set<number>(); for (let c = 0; c < n; c++) if (!pivots.includes(c)) free.add(c);
  const determined = new Array<boolean>(n).fill(false);
  pivots.forEach((col, r) => { determined[col] = [...free].every((fc) => Math.abs(A[r]![fc]!) < 1e-7); });
  return { rank: pivots.length, determined };
}

/* ---------- solve ---------- */

export interface Hold { p: PointRef; at: Vec2 }

export interface SolveResult {
  status: 'solved' | 'failed';
  entities: SketchEntity[];
  /** remaining degrees of freedom (0 = fully constrained) */
  dof: number;
  /** entity ids whose every unknown is determined */
  fullyConstrained: Set<string>;
  /** worst residual after solving, mm */
  residual: number;
  /** constraint rank vs count: when rank < count some constraint is redundant */
  rank: number;
  rows: number;
}

/**
 * Solve the sketch. `hold` pins one point to a target (dragging). `scope` gives
 * parameter values for dimension expressions. On failure the entities come back
 * untouched.
 */
export function solveSketch(sketch: Sketch, opts: { hold?: Hold; scope?: Scope; maxIters?: number } = {}): SolveResult {
  const entities = sketch.entities;
  const lay = layoutOf(entities);
  const all: Constraint[] = [...implicitCoincidences(entities), ...(sketch.constraints ?? [])];
  const { residuals, owners } = compile(sketch, lay, all, opts.scope ?? {});
  const x0 = pack(entities, lay);
  const holdRes: Residual[] = [];
  if (opts.hold) {
    const byId = new Map(entities.map((e) => [e.id, e]));
    const e = byId.get(opts.hold.p.id);
    if (e) {
      const base = lay.index.get(e.id)!;
      const at = opts.hold.at;
      if (e.type === 'arc' && opts.hold.p.pt !== 'c') { const ang = opts.hold.p.pt === 'a' ? base + 3 : base + 4; holdRes.push((x, o) => o.push(x[base]! + Math.cos(x[ang]!) * x[base + 2]! - at[0], x[base + 1]! + Math.sin(x[ang]!) * x[base + 2]! - at[1])); }
      else { const [ix, iy] = pointVars(e, opts.hold.p.pt, base) as [number, number]; holdRes.push((x, o) => o.push(x[ix]! - at[0], x[iy]! - at[1])); }
    }
  }
  const F = (x: Float64Array): number[] => { const o: number[] = []; for (const r of residuals) r(x, o); return o; };
  const m = F(x0).length;
  if (m === 0 && !holdRes.length) return { status: 'solved', entities, dof: lay.n, fullyConstrained: new Set(), residual: 0, rank: 0, rows: 0 };

  // the hold is a soft, heavily weighted goal: it drives the drag but never makes the sketch fail
  const HOLD_W = 1, PRIOR_W = 1e-3;
  const Fall = (x: Float64Array): number[] => {
    const o = F(x);
    for (const r of holdRes) { const h: number[] = []; r(x, h); for (const v of h) o.push(v * HOLD_W); }
    for (let j = 0; j < x.length; j++) o.push((x[j]! - x0[j]!) * PRIOR_W);
    return o;
  };
  let x = Float64Array.from(x0);
  let lambda = 1e-3;
  let f = Fall(x);
  let cost = f.reduce((s, v) => s + v * v, 0);
  const maxIters = opts.maxIters ?? 100;
  for (let it = 0; it < maxIters; it++) {
    const worst = Math.max(0, ...f.slice(0, m + holdRes.length * 2).map(Math.abs));
    if (worst < 1e-7) break;
    const J = jacobian(Fall, x, f.length);
    const n = x.length;
    const JtJ: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const Jtf = new Array<number>(n).fill(0);
    for (let i = 0; i < f.length; i++) for (let a = 0; a < n; a++) { const ja = J[i]![a]!; if (ja === 0) continue; Jtf[a] = Jtf[a]! - ja * f[i]!; for (let b = 0; b < n; b++) JtJ[a]![b] = JtJ[a]![b]! + ja * J[i]![b]!; }
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JtJ.map((r, i) => r.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const d = cholSolve(A, Jtf);
      if (!d) { lambda *= 10; continue; }
      const xn = Float64Array.from(x); for (let j = 0; j < n; j++) xn[j] = x[j]! + d[j]!;
      const fn = Fall(xn);
      const cn = fn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) { x = xn; f = fn; cost = cn; lambda = Math.max(1e-9, lambda / 3); improved = true; break; }
      lambda *= 4;
    }
    if (!improved) break;
  }
  const finalRes = F(x);
  const residual = Math.max(0, ...finalRes.map(Math.abs));
  // a solution that collapses a line to a point or a circle to nothing is a conflict, not a solve
  let degenerate = false;
  for (const e of entities) {
    const base = lay.index.get(e.id)!;
    if (e.type === 'line') { const len0 = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); const len = Math.hypot(x[base + 2]! - x[base]!, x[base + 3]! - x[base + 1]!); if (len0 > 1e-3 && len < 1e-3) degenerate = true; }
    else if (x[base + 2]! < 1e-3) degenerate = true;
  }
  const ok = residual < 1e-4 && !degenerate;
  // rank analysis on the constraint rows alone (not the hold or the prior)
  const Jc = m ? jacobian(F, x, m) : [];
  const { rank, determined } = m ? rankAnalysis(Jc, lay.n) : { rank: 0, determined: new Array<boolean>(lay.n).fill(false) };
  const fully = new Set<string>();
  for (const e of entities) {
    const base = lay.index.get(e.id)!, cnt = e.type === 'line' ? 4 : e.type === 'circle' ? 3 : 5;
    let all = true; for (let k = 0; k < cnt; k++) if (!determined[base + k]) { all = false; break; }
    if (all) fully.add(e.id);
  }
  void owners;
  return { status: ok ? 'solved' : 'failed', entities: ok ? unpack(entities, lay, x) : entities, dof: lay.n - rank, fullyConstrained: fully, residual, rank, rows: m };
}

/**
 * Try to add a constraint: it is refused when it conflicts with the others or
 * when it is redundant (would over-constrain), as SolidCraft does.
 */
export function tryAddConstraint(sketch: Sketch, c: Constraint, scope: Scope = {}): { ok: true; sketch: Sketch; result: SolveResult } | { ok: false; reason: string } {
  const before = solveSketch(sketch, { scope });
  const next: Sketch = { ...sketch, constraints: [...(sketch.constraints ?? []), c] };
  const after = solveSketch({ ...next, entities: before.entities }, { scope });
  if (after.status === 'failed') return { ok: false, reason: "Can't add: it conflicts with the existing constraints." };
  const added = after.rows - before.rows;
  if (after.rank - before.rank < added) return { ok: false, reason: "Can't add: it would over-constrain the sketch." };
  return { ok: true, sketch: { ...next, entities: after.entities }, result: after };
}

/** Current measured value of a dimension kind on the given references (for a new dimension's default). */
export type DimensionSpec = Extract<Constraint, { value: number }> extends infer C ? (C extends Constraint ? Omit<C, 'value' | 'id' | 'expr'> : never) : never;
export function measure(sketch: Sketch, c: DimensionSpec): number | null {
  const byId = new Map(sketch.entities.map((e) => [e.id, e]));
  const pt = (r: PointRef): Vec2 | null => {
    const e = byId.get(r.id); if (!e) return null;
    if (e.type === 'line') return r.pt === 'b' ? e.b : e.a;
    if (e.type === 'circle' || r.pt === 'c') return e.center;
    const ang = (r.pt === 'a' ? e.startAngle : e.endAngle) * d2r;
    return [e.center[0] + Math.cos(ang) * e.radius, e.center[1] + Math.sin(ang) * e.radius];
  };
  switch (c.kind) {
    case 'distance': { const p = pt(c.p), q = pt(c.q); return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : null; }
    case 'distanceX': { const p = pt(c.p), q = pt(c.q); return p && q ? Math.abs(p[0] - q[0]) : null; }
    case 'distanceY': { const p = pt(c.p), q = pt(c.q); return p && q ? Math.abs(p[1] - q[1]) : null; }
    case 'length': { const e = byId.get(c.l); return e?.type === 'line' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) : null; }
    case 'radius': { const e = byId.get(c.c); return e && e.type !== 'line' ? e.radius : null; }
    case 'diameter': { const e = byId.get(c.c); return e && e.type !== 'line' ? e.radius * 2 : null; }
    case 'angle': {
      const a = byId.get(c.a), b = byId.get(c.b); if (a?.type !== 'line' || b?.type !== 'line') return null;
      const u = [a.b[0] - a.a[0], a.b[1] - a.a[1]], v = [b.b[0] - b.a[0], b.b[1] - b.a[1]];
      return Math.atan2(u[0]! * v[1]! - u[1]! * v[0]!, u[0]! * v[0]! + u[1]! * v[1]!) / d2r;
    }
  }
}

/** Drop constraints that refer to entities no longer in the sketch. */
export function pruneConstraints(sketch: Sketch): Sketch {
  const ids = new Set(sketch.entities.map((e) => e.id));
  const refs = (c: Constraint): string[] => {
    switch (c.kind) {
      case 'coincident': case 'distance': case 'distanceX': case 'distanceY': return [c.p.id, c.q.id];
      case 'pointOnCurve': return [c.p.id, c.c];
      case 'horizontal': case 'vertical': case 'length': return [c.l];
      case 'midpoint': return [c.p.id, c.l];
      case 'fix': return [c.p.id];
      case 'radius': case 'diameter': return [c.c];
      default: return [c.a, c.b];
    }
  };
  const kept = (sketch.constraints ?? []).filter((c) => refs(c).every((id) => ids.has(id)));
  return kept.length === (sketch.constraints ?? []).length ? sketch : { ...sketch, constraints: kept };
}

/** Entities a constraint is attached to, for highlighting and pruning. */
export function constraintRefs(c: Constraint): string[] {
  switch (c.kind) {
    case 'coincident': case 'distance': case 'distanceX': case 'distanceY': return [c.p.id, c.q.id];
    case 'pointOnCurve': return [c.p.id, c.c];
    case 'horizontal': case 'vertical': case 'length': return [c.l];
    case 'midpoint': return [c.p.id, c.l];
    case 'fix': return [c.p.id];
    case 'radius': case 'diameter': return [c.c];
    default: return [c.a, c.b];
  }
}
export { WELD };
