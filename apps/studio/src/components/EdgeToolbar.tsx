import { useEdges } from '../state/edges';
import { NumberField } from './fields';

/** Floating bar that appears when edges are selected: Round / Chamfer, size, Apply. */
export function EdgeToolbar() {
  const selected = useEdges((e) => e.selected);
  const kind = useEdges((e) => e.kind);
  const size = useEdges((e) => e.size);
  const api = useEdges.getState();
  if (!selected || selected.indices.length === 0) return null;
  const n = selected.indices.length;
  return (
    <div className="edge-bar glass-strong" role="toolbar">
      <span className="seg">
        <button className={kind === 'round' ? 'on' : ''} onClick={() => api.setKind('round')}>Round</button>
        <button className={kind === 'chamfer' ? 'on' : ''} onClick={() => api.setKind('chamfer')}>Chamfer</button>
      </span>
      <label className="hud-field">{kind === 'round' ? 'Radius' : 'Size'}<NumberField value={size} min={0.1} step={0.5} unit="mm" onChange={(v) => api.setSize(v)} /></label>
      <button className="primary" onClick={api.apply}>Apply to {n} edge{n > 1 ? 's' : ''}</button>
      <button className="ghost" onClick={api.clear}>Cancel</button>
      <span className="hint">⇧-click adds more edges</span>
    </div>
  );
}
