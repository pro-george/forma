import { useMemo } from 'react';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { featureById, tessellate, sketchToProfiles, endpoints, sk, arcSweep, type Vec2, type SketchEntity, type Transform } from '@forma/core';
import { useStore } from '../state/store';
import { useSketch } from '../state/sketch';

interface Colors { accent: string; solid: string; hole: string; vp: string }

const d2r = Math.PI / 180;

/** World ↔ sketch-local (feature frame; only Z rotation + position are considered for the sketch plane). */
function frame(t: Transform) {
  const a = t.rotation.z * d2r, c = Math.cos(a), s = Math.sin(a);
  const toLocal = (wx: number, wy: number): Vec2 => { const dx = wx - t.position.x, dy = wy - t.position.y; return [dx * c + dy * s, -dx * s + dy * c]; };
  const toWorld = (p: Vec2, z = 0): [number, number, number] => [t.position.x + p[0] * c - p[1] * s, t.position.y + p[0] * s + p[1] * c, t.position.z + z];
  return { toLocal, toWorld };
}

export function SketchLayer({ colors }: { colors: Colors }) {
  const active = useSketch((s) => s.active);
  const doc = useStore((s) => s.doc);
  const feature = active ? featureById(doc, active.featureId) : undefined;
  const sketch = feature && feature.type === 'extrude' ? feature.sketch ?? { entities: [] } : null;
  const t = feature?.transform;
  const fr = useMemo(() => (t ? frame(t) : null), [t]);

  const profiles = useMemo(() => (sketch ? sketchToProfiles(sketch) : null), [sketch]);
  const fillGeometry = useMemo(() => {
    if (!profiles || profiles.profiles.length === 0) return null;
    const shapes = profiles.profiles.map((p) => {
      const sh = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)));
      sh.holes = p.holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return sh;
    });
    return new THREE.ShapeGeometry(shapes);
  }, [profiles]);

  if (!active || !feature || !sketch || !fr || !t) return null;
  const z = t.position.z;
  const lift = 0.15;
  const mods = (e: { shiftKey: boolean; altKey: boolean }) => ({ shift: e.shiftKey, alt: e.altKey });
  const localOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => fr.toLocal(e.point.x, e.point.y);
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
        const p = cur;
        preview.push({ pts: [a, [p[0], a[1]], p, [a[0], p[1]]], closed: true, label: `${fmt(Math.abs(p[0] - a[0]))} × ${fmt(Math.abs(p[1] - a[1]))} mm`, at: p });
        break;
      }
      case 'circle': {
        let r = Math.hypot(cur[0] - a[0], cur[1] - a[1]);
        if (Number.isFinite(typed) && typed > 0) r = typed;
        if (r > 0.01) preview.push({ pts: tessellate(sk.circle(a, r)), closed: true, label: `r ${fmt(r)} · ⌀ ${fmt(r * 2)} mm`, at: cur });
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
        position={[t.position.x, t.position.y, z]}
        onPointerMove={(e) => { e.stopPropagation(); if (active.dragVertex) api.dragVertexTo(localOf(e), mods(e)); else api.move(localOf(e), mods(e)); }}
        onPointerDown={(e) => { if (e.button !== 0) return; if (active.tool === 'select') { if (api.beginVertexDrag(localOf(e))) e.stopPropagation(); } }}
        onPointerUp={(e) => { if (active.dragVertex) { e.stopPropagation(); api.endVertexDrag(); } }}
        onClick={(e) => { if (e.button !== 0 || (e.delta ?? 0) > 4) return; e.stopPropagation(); if (active.tool === 'select') { api.select(null); return; } api.click(localOf(e), mods(e)); }}
        onDoubleClick={(e) => { e.stopPropagation(); api.doubleClick(); }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* closed area fill */}
      {fillGeometry && (
        <mesh geometry={fillGeometry} position={[t.position.x, t.position.y, z + lift * 0.5]} rotation={[0, 0, t.rotation.z * d2r]}>
          <meshBasicMaterial color={colors.accent} transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}

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

      {/* snap cursor + guide */}
      {active.snap && (
        <>
          <Dot p={fr.toWorld(active.snap.p, lift + 0.1)} color={active.snap.kind === 'point' ? colors.accent : '#9fb0c8'} r={active.snap.kind === 'point' ? 1.1 : 0.7} ring />
          {active.snap.kind === 'axis' && active.snap.ref && (
            <Line points={sk3([active.snap.ref, active.snap.p], lift)} color={colors.accent} lineWidth={1} dashed dashSize={1} gapSize={1} transparent opacity={0.6} />
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
