import { useMemo } from 'react';
import type { FormaDocument } from '@forma/core';
import { useStore } from '../state/store';

/**
 * Undo you can see: one dot per step, the current one highlighted. Hover
 * tells you what the step did; click jumps there. Keeps the last 12 and the
 * next few redo steps.
 */
const SHOW_PAST = 12, SHOW_FUTURE = 6;

export function HistoryStrip() {
  const tick = useStore((s) => s.historyTick);
  const jump = useStore((s) => s.jumpHistory);
  const timeline = useStore((s) => s.timeline);
  const items = useMemo(() => {
    const { past, current, future } = timeline();
    const seq = [...past.slice(-SHOW_PAST), current, ...future.slice(0, SHOW_FUTURE)];
    const cur = Math.min(past.length, SHOW_PAST);
    return seq.map((doc, i) => ({ delta: i - cur, label: i === 0 ? (past.length > SHOW_PAST ? 'Earlier' : 'Start') : describeChange(seq[i - 1]!, doc) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, timeline]);
  if (items.length < 2) return null;
  return (
    <div className="history glass-strong" role="toolbar" aria-label="History">
      {items.map((it, i) => (
        <button key={i} className={`hdot${it.delta === 0 ? ' now' : it.delta > 0 ? ' future' : ''}`} title={it.delta === 0 ? `Now · ${it.label}` : it.label} onClick={() => it.delta !== 0 && jump(it.delta)}>
          <i />
        </button>
      ))}
      <span className="hlabel">{items.find((it) => it.delta === 0)?.label}</span>
    </div>
  );
}

/** Human label for the difference between two consecutive documents. */
export function describeChange(prev: FormaDocument, next: FormaDocument): string {
  const a = new Map(prev.features.map((f) => [f.id, f])), b = new Map(next.features.map((f) => [f.id, f]));
  const added = next.features.filter((f) => !a.has(f.id));
  const removed = prev.features.filter((f) => !b.has(f.id));
  if (added.length && !removed.length) return `Added ${added.length === 1 ? added[0]!.name : `${added.length} parts`}`;
  if (removed.length && !added.length) return `Removed ${removed.length === 1 ? removed[0]!.name : `${removed.length} parts`}`;
  if (added.length && removed.length) return added.some((f) => f.type === 'combine') ? `Combined into ${added.find((f) => f.type === 'combine')!.name}` : 'Rebuilt parts';
  const changed = next.features.filter((f) => a.get(f.id) !== f);
  if (changed.length === 1) {
    const f = changed[0]!, o = a.get(f.id)!;
    if (o.transform !== f.transform) return `Moved ${f.name}`;
    if (o.name !== f.name) return `Renamed to ${f.name}`;
    if (o.role !== f.role) return `${f.name} → ${f.role}`;
    if (o.visible !== f.visible) return `${f.visible ? 'Showed' : 'Hid'} ${f.name}`;
    return `Edited ${f.name}`;
  }
  if (changed.length > 1) return `Edited ${changed.length} parts`;
  if (prev.name !== next.name) return 'Renamed project';
  return 'Change';
}
