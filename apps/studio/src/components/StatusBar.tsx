import { featureById, topLevel } from '@forma/core';
import { useStore } from '../state/store';
import { formatNum } from './fields';

export function StatusBar() {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const evaluating = useStore((s) => s.evaluating);
  const ms = useStore((s) => s.lastEvalMs);
  const ready = useStore((s) => s.ready);
  const tool = useStore((s) => s.tool);
  const sketchPoints = useStore((s) => s.sketchPoints);

  const parts = topLevel(doc).filter((f) => f.visible);
  let tris = 0, vol = 0;
  for (const f of parts) { const r = results.get(f.id); if (!r) continue; tris += r.mesh.indices.length / 3; vol += r.volume; }
  const selRes = selection.map((id) => results.get(id)).filter((r): r is NonNullable<typeof r> => !!r && !r.error);
  const selFeature = selection.length === 1 ? featureById(doc, selection[0]!) : undefined;
  const sv = selRes.reduce((a, r) => a + r.volume, 0);
  const errors = parts.filter((f) => results.get(f.id)?.error).length;

  return (
    <div className="statusbar">
      {!ready && <span className="busy">loading kernel…</span>}
      {ready && evaluating && <span className="busy">computing…</span>}
      {ready && !evaluating && <span>{ms.toFixed(0)} ms</span>}
      <span>{parts.length} parts · <b>{Math.round(tris).toLocaleString()}</b> tris</span>
      {errors > 0 && <span style={{ color: 'var(--hole)' }}>{errors} error{errors > 1 ? 's' : ''}</span>}
      {selRes.length === 1 && selFeature && (
        <span>W <b>{formatNum(selRes[0]!.bbox.max.x - selRes[0]!.bbox.min.x)}</b> · D <b>{formatNum(selRes[0]!.bbox.max.y - selRes[0]!.bbox.min.y)}</b> · H <b>{formatNum(selRes[0]!.bbox.max.z - selRes[0]!.bbox.min.z)}</b> mm</span>
      )}
      {selRes.length > 0
        ? <span>sel <b>{formatNum(sv / 1000)}</b> cm³ · ≈<b>{formatNum((sv / 1000) * 1.24)}</b> g PLA</span>
        : <span><b>{formatNum(vol / 1000)}</b> cm³ · ≈<b>{formatNum((vol / 1000) * 1.24)}</b> g PLA</span>}
      {tool === 'sketch' && <span className="busy">sketch · {sketchPoints.length} pts</span>}
    </div>
  );
}
