import * as Comlink from 'comlink';
import type { FormaDocument } from '@forma/core';
import type { EvaluatorWorkerApi, EvalResult, ModuleInfo } from '../worker/evaluator.worker';

/**
 * Talks to the geometry worker. Evaluations are coalesced: while one is in
 * flight, only the newest requested document is kept, so dragging a slider
 * never queues up stale work.
 */
class WorkerClient {
  private remote: Comlink.Remote<EvaluatorWorkerApi>;
  private ready: Promise<{ modules: ModuleInfo[] }>;
  private inflight: Promise<void> | null = null;
  private pending: FormaDocument | null = null;
  private listeners = new Set<(r: EvalResult, doc: FormaDocument) => void>();
  private errorListeners = new Set<(e: Error, doc: FormaDocument) => void>();

  onError(fn: (e: Error, doc: FormaDocument) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  constructor() {
    const worker = new Worker(new URL('../worker/evaluator.worker.ts', import.meta.url), { type: 'module', name: 'forma-geometry' });
    this.remote = Comlink.wrap<EvaluatorWorkerApi>(worker);
    this.ready = this.remote.init();
  }

  whenReady() { return this.ready; }

  onResult(fn: (r: EvalResult, doc: FormaDocument) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Request an evaluation of `doc`; resolves when the *latest* requested doc has been evaluated. */
  evaluate(doc: FormaDocument): void {
    this.pending = doc;
    if (this.inflight) return;
    this.inflight = this.drain();
  }

  private async drain(): Promise<void> {
    await this.ready;
    while (this.pending) {
      const doc = this.pending;
      this.pending = null;
      try {
        const res = await this.remote.evaluate(doc);
        for (const l of this.listeners) l(res, doc);
      } catch (e) {
        console.error('evaluation failed', e);
        for (const l of this.errorListeners) l(e as Error, doc);
      }
    }
    this.inflight = null;
  }

  bake(doc: FormaDocument, id: string) { return this.remote.bake(doc, id); }
  exportModel(doc: FormaDocument, format: 'stl' | '3mf', ids?: string[]) { return this.remote.exportModel(doc, format, ids); }
}

export const workerClient = new WorkerClient();
export type { ModuleInfo, EvalResult };
