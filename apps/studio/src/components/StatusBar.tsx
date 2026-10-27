import { featureById, topLevel } from '@forma/core';
import { useStore } from '../state/store';
import { formatNum } from './fields';

export function StatusBar() {
  const doc = useStore((s) => s.viewDoc);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const evaluating = useStore((s) => s.evaluating);
  const ms = useStore((s) => s.lastEvalMs);
  const ready = useStore((s) => s.ready);

  const parts = topLevel(doc).filter((f) => f.visible);
  let tris = 0, vol = 0;
  for (const f of parts) { const r = results.get(f.id); if (!r) continue; tris += r.mesh.indices.length / 3; vol += r.volume; }
  const selRes = selection.map((id) => results.get(id)).filter((r): r is NonNullable<typeof r> => !!r && !r.error);
  const selFeature = selection.length === 1 ? featureById(doc, selection[0]!) : undefined;
  const sv = selRes.reduce((a, r) => a + r.volume, 0);
  const errors = parts.filter((f) => results.get(f.id)?.error).length;

  const one = selRes.length === 1 && selFeature ? selRes[0]! : null;
  return (
    <div className="statusbar" title={`${parts.length} parts · ${Math.round(tris).toLocaleString()} triangles · last build ${ms.toFixed(0)} ms`}>
      {!ready && <span className="busy">loading…</span>}
      {ready && evaluating && <span className="busy">building…</span>}
      {errors > 0 && <span style={{ color: 'var(--hole)' }}>{errors} error{errors > 1 ? 's' : ''}</span>}
      {one
        ? <span><b>{formatNum(one.bbox.max.x - one.bbox.min.x)}</b> × <b>{formatNum(one.bbox.max.y - one.bbox.min.y)}</b> × <b>{formatNum(one.bbox.max.z - one.bbox.min.z)}</b> mm</span>
        : <span>{parts.length} part{parts.length === 1 ? '' : 's'}</span>}
      {selRes.length > 0
        ? <span><b>{formatNum(sv / 1000)}</b> cm³ · ≈<b>{formatNum((sv / 1000) * 1.24)}</b> g</span>
        : <span><b>{formatNum(vol / 1000)}</b> cm³ · ≈<b>{formatNum((vol / 1000) * 1.24)}</b> g</span>}
    </div>
  );
}
