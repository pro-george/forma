import { useRef, useState } from 'react';
import { chaikin, type FeatureOf, type Vec2 } from '@forma/core';
import { useStore } from '../state/store';

const W = 288, H = 210, PAD = 18, CX = W / 2;

/** Draggable side-profile editor for revolve features (radius in mm, height as 0..1). */
export function ProfileEditor({ feature }: { feature: FeatureOf<'revolve'> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(-1);
  const patch = useStore((s) => s.patchFeature);
  const { profile } = feature;
  const rmax = Math.max(15, ...profile.map((p) => p[0])) * 1.25;
  const sx = (r: number) => CX + (r / rmax) * (CX - PAD);
  const sy = (t: number) => H - PAD - t * (H - 2 * PAD);
  const ir = (x: number) => ((x - CX) / (CX - PAD)) * rmax;
  const it = (y: number) => (H - PAD - y) / (H - 2 * PAD);
  const toLocal = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const setProfile = (p: Vec2[], undoable = false) => patch(feature.id, { profile: p } as Partial<FeatureOf<'revolve'>>, { undoable });
  const smooth = chaikin(profile, feature.smoothing);
  const path = (pts: Vec2[], mirror = false) => pts.map(([r, t], i) => `${i ? 'L' : 'M'}${(mirror ? 2 * CX - sx(r) : sx(r)).toFixed(1)},${sy(t).toFixed(1)}`).join(' ');

  const onDown = (e: React.PointerEvent) => {
    const target = e.target as SVGElement;
    const q = toLocal(e);
    useStore.getState().beginGesture();
    if (target.dataset.i !== undefined) {
      setDragging(+target.dataset.i);
      svg.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (target.id === 'prof-hit') {
      const t = Math.min(1, Math.max(0, it(q.y)));
      let idx = profile.findIndex((p) => p[1] > t);
      if (idx <= 0) idx = idx === 0 ? 1 : profile.length - 1;
      const next = [...profile];
      next.splice(idx, 0, [Math.max(0, Math.round(ir(q.x) * 10) / 10), Math.round(t * 1000) / 1000]);
      setProfile(next);
      setDragging(idx);
      svg.current!.setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragging < 0) return;
    const q = toLocal(e);
    const next = profile.map((p) => [p[0], p[1]] as Vec2);
    const p = next[dragging]!;
    p[0] = Math.max(0, Math.round(Math.abs(ir(q.x)) * 10) / 10);
    if (dragging > 0 && dragging < next.length - 1) {
      const lo = next[dragging - 1]![1] + 0.01, hi = next[dragging + 1]![1] - 0.01;
      p[1] = Math.round(Math.min(hi, Math.max(lo, it(q.y))) * 1000) / 1000;
    }
    setProfile(next);
  };
  const onUp = () => { if (dragging >= 0) { setDragging(-1); useStore.getState().endGesture(); } };
  const onDouble = (e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    if (target.dataset.i === undefined) return;
    const i = +target.dataset.i;
    if (profile.length <= 3 || i === 0 || i === profile.length - 1) return;
    const next = profile.filter((_, k) => k !== i);
    setProfile(next, true);
  };

  return (
    <>
      <svg ref={svg} className="profile-ed" viewBox={`0 0 ${W} ${H}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble}>
        <line className="axis" x1={CX} y1={PAD - 6} x2={CX} y2={H - PAD + 6} />
        <path className="fillp" d={`${path(smooth)} L${CX},${sy(1)} L${CX},${sy(0)} Z`} />
        <path className="mir" d={path(smooth, true)} />
        <path className="cur" d={path(smooth)} />
        {feature.wall > 0 && <path className="wall" d={path(smooth.map(([r, t]) => [Math.max(0, r - feature.wall), t]))} />}
        <path id="prof-hit" d={path(profile)} stroke="transparent" strokeWidth={14} fill="none" />
        {profile.map(([r, t], i) => <circle key={i} className="pt" data-i={i} cx={sx(r)} cy={sy(t)} r={5} />)}
        <text className="lab" x={W - PAD} y={H - 4} textAnchor="end">r {Math.max(...profile.map((p) => p[0])).toFixed(1)} mm</text>
        <text className="lab" x={PAD} y={H - 4}>h {feature.height} mm</text>
      </svg>
      <div className="note">Drag points · click the curve to add one · double-click a point to remove it. Radius is in mm; the curve spans the full Height.</div>
    </>
  );
}
