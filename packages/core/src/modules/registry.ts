/**
 * Module SDK. A module is a generator: a schema of inputs plus a build()
 * that returns feature specs. Forma evaluates modules live and can bake
 * them into ordinary features.
 */
import type { Feature, FeatureOf, FeatureType, Role, Transform, Vec2, Profile, Modifiers } from '../document/types.js';
import { identityTransform, defaultModifiers } from '../document/types.js';
import type { ModuleApi } from './api.js';

interface InputBase {
  key: string;
  label: string;
  help?: string;
  /** inputs with the same group are shown under one sub-heading, in order of first appearance */
  group?: string;
  /** hide this input unless another input has one of the given values, e.g. { shape: ['custom'] } */
  showWhen?: Record<string, (string | number | boolean)[]>;
}
export type ModuleInput =
  | (InputBase & { type: 'text'; default: string; placeholder?: string })
  | (InputBase & { type: 'number'; default: number; min: number; max: number; step: number; unit?: string })
  | (InputBase & { type: 'select'; default: string; options: { value: string; label: string }[] })
  | (InputBase & { type: 'toggle'; default: boolean })
  | (InputBase & { type: 'color'; default: string })
  /** an uploaded picture, stored as an encoded height map (see raster/heightmap.ts); '' = none */
  | (InputBase & { type: 'image'; default: string })
  /** a side profile as JSON [[radius mm, height 0..1], …]; edited with the profile editor */
  | (InputBase & { type: 'profile'; default: string });

/** Whether an input is currently shown, given the other input values. */
export function inputVisible(inp: ModuleInput, values: Record<string, unknown>): boolean {
  if (!inp.showWhen) return true;
  return Object.entries(inp.showWhen).every(([k, allowed]) => allowed.includes(values[k] as string | number | boolean));
}

export type ModuleInputValues = Record<string, string | number | boolean>;

/** What build() returns: a feature without bookkeeping fields. */
export type FeatureSpec = {
  [T in Exclude<FeatureType, 'combine' | 'module'>]: Omit<FeatureOf<T>, 'id' | 'parentId' | 'name' | 'role' | 'visible' | 'transform' | 'modifiers' | 'flip'> & {
    name?: string;
    /** extrude only: build towards -Z */
    flip?: boolean;
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
  /** Optional printability check; returned strings are shown as warnings next to the inputs. */
  check?: (inputs: ModuleInputValues) => string[];
  /** Short printing instructions (slicer settings etc.) shown with the module. */
  printNotes?: string;
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
    const { name, role, visible, transform, position, rotation, modifiers, flip, ...rest } = s as FeatureSpec & { visible?: boolean };
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
      ...(rest.type === 'extrude' ? { flip: flip ?? false } : {}),
      ...rest,
    } as Feature;
    return f;
  });
}

export type { Vec2, Profile };
