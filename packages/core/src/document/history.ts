import type { FormaDocument } from './types.js';

/**
 * Snapshot-based undo/redo. Documents are immutable and share structure,
 * so keeping a few dozen references is cheap.
 */
export class History {
  private past: FormaDocument[] = [];
  private future: FormaDocument[] = [];
  constructor(private current: FormaDocument, private readonly limit = 100) {}

  get value(): FormaDocument { return this.current; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  /** Record a new state as an undoable step. */
  commit(next: FormaDocument): FormaDocument {
    if (next === this.current) return next;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }

  /**
   * Replace the current state without creating an undo step. Use for the
   * intermediate values of a drag or a slider; call commit() once at the end
   * with the final value (pass the value from before the gesture to `begin`).
   */
  replace(next: FormaDocument): FormaDocument { this.current = next; return next; }

  /** Push an explicit checkpoint (state before a gesture) so the gesture undoes in one step. */
  checkpoint(before: FormaDocument): void {
    if (this.past[this.past.length - 1] === before) return;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(): FormaDocument {
    const prev = this.past.pop();
    if (!prev) return this.current;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): FormaDocument {
    const next = this.future.pop();
    if (!next) return this.current;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  reset(doc: FormaDocument): void { this.current = doc; this.past = []; this.future = []; }
}
