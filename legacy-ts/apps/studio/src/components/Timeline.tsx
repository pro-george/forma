import type { FormaDocument } from '@forma/core';

/** Human label for the difference between two consecutive documents. */
export function describeChange(prev: FormaDocument, next: FormaDocument): string {
  const a = new Map(prev.features.map((f) => [f.id, f])), b = new Map(next.features.map((f) => [f.id, f]));
  const added = next.features.filter((f) => !a.has(f.id));
  const removed = prev.features.filter((f) => !b.has(f.id));
  if (added.length && !removed.length) {
    // An edge tool or a face push adds the tool part plus the combine that hosts it: name the tool.
    const named = added.filter((f) => f.type !== 'combine');
    return `Added ${named.length === 1 ? named[0]!.name : `${added.length} parts`}`;
  }
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
