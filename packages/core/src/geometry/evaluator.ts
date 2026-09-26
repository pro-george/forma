/**
 * Evaluates a document into render-ready meshes with a content-addressed cache.
 *
 * Top-level features are evaluated in their authoring frame; the renderer
 * applies the transform, so moving a part never recomputes geometry. Inside a
 * combine, children are placed with their transforms before the booleans.
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { EvaluatedFeature, Feature, FormaDocument, TriangleMesh, Vec3 } from '../document/types.js';
import { childrenOf, featureById, topLevel } from '../document/document.js';
import { ModuleRegistry, resolveInputs, specsToFeatures } from '../modules/registry.js';
import type { ModuleApi } from '../modules/api.js';
import { BuildError, buildPrimitive, placed } from './build.js';
import { dispose } from './manifold.js';

interface CacheEntry { mesh: TriangleMesh; volume: number; bbox: { min: Vec3; max: Vec3 }; }

export interface EvaluatorOptions {
  registry: ModuleRegistry;
  api: ModuleApi;
  /** sharp-edge threshold for smooth normals, degrees */
  sharpAngle?: number;
  cacheSize?: number;
}

export class Evaluator {
  private cache = new Map<string, CacheEntry>();
  private readonly sharpAngle: number;
  private readonly cacheSize: number;

  constructor(private readonly wasm: ManifoldToplevel, private readonly opts: EvaluatorOptions) {
    this.sharpAngle = opts.sharpAngle ?? 32;
    this.cacheSize = opts.cacheSize ?? 400;
  }

  /** Evaluate all visible top-level features. Errors are reported per feature, never thrown. */
  evaluate(doc: FormaDocument): EvaluatedFeature[] {
    const out: EvaluatedFeature[] = [];
    for (const f of topLevel(doc)) {
      if (!f.visible) continue;
      const t0 = performance.now();
      try {
        const entry = this.entryFor(doc, f);
        out.push({ id: f.id, mesh: entry.mesh, volume: f.role === 'hole' ? 0 : entry.volume, bbox: entry.bbox, role: f.role, ms: performance.now() - t0 });
      } catch (e) {
        out.push({ id: f.id, mesh: emptyMesh(), volume: 0, bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, role: f.role, ms: performance.now() - t0, error: (e as Error).message });
      }
    }
    return out;
  }

  /** Geometry cache key: everything that changes the authored shape (not name/visibility/top-level placement). */
  keyFor(doc: FormaDocument, f: Feature): string {
    const { id: _id, name: _n, visible: _v, transform: _t, parentId: _p, ...rest } = f;
    if (f.type === 'combine') {
      const kids = childrenOf(doc, f.id).map((k) => [this.keyFor(doc, k), k.transform, k.role, k.visible]);
      return JSON.stringify(['combine', kids]);
    }
    if (f.type === 'mesh') return JSON.stringify(['mesh', f.positions.length, f.scale, f.modifiers, hashNumbers(f.positions)]);
    return JSON.stringify(rest);
  }

  private entryFor(doc: FormaDocument, f: Feature): CacheEntry {
    const key = this.keyFor(doc, f);
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; }
    const m = this.manifoldFor(doc, f);
    try {
      const entry = this.toEntry(m);
      this.cache.set(key, entry);
      if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value as string);
      return entry;
    } finally { dispose(m); }
  }

  /** Build a Manifold for a feature in its authoring frame. Caller must delete it. */
  manifoldFor(doc: FormaDocument, f: Feature): Manifold {
    switch (f.type) {
      case 'combine': return this.combineManifold(childrenOf(doc, f.id), doc, f.id);
      case 'module': return this.moduleManifold(f);
      default: return buildPrimitive(this.wasm, f);
    }
  }

  private combineManifold(children: Feature[], doc: FormaDocument, ownerId: string): Manifold {
    const { Manifold } = this.wasm;
    const solids: Manifold[] = [], holes: Manifold[] = [];
    try {
      for (const c of children) {
        if (!c.visible) continue;
        const local = this.manifoldFor(doc, c);
        const world = placed(local, c);
        dispose(local);
        (c.role === 'hole' ? holes : solids).push(world);
      }
      if (solids.length === 0) throw new BuildError('A combine needs at least one visible solid', ownerId);
      let acc = solids.length === 1 ? solids[0]!.translate([0, 0, 0]) : Manifold.union(solids);
      if (holes.length) {
        const cut = Manifold.difference([acc, ...holes]);
        dispose(acc);
        acc = cut;
      }
      if (acc.isEmpty()) throw new BuildError('The holes removed everything', ownerId);
      return acc;
    } finally { dispose(...solids, ...holes); }
  }

  private moduleManifold(f: Extract<Feature, { type: 'module' }>): Manifold {
    const def = this.opts.registry.get(f.moduleId);
    if (!def) throw new BuildError(`Unknown module "${f.moduleId}"`, f.id);
    const inputs = resolveInputs(def, f.inputs);
    let specs;
    try { specs = def.build(inputs, this.opts.api); } catch (e) { throw new BuildError(`Module error: ${(e as Error).message}`, f.id); }
    const feats = specsToFeatures(specs, f.id);
    if (feats.length === 0) throw new BuildError('Module produced no parts', f.id);
    const tmpDoc: FormaDocument = { version: 1, name: '', units: 'mm', features: feats };
    return this.combineManifold(feats, tmpDoc, f.id);
  }

  /** Union of every visible top-level solid, placed in world space. For export. Caller deletes. */
  worldManifold(doc: FormaDocument, ids?: string[]): Manifold {
    const parts: Manifold[] = [];
    try {
      for (const f of topLevel(doc)) {
        if (!f.visible || f.role !== 'solid') continue;
        if (ids && !ids.includes(f.id)) continue;
        const local = this.manifoldFor(doc, f);
        parts.push(placed(local, f));
        dispose(local);
      }
      if (parts.length === 0) throw new Error('Nothing to export');
      return parts.length === 1 ? parts[0]!.translate([0, 0, 0]) : this.wasm.Manifold.union(parts);
    } finally { dispose(...parts); }
  }

  private toEntry(m: Manifold): CacheEntry {
    const withNormals = m.calculateNormals(0, this.sharpAngle);
    try {
      const mesh = withNormals.getMesh();
      const np = mesh.numProp;
      const n = mesh.vertProperties.length / np;
      const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        positions[i * 3] = mesh.vertProperties[i * np]!;
        positions[i * 3 + 1] = mesh.vertProperties[i * np + 1]!;
        positions[i * 3 + 2] = mesh.vertProperties[i * np + 2]!;
        if (np >= 6) {
          normals[i * 3] = mesh.vertProperties[i * np + 3]!;
          normals[i * 3 + 1] = mesh.vertProperties[i * np + 4]!;
          normals[i * 3 + 2] = mesh.vertProperties[i * np + 5]!;
        }
      }
      const box = withNormals.boundingBox();
      return {
        mesh: { positions, normals, indices: new Uint32Array(mesh.triVerts) },
        volume: withNormals.volume(),
        bbox: { min: { x: box.min[0], y: box.min[1], z: box.min[2] }, max: { x: box.max[0], y: box.max[1], z: box.max[2] } },
      };
    } finally { dispose(withNormals); }
  }

  clearCache(): void { this.cache.clear(); }

  /** Expand a module feature into concrete features placed in world space (for baking). */
  bakeModule(doc: FormaDocument, moduleFeatureId: string): Feature[] {
    const f = featureById(doc, moduleFeatureId);
    if (!f || f.type !== 'module') throw new Error('Not a module feature');
    const def = this.opts.registry.get(f.moduleId);
    if (!def) throw new Error(`Unknown module "${f.moduleId}"`);
    const specs = def.build(resolveInputs(def, f.inputs), this.opts.api);
    return specsToFeatures(specs, f.id);
  }
}

export function emptyMesh(): TriangleMesh {
  return { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) };
}

function hashNumbers(a: number[]): number {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(a.length / 4096));
  for (let i = 0; i < a.length; i += step) { h ^= Math.round(a[i]! * 1000) | 0; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
