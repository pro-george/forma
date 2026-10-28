import { useEdges } from '../state/edges';
import { useTool } from '../state/tool';
import { useStore } from '../state/store';
import { NumberField } from './fields';

/** Floating bar that appears when edges are selected: Round / Chamfer, size, Apply. */
export function EdgeToolbar() {
  const selected = useEdges((e) => e.selected);
  const kind = useEdges((e) => e.kind);
  const size = useEdges((e) => e.size);
  const api = useEdges.getState();
  const tool = useTool((t) => t.tool);
  const hasSel = useStore((s) => s.selection.length > 0);
  if (tool !== 'edges' || !hasSel) return null;
  const n = selected?.indices.length ?? 0;
  return (
    <div className="edge-bar glass-strong" role="toolbar">
      <span className="seg">
        <button className={kind === 'round' ? 'on' : ''} onClick={() => api.setKind('round')}>Round</button>
        <button className={kind === 'chamfer' ? 'on' : ''} onClick={() => api.setKind('chamfer')}>Chamfer</button>
      </span>
      <label className="hud-field">{kind === 'round' ? 'Radius' : 'Size'}<NumberField value={size} min={0.1} step={0.5} unit="mm" onChange={(v) => api.setSize(v)} /></label>
      <button className="primary" disabled={n === 0} onClick={api.apply}>{n ? `Apply to ${n} edge${n > 1 ? 's' : ''}` : 'Pick an edge'}</button>
      <button className="ghost" onClick={() => useTool.getState().set('select')}>Done</button>
    </div>
  );
}
