import { featureById } from '@forma/core';
import { useStore } from '../state/store';
import { useSketch, sketchStatus, type SketchTool } from '../state/sketch';
import { NumberField } from './fields';

const TOOLS: { id: SketchTool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'circle', label: 'Circle', key: 'C' },
  { id: 'arc', label: 'Arc', key: 'A' },
];

export function SketchHUD() {
  const active = useSketch((s) => s.active);
  const doc = useStore((s) => s.doc);
  const patch = useStore((s) => s.patchFeature);
  if (!active) return null;
  const f = featureById(doc, active.featureId);
  if (!f || f.type !== 'extrude') return null;
  const st = sketchStatus(active.featureId);
  const api = useSketch.getState();
  const hint = {
    select: active.selected ? 'Backspace removes the selected segment · drag a point to move it' : 'Click a segment to select it · drag a corner to move it',
    line: active.draft.length ? 'Click the next point · type a length and press Enter · click the first point to close' : 'Click to start a line or polyline',
    rect: active.draft.length ? 'Click the opposite corner' : 'Click the first corner',
    circle: active.draft.length ? 'Click for the radius, or type it and press Enter' : 'Click the centre',
    arc: active.draft.length === 0 ? 'Click the start point' : active.draft.length === 1 ? 'Click the end point' : 'Click a point the arc should pass through',
  }[active.tool];
  return (
    <div className="sketch-hud">
      <div className="sketch-tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={active.tool === t.id ? 'on' : ''} onClick={() => api.setTool(t.id)} title={`${t.label} (${t.key})`}>{t.label}<kbd>{t.key}</kbd></button>
        ))}
        <span className="sep" />
        <label className="hud-field">Height<NumberField value={f.height} min={0.1} step={1} unit="mm" onChange={(v) => patch(f.id, { height: v }, { undoable: false })} /></label>
        <span className="sep" />
        <span className={`hud-status ${st.open ? 'warn' : st.closed ? 'ok' : ''}`}>
          {st.closed ? `${st.closed} outline${st.closed > 1 ? 's' : ''}${st.holes ? `, ${st.holes} hole${st.holes > 1 ? 's' : ''}` : ''}` : 'no closed outline yet'}
          {st.open ? ` · ${st.open} open segment${st.open > 1 ? 's' : ''}` : ''}
        </span>
        <span className="sep" />
        <button onClick={api.cancel}>Cancel</button>
        <button className="primary" onClick={api.finish}>Done<kbd>Esc</kbd></button>
      </div>
      <div className="sketch-hint">
        <b>{TOOLS.find((t) => t.id === active.tool)?.label}</b> · {hint} · hold <kbd>⇧</kbd> for 45° steps, <kbd>⌥</kbd> to disable snapping
        {active.typed && <span className="typed"> · length {active.typed}</span>}
      </div>
    </div>
  );
}
