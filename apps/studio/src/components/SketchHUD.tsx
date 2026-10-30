import { featureById } from '@forma/core';
import { useStore } from '../state/store';
import { useSketch, sketchStatus, type SketchTool } from '../state/sketch';
import { NumberField } from './fields';
import { useSel } from '../state/sel';

const TOOLS: { id: SketchTool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'circle', label: 'Circle', key: 'C' },
  { id: 'arc', label: 'Arc', key: 'A' },
  { id: 'polygon', label: 'Polygon', key: 'G' },
  { id: 'trim', label: 'Trim', key: 'T' },
];

export function SketchHUD() {
  const active = useSketch((s) => s.active);
  const host = useSketch((s) => s.host);
  const rectMode = useSketch((s) => s.rectMode);
  const circleMode = useSketch((s) => s.circleMode);
  const regions = useSel((s) => s.regions);
  const doc = useStore((s) => s.doc);
  const patch = useStore((s) => s.patchFeature);
  if (!active) return null;
  const f = featureById(doc, active.featureId);
  if (!f || f.type !== 'extrude') return null;
  const st = sketchStatus(active.featureId);
  const api = useSketch.getState();
  const mode = f.role === 'hole' ? 'cut' : 'join';
  const hint = {
    select: regions.length ? 'Region selected — Push in the dock gives it depth (positive adds, negative cuts) · Esc clears' : active.selected ? 'Type its length or radius above · arrows nudge it 1 mm (⇧ 10) · Backspace removes it' : 'Click a segment to select it · click inside a closed region to select the region · drag a corner to move it',
    line: active.draft.length ? 'Click the next point · type a length and press Enter · click the first point to close' : 'Click to start a line or polyline',
    rect: active.draft.length ? (active.typedW !== null ? `Width ${active.typedW} locked — type the height and press Enter, or click` : rectMode === 'center' ? 'Click a corner (the first click was the centre) · or type the width, Enter, height, Enter' : 'Click the opposite corner · or type the width, Enter, height, Enter') : rectMode === 'center' ? 'Click the centre' : 'Click the first corner',
    circle: active.draft.length ? (circleMode === '2pt' ? 'Click the other end of the diameter, or type the diameter and press Enter' : 'Click for the size, or type the diameter and press Enter') : circleMode === '2pt' ? 'Click one end of the diameter' : 'Click the centre',
    arc: active.draft.length === 0 ? 'Click the start point' : active.draft.length === 1 ? 'Click the end point' : 'Click a point the arc should pass through',
    polygon: active.draft.length ? 'Click for the size and rotation — the first corner sits under the cursor' : 'Click the centre',
    trim: 'Click the piece to remove — it is cut back to the nearest crossings',
  }[active.tool];
  return (
    <div className="sketch-hud">
      <div className="sketch-tools">
        {host && (
          <span className="seg hud-seg">
            <button className={mode === 'join' ? 'on' : ''} onClick={() => api.setMode('join')} title="Extrude outward and merge with the part">Join</button>
            <button className={mode === 'cut' ? 'on hole' : ''} onClick={() => api.setMode('cut')} title="Extrude into the part and remove the material">Cut</button>
          </span>
        )}
        {active.tool === 'rect' && (
          <span className="seg hud-seg">
            <button className={rectMode === 'corner' ? 'on' : ''} onClick={() => api.setRectMode('corner')} title="Corner to corner">Corner</button>
            <button className={rectMode === 'center' ? 'on' : ''} onClick={() => api.setRectMode('center')} title="Centre out to a corner">Center</button>
          </span>
        )}
        {active.tool === 'circle' && (
          <span className="seg hud-seg">
            <button className={circleMode === 'center' ? 'on' : ''} onClick={() => api.setCircleMode('center')} title="Centre, then a point on the circle">Center</button>
            <button className={circleMode === '2pt' ? 'on' : ''} onClick={() => api.setCircleMode('2pt')} title="Two ends of the diameter">2-Point</button>
          </span>
        )}
        <label className="hud-field">{mode === 'cut' ? 'Depth' : 'Height'}<NumberField value={f.height} min={0.1} step={1} unit="mm" onChange={(v) => patch(f.id, { height: v }, { undoable: false })} /></label>
        {active.tool === 'select' && active.selected && (() => {
          const e = f.sketch?.entities.find((x) => x.id === active.selected);
          if (!e) return null;
          const v = e.type === 'line' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) : e.radius;
          return (
            <>
              <span className="sep" />
              <label className="hud-field">{e.type === 'line' ? 'Length' : 'Radius'}<NumberField value={Math.round(v * 100) / 100} min={0.1} step={1} unit="mm" onChange={(n) => api.setSelectedSize(n)} /></label>
            </>
          );
        })()}
        <span className="sep" />
        <span className={`hud-status ${st.open ? 'warn' : st.closed ? 'ok' : ''}`}>
          {st.closed ? `${st.closed} outline${st.closed > 1 ? 's' : ''}${st.holes ? `, ${st.holes} hole${st.holes > 1 ? 's' : ''}` : ''}` : 'no closed outline yet'}
          {st.open ? ` · ${st.open} open segment${st.open > 1 ? 's' : ''}` : ''}
        </span>
      </div>
      <div className="sketch-hint">
        <b>{TOOLS.find((t) => t.id === active.tool)?.label}</b> · {hint} · hold <kbd>⇧</kbd> for 45° steps, <kbd>⌥</kbd> to disable snapping
        {active.typed && <span className="typed"> · {active.tool === 'circle' ? 'diameter' : active.tool === 'rect' ? (active.typedW !== null ? 'height' : 'width') : 'length'} {active.typed}</span>}
      </div>
    </div>
  );
}
