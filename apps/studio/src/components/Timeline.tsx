import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormaDocument } from '@forma/core';
import { useStore } from '../state/store';
import { Icon, featureIcon } from './icons';

/**
 * The timeline at the bottom, in the spirit of Fusion's: one chip per step
 * of the model in the order it was built. Click a chip to select that part,
 * drag a chip to reorder the build, and drag the orange marker back to see
 * the model as it was at that step — anything you add while rolled back is
 * inserted at the marker. Undo/redo and what the last edit did sit on the
 * right.
 */
export function Timeline() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const results = useStore((s) => s.results);
  const rollback = useStore((s) => s.rollback);
  const setRollback = useStore((s) => s.setRollback);
  const select = useStore((s) => s.select);
  const reorder = useStore((s) => s.reorderFeature);
  const tick = useStore((s) => s.historyTick);
  const timeline = useStore((s) => s.timeline);
  const undo = useStore((s) => s.undo), redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.canUndo), canRedo = useStore((s) => s.canRedo);
  const stripRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const n = doc.features.length;
  const cursor = rollback ?? n;
  const lastLabel = useMemo(() => {
    const { past, current } = timeline();
    const prev = past[past.length - 1];
    return prev ? describeChange(prev, current) : 'Start';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, timeline]);

  // marker drag: map pointer x to a slot between chips
  const slotAt = (clientX: number): number => {
    const chips = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('.tl-chip') ?? []);
    let slot = 0;
    for (const c of chips) { const r = c.getBoundingClientRect(); if (clientX > r.left + r.width / 2) slot++; }
    return slot;
  };
  const onMarkerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setRollback(slotAt(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => { if (rollback !== null && rollback >= n) setRollback(null); }, [rollback, n, setRollback]);
  // keep the marker (or the newest step) in view as the build grows or the marker moves
  useEffect(() => { stripRef.current?.querySelector('.tl-marker')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }, [cursor, n]);
  // and the selected part when the selection changes elsewhere
  useEffect(() => { stripRef.current?.querySelector('.tl-chip.sel')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }, [selection]);
  if (n === 0) return null;

  const chips = doc.features.map((f, i) => {
    const r = results.get(f.id);
    const cls = ['tl-chip'];
    if (selection.includes(f.id)) cls.push('sel');
    if (i >= cursor) cls.push('after');
    if (!f.visible) cls.push('hidden');
    if (f.parentId) cls.push('child');
    if (f.role === 'hole') cls.push('hole');
    if (r?.error) cls.push('err');
    if (drag === f.id) cls.push('dragging');
    if (over === i) cls.push('over');
    return (
      <button
        key={f.id}
        className={cls.join(' ')}
        title={`${i + 1}. ${f.name}${f.parentId ? ' (inside a combine)' : ''}${r?.error ? ` — ${r.error}` : ''}`}
        draggable
        onDragStart={(e) => { setDrag(f.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { setDrag(null); setOver(null); }}
        onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(i); } }}
        onDrop={(e) => { e.preventDefault(); if (drag && drag !== f.id) reorder(drag, i); setDrag(null); setOver(null); }}
        onClick={(e) => { if (i >= cursor) setRollback(i + 1 >= n ? null : i + 1); select([f.id], e.shiftKey || e.metaKey ? 'toggle' : 'replace'); }}
      >
        {featureIcon(f.type)}
        <span className="nm">{f.name}</span>
      </button>
    );
  });
  // marker sits between chips[cursor-1] and chips[cursor]
  const marker = <i key="marker" className={`tl-marker${rollback !== null ? ' back' : ''}`} onPointerDown={onMarkerDown} title={rollback !== null ? `Showing the first ${rollback} of ${n} steps — drag to the end to see everything` : 'Drag back to see earlier steps'} />;
  const items = [...chips.slice(0, cursor), marker, ...chips.slice(cursor)];

  return (
    <div className="timeline glass-strong" role="toolbar" aria-label="Timeline">
      <div className="tl-nav">
        <button title="To the start" disabled={cursor === 0} onClick={() => setRollback(0)}><Icon.first /></button>
        <button title="One step back" disabled={cursor === 0} onClick={() => setRollback(cursor - 1)}><Icon.prev /></button>
      </div>
      <div className="tl-strip" ref={stripRef}>{items}</div>
      <div className="tl-nav">
        <button title="One step forward" disabled={rollback === null} onClick={() => setRollback(cursor + 1)}><Icon.next /></button>
        <button title="To the end" disabled={rollback === null} onClick={() => setRollback(null)}><Icon.last /></button>
      </div>
      <span className="tl-count">{rollback !== null ? `${rollback} / ${n}` : `${n} step${n > 1 ? 's' : ''}`}</span>
      <i className="tsep" />
      <div className="tl-nav">
        <button title={`Undo: ${lastLabel} (⌘Z)`} disabled={!canUndo()} onClick={undo}><Icon.undo /></button>
        <button title="Redo (⇧⌘Z)" disabled={!canRedo()} onClick={redo}><Icon.redo /></button>
      </div>
      <span className="tl-label" title={lastLabel}>{lastLabel}</span>
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
    if (o.filament !== f.filament) return `${f.name} → filament ${f.filament}`;
    return `Edited ${f.name}`;
  }
  if (changed.length > 1) return `Edited ${changed.length} parts`;
  if (prev.features.length === next.features.length && prev.features.some((f, i) => f.id !== next.features[i]!.id)) return 'Reordered steps';
  if (prev.filaments !== next.filaments) return 'Changed filaments';
  if (prev.name !== next.name) return 'Renamed project';
  return 'Change';
}
