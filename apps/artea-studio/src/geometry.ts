import * as Comlink from 'comlink';
import type { LampWorkerApi, LampMesh } from './worker/lamp.worker';

/**
 * Talks to the geometry worker. Builds are coalesced: while one runs, only the
 * newest request is kept, so dragging a slider never queues stale work.
 */
class Geometry {
  private remote: Comlink.Remote<LampWorkerApi>;
  readonly ready: Promise<void>;
  private running = false;
  private pending: Record<string, string | number> | null = null;
  private listener: ((m: LampMesh) => void) | null = null;

  constructor() {
    const worker = new Worker(new URL('./worker/lamp.worker.ts', import.meta.url), { type: 'module', name: 'artea-geometry' });
    this.remote = Comlink.wrap<LampWorkerApi>(worker);
    this.ready = this.remote.init();
  }

  onMesh(fn: (m: LampMesh) => void) { this.listener = fn; }

  request(inputs: Record<string, string | number>) {
    this.pending = inputs;
    if (!this.running) void this.drain();
  }

  private async drain() {
    this.running = true;
    await this.ready;
    while (this.pending) {
      const inputs = this.pending;
      this.pending = null;
      try { this.listener?.(await this.remote.build(inputs)); } catch (e) { console.error('lamp build failed', e); }
    }
    this.running = false;
  }

  async exportModel(inputs: Record<string, string | number>, format: 'stl' | '3mf', name: string) {
    await this.ready;
    return this.remote.exportModel(inputs, format, name);
  }
}

export const geometry = new Geometry();
export type { LampMesh };
