/// <reference lib="webworker" />
/**
 * Geometry worker: builds the lampshade with Manifold off the UI thread.
 */
import * as Comlink from 'comlink';
import {
  initManifold, Evaluator, createDefaultRegistry, createModuleApi, createDocument, addFeature, makeFeature,
  toBinarySTL, to3MF, type FormaDocument, type TriangleMesh,
} from '@forma/core';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

export interface LampMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** cm³ of material */
  volumeCm3: number;
  height: number;
  /** radius at the bottom edge, mm (legs attach here) */
  bottomRadius: number;
  ms: number;
  error?: string;
}

let evaluator: Evaluator | null = null;

function docFor(inputs: Record<string, string | number>): FormaDocument {
  const doc = createDocument();
  return addFeature(doc, makeFeature(doc, 'module', { moduleId: 'artea-lamp', inputs, name: 'Lampă Artea' }));
}

function plainMesh(doc: FormaDocument): TriangleMesh {
  const m = evaluator!.worldManifold(doc);
  try {
    const mesh = m.getMesh();
    const np = mesh.numProp, n = mesh.vertProperties.length / np;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = mesh.vertProperties[i * np]!;
      positions[i * 3 + 1] = mesh.vertProperties[i * np + 1]!;
      positions[i * 3 + 2] = mesh.vertProperties[i * np + 2]!;
    }
    return { positions, normals: new Float32Array(0), indices: new Uint32Array(mesh.triVerts) };
  } finally { m.delete(); }
}

const api = {
  async init(): Promise<void> {
    const wasm = await initManifold({ wasmUrl });
    evaluator = new Evaluator(wasm, { registry: createDefaultRegistry(), api: createModuleApi(null), cacheSize: 60 });
  },

  build(inputs: Record<string, string | number>): LampMesh {
    if (!evaluator) throw new Error('worker not initialised');
    const t0 = performance.now();
    const [r] = evaluator.evaluate(docFor(inputs));
    const positions = r!.mesh.positions.slice(), normals = r!.mesh.normals.slice(), indices = r!.mesh.indices.slice();
    let bottomRadius = 0;
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i + 2]! < 4) bottomRadius = Math.max(bottomRadius, Math.hypot(positions[i]!, positions[i + 1]!));
    }
    const out: LampMesh = {
      positions, normals, indices, volumeCm3: r!.volume / 1000, height: r!.bbox.max.z, bottomRadius,
      ms: performance.now() - t0, ...(r!.error ? { error: r!.error } : {}),
    };
    return Comlink.transfer(out, [positions.buffer as ArrayBuffer, normals.buffer as ArrayBuffer, indices.buffer as ArrayBuffer]);
  },

  exportModel(inputs: Record<string, string | number>, format: 'stl' | '3mf', name: string): Uint8Array {
    if (!evaluator) throw new Error('worker not initialised');
    const mesh = plainMesh(docFor(inputs));
    const bytes = format === 'stl' ? toBinarySTL([mesh]) : to3MF([{ name, mesh }], name);
    return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },
};

export type LampWorkerApi = typeof api;
Comlink.expose(api);
