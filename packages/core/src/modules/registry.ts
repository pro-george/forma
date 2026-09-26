/**
 * Module SDK. A module is a generator: a schema of inputs plus a build()
 * that returns feature specs. Forma evaluates modules live and can bake
 * them into ordinary features.
 */
import type { Feature, FeatureOf, FeatureType, Role, Transform, Vec2, Profile, Modifiers } from '../document/types.js';
import { identityTransform, defaultModifiers } from '../document/types.js';
import type { ModuleApi } from './api.js';

export type ModuleInput =
  | { key: string; type: 'text'; label: string; default: string; placeholder?: string; help?: string }
  | { key: string; type: 'number'; label: string; default: number; min: number; max: number; step: number; unit?: string; help?: string }
  | { key: string; type: 'select'; label: string; default: string; options: { value: string; label: string }[]; help?: string }
  | { key: string; type: 'toggle'; label: string; default: boolean; help?: string }
  | { key: string; type: 'color'; label: string; default: string; help?: string };

export type ModuleInputValues = Record<string, string | number | boolean>;

/** What build() returns: a feature without bookkeeping fields. */
export type FeatureSpec = {
  [T in Exclude<FeatureType, 'combine' | 'module'>]: Omit<FeatureOf<T>, 'id' | 'parentId' | 'name' | 'role' | 'visible' | 'transform' | 'modifiers'> & {
    name?: string;
    role?: Role;
    transform?: Partial<Transform>;
    position?: Partial<Transform['position']>;
    rotation?: Partial<Transform['rotation']>;
    modifiers?: Partial<Modifiers>;
  };
}[Exclude<FeatureType, 'combine' | 'module'>];

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  /** short category shown in the palette, e.g. "Keychains" */
  category?: string;
  version?: string;
  inputs: ModuleInput[];
  /**
   * Produce the parts. Solids are unioned and holes subtracted, in order.
   * Must be deterministic: same inputs → same output (results are cached).
   */
  build: (inputs: ModuleInputValues, api: ModuleApi) => FeatureSpec[];
}

export class ModuleRegistry {
  private defs = new Map<string, ModuleDefinition>();
  register(def: ModuleDefinition): this {
    validateDefinition(def);
    this.defs.set(def.id, def);
    return this;
  }
  get(id: string): ModuleDefinition | undefined { return this.defs.get(id); }
  list(): ModuleDefinition[] { return [...this.defs.values()]; }
  has(id: string): boolean { return this.defs.has(id); }
}

function validateDefinition(def: ModuleDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(def.id)) throw new Error(`Module id "${def.id}" must be kebab-case`);
  const keys = new Set<string>();
  for (const inp of def.inputs) {
    if (keys.has(inp.key)) throw new Error(`Module ${def.id}: duplicate input key ${inp.key}`);
    keys.add(inp.key);
  }
  if (typeof def.build !== 'function') throw new Error(`Module ${def.id}: build must be a function`);
}

/** Merge stored values with schema defaults and clamp numbers. */
export function resolveInputs(def: ModuleDefinition, stored: Record<string, unknown>): ModuleInputValues {
  const out: ModuleInputValues = {};
  for (const inp of def.inputs) {
    const v = stored[inp.key];
    switch (inp.type) {
      case 'number': {
        const n = typeof v === 'number' && Number.isFinite(v) ? v : inp.default;
        out[inp.key] = Math.min(inp.max, Math.max(inp.min, n));
        break;
      }
      case 'toggle': out[inp.key] = typeof v === 'boolean' ? v : inp.default; break;
      case 'select': out[inp.key] = typeof v === 'string' && inp.options.some((o) => o.value === v) ? v : inp.default; break;
      default: out[inp.key] = typeof v === 'string' ? v : inp.default;
    }
  }
  return out;
}

/** Turn specs into full features (ids are synthetic; used for evaluation or baking). */
export function specsToFeatures(specs: FeatureSpec[], idPrefix = 'm'): Feature[] {
  return specs.map((s, i) => {
    const { name, role, visible, transform, position, rotation, modifiers, ...rest } = s as FeatureSpec & { visible?: boolean };
    const t: Transform = { ...identityTransform(), ...(transform ?? {}) };
    if (position) t.position = { ...t.position, ...position };
    if (rotation) t.rotation = { ...t.rotation, ...rotation };
    const f = {
      id: `${idPrefix}_${i}`,
      name: name ?? rest.type,
      role: role ?? 'solid',
      visible: visible ?? true,
      transform: t,
      parentId: null,
      modifiers: { ...defaultModifiers(), ...(modifiers ?? {}) },
      ...rest,
    } as Feature;
    return f;
  });
}

export type { Vec2, Profile };
