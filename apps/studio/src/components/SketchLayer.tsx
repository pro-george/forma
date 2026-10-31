import { useMemo, useRef } from 'react';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { featureById, tessellate, sketchToProfiles, endpoints, sk, arcSweep, type Vec2, type SketchEntity, type Transform } from '@forma/core';
import { useStore } from '../state/store';
import { useSketch, rectCorners, circleFrom } from '../state/sketch';
import { useSel } from '../state/sel';
import { useUI } from '../state/ui';

interface Colors { accent: string; solid: string; hole: string; vp: string }

const d2r = Math.PI / 180;

/** World ↔ sketch-local for the feature frame (any orientation: the sketch plane is the feature's local XY). */
function frame(t: Transform) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(t.position.x, t.position.y, t.position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rotation.x * d2r, t.rotation.y * d2r, t.rotation.z * d2r, 'ZYX')),
    new THREE.Vector3(1, 1, 1),
  );
  const inv = m.clone().invert();
  const v = new THREE.Vector3();
  const toLocal = (wx: number, wy: number, wz = 0): Vec2 => { v.set(wx, wy, wz).applyMatrix4(inv); return [v.x, v.y]; };
  const toWorld = (p: Vec2, z = 0): [number, number, number] => { const w = new THREE.Vector3(p[0], p[1], z).applyMatrix4(m); return [w.x, w.y, w.z]; };
  const euler: [number, number, number, 'ZYX'] = [t.rotation.x * d2r, t.rotation.y * d2r, t.rotation.z * d2r, 'ZYX'];
  return { toLocal, toWorld, euler };
}

const GUIDE = '#8cdcff'; // Materializr's inference cyan (140, 220, 255)
const DRAG_PX = 12;

export function SketchLayer({ colors }: { colors: Colors }) {
  const active = useSketch((s) => s.active);
  const rectMode = useSketch((s) => s.rectMode);
  const circleMode = useSketch((s) => s.circleMode);
  const regions = useSel((s) => s.regions);
  const touch = useUI((u) => u.touch);
  const { camera, size } = useThree();
  const press = useRef<{ local: Vec2; x: number; y: number } | null>(null);
  const doc = useStore((s) => s.doc);
  const feature = active ? featureById(doc, active.featureId) : undefined;
  const sketch = feature && feature.type === 'extrude' ? feature.sketch ?? { entities: [] } : null;
  const t = feature?.transform;
  const fr = useMemo(() => (t ? frame(t) : null), [t]);

  const profiles = useMemo(() => (sketch ? sketchToProfiles(sketch) : null), [sketch]);
  // one fill per closed region so hover / selection can light a single one
  const regionGeometries = useMemo(() => {
    if (!profiles) return [];
    return profiles.profiles.map((p) => {
      const sh = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)));
      sh.holes = p.holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return new THREE.ShapeGeometry(sh);
    });
  }, [profiles]);

  if (!active || !feature || !sketch || !fr || !t) return null;
  const lift = 0.15;
  const mods = (e: { shiftKey: boolean; altKey: boolean }) => ({ shift: e.shiftKey, alt: e.altKey });
  const localOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => fr.toLocal(e.point.x, e.point.y, e.point.z);
  /** screen pixels per sketch mm around a local point, so the state can scale its pixel tolerances */
  const reportScale = (local: Vec2) => {
    const a = new THREE.Vector3(...fr.toWorld(local)).project(camera), b = new THREE.Vector3(...fr.toWorld([local[0] + 1, local[1]])).project(camera);
    api.setScale(Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height) / 2);
  };
  const planePos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
  const sk3 = (pts: Vec2[], lz = lift) => pts.map((p) => fr.toWorld(p, lz));
  const openIds = new Set(profiles?.openIds ?? []);
  const api = useSketch.getState();

  // draft preview
  const preview: { pts: Vec2[]; closed?: boolean; label?: string; at?: Vec2 }[] = [];
  const cur = active.snap?.p ?? active.cursor;
  if (cur && active.draft.length) {
    const a = active.draft[active.draft.length - 1]!;
    const typed = parseFloat(active.typed);
    switch (active.tool) {
      case 'line': {
        let p = cur;
        if (Number.isFinite(typed) && typed > 0) { const L = Math.hypot(cur[0] - a[0], cur[1] - a[1]) || 1; p = [a[0] + ((cur[0] - a[0]) / L) * typed, a[1] + ((cur[1] - a[1]) / L) * typed]; }
        const len = Math.hypot(p[0] - a[0], p[1] - a[1]);
        const ang = (Math.atan2(p[1] - a[1], p[0] - a[0]) / d2r + 360) % 360;
        preview.push({ pts: [a, p], label: `${fmt(len)} mm · ${fmt(ang)}°`, at: p });
        if (active.draft.length > 1) preview.push({ pts: active.draft });
        break;
      }
      case 'rect': {
        const c = rectCorners(a, cur, rectMode, active.typedW, active.typed);
        if (c) {
          const [p0, p1] = c;
          const w = Math.abs(p1[0] - p0[0]), h = Math.abs(p1[1] - p0[1]);
          const lw = active.typedW !== null ? `${fmt(w)} ✓` : fmt(w), lh = active.typedW !== null && active.typed ? `${fmt(h)} ✓` : fmt(h);
          preview.push({ pts: [p0, [p1[0], p0[1]], p1, [p0[0], p1[1]]], closed: true, label: `${lw} × ${lh} mm${active.typedW === null ? (active.typed ? '' : ' · type width ⏎ height ⏎') : ''}`, at: cur });
        }
        break;
      }
      case 'circle': {
        const c = circleFrom(a, cur, circleMode, active.typed);
        if (c) { preview.push({ pts: tessellate(sk.circle(c.center, c.radius)), closed: true, label: `⌀ ${fmt(c.radius * 2)} mm · r ${fmt(c.radius)}`, at: cur }); if (circleMode === '2pt') preview.push({ pts: [a, cur] }); }
        break;
      }
      case 'arc': {
        if (active.draft.length === 1) preview.push({ pts: [a, cur], label: `chord ${fmt(Math.hypot(cur[0] - a[0], cur[1] - a[1]))} mm`, at: cur });
        else {
          const arc = sk.arc3(active.draft[0]!, cur, active.draft[1]!);
          preview.push({ pts: tessellate(arc), label: arc.type === 'arc' ? `r ${fmt(arc.radius)} · ${fmt(Math.abs(arcSweep(arc)))}°` : 'line', at: cur });
        }
        break;
      }
    }
  }

  const vertexHandles: Vec2[] = [];
  if (active.tool === 'select') for (const e of sketch.entities) { const ep = endpoints(e); if (ep) vertexHandles.push(ep[0], ep[1]); if (e.type === 'circle') vertexHandles.push(e.center); }

  return (
    <group>
      {/* pointer plane at the sketch level */}
      <mesh
        position={planePos} rotation={fr.euler}
        onPointerMove={(e) => { e.stopPropagation(); const l = localOf(e); reportScale(l); if (active.dragVertex) api.dragVertexTo(l, mods(e)); else api.move(l, mods(e)); }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const l = localOf(e); reportScale(l);
          if (e.nativeEvent.pointerType === 'touch') api.move(l, mods(e)); // a tap has no hover before it: give the state a cursor
          if (active.tool === 'select') { if (api.beginVertexDrag(l)) e.stopPropagation(); return; }
          // touch: a press that turns into a drag draws the shape in one gesture (press = first point, release = second)
          if (e.nativeEvent.pointerType === 'touch' && !active.draft.length && ['line', 'rect', 'circle', 'polygon'].includes(active.tool)) press.current = { local: l, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
        }}
        onPointerUp={(e) => {
          if (active.dragVertex) { e.stopPropagation(); api.endVertexDrag(); return; }
          const pr = press.current; press.current = null;
          if (pr && Math.hypot(e.nativeEvent.clientX - pr.x, e.nativeEvent.clientY - pr.y) > DRAG_PX) {
            e.stopPropagation();
            api.click(pr.local, mods(e)); api.click(localOf(e), mods(e));
          }
        }}
        onClick={(e) => { if (e.button !== 0 || (e.delta ?? 0) > 4) return; e.stopPropagation(); api.click(localOf(e), mods(e)); }}
        onDoubleClick={(e) => { e.stopPropagation(); api.doubleClick(); }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* closed regions: faint fill, brighter when hovered with Select, blue when selected (then the dock offers Push) */}
      {regionGeometries.map((g, i) => {
        const sel = regions.some((r) => r.sketchId === active.featureId && r.index === i);
        const hov = active.hoverRegion === i;
        return (
          <mesh key={i} geometry={g} position={fr.toWorld([0, 0], lift * 0.5)} rotation={fr.euler}>
            <meshBasicMaterial color={sel ? '#408cff' : hov ? GUIDE : colors.accent} transparent opacity={sel ? 0.4 : hov ? 0.25 : 0.12} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        );
      })}

      {/* entities */}
      {sketch.entities.map((e) => {
        const pts = tessellate(e);
        const isSel = active.selected === e.id;
        const isOpen = openIds.has(e.id);
        return (
          <group key={e.id}>
            <Line points={sk3(e.type === 'circle' ? [...pts, pts[0]!] : pts)} color={isSel ? colors.accent : isOpen ? colors.hole : '#9fb0c8'} lineWidth={isSel ? 2.5 : 1.6} dashed={isOpen} dashSize={1.5} gapSize={1} />
            {/* fat invisible hit line for selection */}
            <Line points={sk3(e.type === 'circle' ? [...pts, pts[0]!] : pts, lift + 0.05)} color={colors.accent} lineWidth={12} transparent opacity={0}
              onClick={(ev: ThreeEvent<MouseEvent>) => { if (active.tool !== 'select') return; ev.stopPropagation(); api.select(e.id); }} />
          </group>
        );
      })}

      {/* vertex handles */}
      {vertexHandles.map((p, i) => <Dot key={i} p={fr.toWorld(p, lift + 0.1)} color={active.hoverVertex && dist(active.hoverVertex, p) < 0.01 ? colors.accent : '#9fb0c8'} r={active.hoverVertex && dist(active.hoverVertex, p) < 0.01 ? 1 : 0.6} />)}

      {/* draft */}
      {preview.map((pv, i) => (
        <group key={i}>
          <Line points={sk3(pv.closed ? [...pv.pts, pv.pts[0]!] : pv.pts, lift + 0.05)} color={colors.accent} lineWidth={1.6} />
          {pv.label && pv.at && (
            <Html position={fr.toWorld(pv.at, 2)} style={{ pointerEvents: 'none', transform: 'translate(12px, -14px)' }}>
              <div className="sketch-label">{pv.label}{active.typed ? ` · typed ${active.typed}` : ''}</div>
            </Html>
          )}
        </group>
      ))}
      {active.draft.map((p, i) => <Dot key={`d${i}`} p={fr.toWorld(p, lift + 0.1)} color={colors.accent} r={0.8} />)}

      {/* snap cursor + inference guides (cyan, with a glyph saying why) */}
      {active.snap && (
        <>
          <Dot p={fr.toWorld(active.snap.p, lift + 0.1)} color={active.snap.kind === 'point' ? GUIDE : active.snap.kind === 'axis' ? GUIDE : '#9fb0c8'} r={active.snap.kind === 'point' ? 1.1 : 0.7} ring />
          {active.snap.guides.map((g, i) => g.line && (
            <Line key={i} points={sk3(g.line, lift)} color={GUIDE} lineWidth={1} dashed dashSize={1.2} gapSize={0.8} transparent opacity={0.8} />
          ))}
          {active.snap.guides.some((g) => g.glyph) && (
            <Html position={fr.toWorld(active.snap.p, 2)} style={{ pointerEvents: 'none', transform: touch ? 'translate(-50%, -44px)' : 'translate(14px, 6px)' }}>
              <div className="sketch-guide">{active.snap.guides.filter((g) => g.glyph).map((g, i) => <span key={i} title={g.kind}>{g.glyph}{g.label ? ` ${g.label}` : ''}</span>)}</div>
            </Html>
          )}
        </>
      )}
    </group>
  );
}

function Dot({ p, color, r, ring }: { p: [number, number, number]; color: string; r: number; ring?: boolean }) {
  return (
    <mesh position={p}>
      {ring ? <ringGeometry args={[r * 0.7, r, 20]} /> : <circleGeometry args={[r, 20]} />}
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ''));
export type { SketchEntity };
