/**
 * Manifold WASM bootstrap. One instance per thread (main or worker).
 */
import Module from 'manifold-3d';
import type { ManifoldToplevel, Manifold, CrossSection, Mesh } from 'manifold-3d';

export type { ManifoldToplevel, Manifold, CrossSection, Mesh };

let instance: Promise<ManifoldToplevel> | null = null;

export interface ManifoldInitOptions {
  /** URL of manifold.wasm when bundlers need it (Vite: `new URL('manifold-3d/manifold.wasm', import.meta.url)`) */
  wasmUrl?: string;
}

export function initManifold(opts: ManifoldInitOptions = {}): Promise<ManifoldToplevel> {
  if (!instance) {
    const moduleArgs: Record<string, unknown> = {};
    if (opts.wasmUrl) moduleArgs.locateFile = () => opts.wasmUrl;
    instance = (Module as unknown as (args?: Record<string, unknown>) => Promise<ManifoldToplevel>)(moduleArgs).then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return instance;
}

/** Dispose a list of manifold-owned objects, ignoring ones already deleted. */
export function dispose(...objs: Array<{ delete(): void } | null | undefined>): void {
  for (const o of objs) {
    try { o?.delete(); } catch { /* already freed */ }
  }
}
