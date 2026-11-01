/**
 * Unit-aware expressions for dimensions and parameters (after SolidCraft's
 * `doc::expr`): numbers with units (`2 * width + 5 mm`, `1.5 in`), the four
 * operations, `^`, parentheses, a few functions, and names that refer to the
 * document's parameters. Lengths come out in mm, angles in degrees, plain
 * numbers as they are.
 */
export interface Param { name: string; expr: string; /** evaluated value, mm / ° / plain */ value?: number; /** what the expression measures */ kind?: 'length' | 'angle' | 'number' }

export type Scope = Record<string, number>;

const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, '"': 25.4, ft: 304.8, deg: 1, '°': 1, rad: 180 / Math.PI };
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: (a) => Math.sin((a * Math.PI) / 180), cos: (a) => Math.cos((a * Math.PI) / 180), tan: (a) => Math.tan((a * Math.PI) / 180),
  asin: (a) => (Math.asin(a) * 180) / Math.PI, acos: (a) => (Math.acos(a) * 180) / Math.PI, atan: (a) => (Math.atan(a) * 180) / Math.PI,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max,
};

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { const m = /^[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?|^[0-9]+\.?/i.exec(src.slice(i))!; out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if (/[A-Za-z_°"]/.test(c)) { const m = /^[A-Za-z_°"][A-Za-z0-9_]*/.exec(src.slice(i))!; out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}" in "${src}"`);
  }
  return out;
}

/** Evaluate `src` against `scope` (parameter values). Throws with a readable message on bad input or unknown names. */
export function evalExpr(src: string, scope: Scope = {}): number {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++]!;
  const expr = (): number => {
    let v = term();
    for (;;) { const t = peek(); if (t?.t === 'op' && (t.v === '+' || t.v === '-')) { take(); const r = term(); v = t.v === '+' ? v + r : v - r; } else return v; }
  };
  const term = (): number => {
    let v = power();
    for (;;) { const t = peek(); if (t?.t === 'op' && (t.v === '*' || t.v === '/')) { take(); const r = power(); if (t.v === '/' && r === 0) throw new Error('Division by zero'); v = t.v === '*' ? v * r : v / r; } else return v; }
  };
  const power = (): number => { const b = unary(); const t = peek(); if (t?.t === 'op' && t.v === '^') { take(); return Math.pow(b, power()); } return b; };
  const unary = (): number => { const t = peek(); if (t?.t === 'op' && t.v === '-') { take(); return -unary(); } if (t?.t === 'op' && t.v === '+') { take(); return unary(); } return atom(); };
  const atom = (): number => {
    const t = take();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.t === 'num') { const u = peek(); if (u?.t === 'id' && UNITS[u.v] !== undefined && !(u.v in scope)) { take(); return t.v * UNITS[u.v]!; } return t.v; }
    if (t.t === 'id') {
      const nxt = peek();
      if (nxt?.t === 'op' && nxt.v === '(') {
        take(); const args: number[] = [];
        if (!(peek()?.t === 'op' && (peek() as Tok & { v: string }).v === ')')) { args.push(expr()); while (peek()?.t === 'op' && (peek() as { v: string }).v === ',') { take(); args.push(expr()); } }
        const close = take(); if (!close || close.t !== 'op' || close.v !== ')') throw new Error('Missing ")"');
        const f = FUNCS[t.v]; if (!f) throw new Error(`Unknown function ${t.v}`);
        return f(...args);
      }
      if (t.v in scope) return scope[t.v]!;
      if (UNITS[t.v] !== undefined) return UNITS[t.v]!;
      throw new Error(`Unknown parameter "${t.v}"`);
    }
    if (t.v === '(') { const v = expr(); const close = take(); if (!close || close.t !== 'op' || close.v !== ')') throw new Error('Missing ")"'); return v; }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const v = expr();
  if (p < toks.length) throw new Error(`Unexpected "${(toks[p] as { v: string | number }).v}"`);
  if (!Number.isFinite(v)) throw new Error('Not a number');
  return v;
}

/** Names an expression refers to (parameters, not units or functions). */
export function exprRefs(src: string): string[] {
  try { return [...new Set(lex(src).filter((t): t is { t: 'id'; v: string } => t.t === 'id' && UNITS[t.v] === undefined && FUNCS[t.v] === undefined).map((t) => t.v))]; } catch { return []; }
}

/** Resolve every parameter in dependency order. Unresolvable ones (cycles, errors) get `error`. */
export function evalParams(params: Param[]): { scope: Scope; errors: Record<string, string> } {
  const scope: Scope = {};
  const errors: Record<string, string> = {};
  const pending = new Map(params.map((p) => [p.name, p.expr]));
  for (let pass = 0; pass < params.length + 1 && pending.size; pass++) {
    let progressed = false;
    for (const [name, src] of [...pending]) {
      const refs = exprRefs(src);
      if (refs.some((r) => pending.has(r) && r !== name)) continue;
      try { scope[name] = evalExpr(src, scope); } catch (e) { errors[name] = (e as Error).message; }
      pending.delete(name); progressed = true;
    }
    if (!progressed) break;
  }
  for (const name of pending.keys()) errors[name] = 'Circular reference';
  return { scope, errors };
}

/** A valid parameter name: letters, digits and underscores, not starting with a digit, not a unit or function. */
export function isParamName(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && UNITS[s] === undefined && FUNCS[s] === undefined;
}
