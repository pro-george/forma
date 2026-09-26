/// <reference lib="webworker" />
/**
 * Geometry worker: owns the Manifold instance so the UI thread never blocks.
 * Exposed through comlink; meshes are transferred, not copied.
 */
import * as Comlink from 'comlink';
import {
  initManifold, Evaluator, createDefaultRegistry, createModuleApi, canvasTextRasterizer,
  toBinarySTL, to3MF, topLevel, featureById,
  type FormaDocument, type EvaluatedFeature, type ModuleDefinition, type Feature, type TriangleMesh,
} from '@forma/core';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import plexSans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url';
import plexSans700 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2?url';
import plexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import plexMono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url';

export type ModuleInfo = Pick<ModuleDefinition, 'id' | 'name' | 'description' | 'category' | 'inputs' | 'version'> & { source: string };

export interface EvalResult {
  features: EvaluatedFeature[];
  totalMs: number;
}

const registry = createDefaultRegistry();
let evaluator: Evaluator | null = null;

async function loadFonts() {
  const fonts = self.fonts as FontFaceSet | undefined;
  if (!fonts) return;
  const faces = [
    new FontFace('IBM Plex Sans', `url(${plexSans400})`, { weight: '400' }),
    new FontFace('IBM Plex Sans', `url(${plexSans700})`, { weight: '700' }),
    new FontFace('IBM Plex Mono', `url(${plexMono400})`, { weight: '400' }),
    new FontFace('IBM Plex Mono', `url(${plexMono500})`, { weight: '500' }),
  ];
  await Promise.all(faces.map(async (f) => { try { await f.load(); fonts.add(f); } catch { /* fall back to system fonts */ } }));
}

const api = {
  async init(): Promise<{ modules: ModuleInfo[] }> {
    const [wasm] = await Promise.all([initManifold({ wasmUrl }), loadFonts()]);
    const rasterizer = typeof OffscreenCanvas !== 'undefined'
      ? canvasTextRasterizer((w, h) => new OffscreenCanvas(w, h) as unknown as { getContext(id: '2d'): OffscreenCanvasRenderingContext2D | null; width: number; height: number })
      : null;
    evaluator = new Evaluator(wasm, { registry, api: createModuleApi(rasterizer) });
    return { modules: api.listModules() };
  },

  listModules(): ModuleInfo[] {
    return registry.list().map((m) => ({ id: m.id, name: m.name, description: m.description, category: m.category, inputs: m.inputs, version: m.version, source: m.build.toString() }));
  },

  evaluate(doc: FormaDocument): EvalResult {
    if (!evaluator) throw new Error('worker not initialised');
    const t0 = performance.now();
    // Copy before transferring: the evaluator caches these meshes, and a
    // transferred buffer is detached on this side.
    const features = evaluator.evaluate(doc).map((f) => ({ ...f, mesh: { positions: f.mesh.positions.slice(), normals: f.mesh.normals.slice(), indices: f.mesh.indices.slice() } }));
    const transfer: ArrayBuffer[] = [];
    for (const f of features) transfer.push(f.mesh.positions.buffer as ArrayBuffer, f.mesh.normals.buffer as ArrayBuffer, f.mesh.indices.buffer as ArrayBuffer);
    return Comlink.transfer({ features, totalMs: performance.now() - t0 }, transfer);
  },

  bake(doc: FormaDocument, moduleFeatureId: string): Feature[] {
    if (!evaluator) throw new Error('worker not initialised');
    return evaluator.bakeModule(doc, moduleFeatureId);
  },

  /** Export as one unioned watertight shell (STL) or one object per part (3MF). */
  exportModel(doc: FormaDocument, format: 'stl' | '3mf', ids?: string[]): Uint8Array {
    if (!evaluator) throw new Error('worker not initialised');
    if (format === 'stl') {
      const m = evaluator.worldManifold(doc, ids);
      try {
        const mesh = m.getMesh();
        const np = mesh.numProp;
        const n = mesh.vertProperties.length / np;
        const positions = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { positions[i * 3] = mesh.vertProperties[i * np]!; positions[i * 3 + 1] = mesh.vertProperties[i * np + 1]!; positions[i * 3 + 2] = mesh.vertProperties[i * np + 2]!; }
        const tri: TriangleMesh = { positions, normals: new Float32Array(0), indices: new Uint32Array(mesh.triVerts) };
        const bytes = toBinarySTL([tri]);
        return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
      } finally { m.delete(); }
    }
    const objects: { name: string; mesh: TriangleMesh }[] = [];
    for (const f of topLevel(doc)) {
      if (!f.visible || f.role !== 'solid') continue;
      if (ids && !ids.includes(f.id)) continue;
      const m = evaluator.worldManifold(doc, [f.id]);
      try {
        const mesh = m.getMesh();
        const np = mesh.numProp, n = mesh.vertProperties.length / np;
        const positions = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { positions[i * 3] = mesh.vertProperties[i * np]!; positions[i * 3 + 1] = mesh.vertProperties[i * np + 1]!; positions[i * 3 + 2] = mesh.vertProperties[i * np + 2]!; }
        objects.push({ name: featureById(doc, f.id)?.name ?? f.id, mesh: { positions, normals: new Float32Array(0), indices: new Uint32Array(mesh.triVerts) } });
      } finally { m.delete(); }
    }
    const bytes = to3MF(objects, doc.name);
    return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },
};

export type EvaluatorWorkerApi = typeof api;
Comlink.expose(api);
