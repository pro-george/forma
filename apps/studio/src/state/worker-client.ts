import * as Comlink from 'comlink';
import type { FormaDocument } from '@forma/core';
import type { EvaluatorWorkerApi, EvalResult, ModuleInfo, ExportFormat } from '../worker/evaluator.worker';
export type { ExportFormat };

/**
 * Talks to the geometry worker. Evaluations are coalesced: while one is in
 * flight, only the newest requested document is kept, so dragging a slider
 * never queues up stale work.
 */
class WorkerClient {
  private remote!: Comlink.Remote<EvaluatorWorkerApi>;
  private ready!: Promise<{ modules: ModuleInfo[] }>;
  private inflight: Promise<void> | null = null;
  private pending: FormaDocument | null = null;
  private listeners = new Set<(r: EvalResult, doc: FormaDocument) => void>();
  private errorListeners = new Set<(e: Error, doc: FormaDocument) => void>();

  onError(fn: (e: Error, doc: FormaDocument) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  private worker!: Worker;
  private restarts = 0;

  constructor() {
    this.spawn();
  }

  /** Device profile: phones and low-memory machines get coarser previews and a smaller cache. */
  private static profile() {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const small = matchMedia('(max-width: 720px)').matches || matchMedia('(pointer: coarse)').matches || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
    return small ? { coarseness: 1.6, cacheBytes: 48 * 1024 * 1024 } : { coarseness: 1, cacheBytes: 160 * 1024 * 1024 };
  }

  private spawn() {
    this.worker = new Worker(new URL('../worker/evaluator.worker.ts', import.meta.url), { type: 'module', name: 'forma-geometry' });
    this.remote = Comlink.wrap<EvaluatorWorkerApi>(this.worker);
    this.ready = this.remote.init(WorkerClient.profile());
    // a worker that dies (out of memory, WASM abort) is replaced and the latest document re-evaluated
    this.worker.onerror = (e) => { console.error('geometry worker error', e); this.restart(); };
  }

  private restart() {
    if (this.restarts++ > 3) return;
    try { this.worker.terminate(); } catch { /* already gone */ }
    const doc = this.pending ?? this.lastDoc;
    this.inflight = null;
    this.spawn();
    this.ready.then(() => { for (const l of this.errorListeners) l(new Error('The geometry engine restarted (it ran out of memory). Try Preview detail for big parts.'), doc ?? ({} as FormaDocument)); });
    if (doc) this.evaluate(doc);
  }

  private lastDoc: FormaDocument | null = null;

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
      this.lastDoc = doc;
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
  exportModel(doc: FormaDocument, format: ExportFormat, ids?: string[]) { return this.remote.exportModel(doc, format, ids); }
}

export const workerClient = new WorkerClient();
export type { ModuleInfo, EvalResult };
