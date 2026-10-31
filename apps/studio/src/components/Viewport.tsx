import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, TransformControls, Edges, Line, Html } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { topLevel, type EvaluatedFeature, type Feature, type MeshEdge } from '@forma/core';
import { useStore } from '../state/store';
import { useViewStore } from '../state/view';
import { SketchLayer } from './SketchLayer';
import { useSketch } from '../state/sketch';
import { useSel } from '../state/sel';
import { useOp, type PushPullOp } from '../state/op';
import { useTool } from '../state/tool';
import { useUI } from '../state/ui';
import { faceAt } from '../state/hover';
import { useMenu, longPress } from '../state/menu';
import { edgesFor } from '../state/edges';
import { useContextMenu } from './ContextMenu';
import { EXTRAS } from '../features';
export { useViewStore };

/* colours after Materializr's SelectionHighlight / Gizmo */
const C = {
  face: '#408cff', edge: '#33ff66', body: '#4d99ff', pull: '#4d99ff', cut: '#ff5a3c', handle: '#ffc83c',
};

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
function useThemeColors() {
  const light = useUI((u) => u.light);
  return useMemo(() => ({ hole: cssVar('--hole'), accent: cssVar('--accent'), vp: cssVar('--vp'), gridMinor: cssVar('--grid-minor'), gridMajor: cssVar('--grid-major') }), [light]);
}

function toGeometry(m: EvaluatedFeature['mesh']): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  if (m.normals.length === m.positions.length && m.normals.length > 0) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  else g.computeVertexNormals();
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

const deg = THREE.MathUtils.degToRad;
const EDGE_OVERLAY_MAX_INDICES = 150_000;
const frameOf = (t: Feature['transform']) => new THREE.Matrix4().compose(
  new THREE.Vector3(t.position.x, t.position.y, t.position.z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(t.rotation.x), deg(t.rotation.y), deg(t.rotation.z), 'ZYX')),
  new THREE.Vector3(1, 1, 1),
);

/** Translucent fill over a set of triangles of the part mesh (a selected face). */
function FaceFill({ geometry, mesh, triangles, color, opacity }: { geometry: THREE.BufferGeometry; mesh: EvaluatedFeature['mesh']; triangles: number[]; color: string; opacity: number }) {
  const g = useMemo(() => {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', geometry.getAttribute('position'));
    const idx = new Uint32Array(triangles.length * 3);
    triangles.forEach((tri, k) => { idx[k * 3] = mesh.indices[tri * 3]!; idx[k * 3 + 1] = mesh.indices[tri * 3 + 1]!; idx[k * 3 + 2] = mesh.indices[tri * 3 + 2]!; });
    fg.setIndex(new THREE.BufferAttribute(idx, 1));
    return fg;
  }, [geometry, mesh, triangles]);
  useEffect(() => () => g.dispose(), [g]);
  return (
    <mesh geometry={g} raycast={() => null}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} side={THREE.DoubleSide} />
    </mesh>
  );
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function Part({ feature, result, selected, colors, wireframe, printLook, ghost, picking }: {
  feature: Feature; result: EvaluatedFeature | undefined; selected: boolean; colors: ReturnType<typeof useThemeColors>; wireframe: boolean; printLook: boolean; ghost?: boolean; picking?: boolean;
}) {
  const geometry = useMemo(() => (result ? toGeometry(result.mesh) : null), [result]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const { camera, size } = useThree();
  const t = feature.transform;
  const isHole = feature.role !== 'solid';
  const hasError = !!result?.error;
  const slotColor = useStore((s) => s.doc.filaments[feature.filament - 1]?.color ?? s.doc.filaments[0]!.color);
  const allFaces = useSel((s) => s.faces);
  const allEdges = useSel((s) => s.edges);
  const selFaces = useMemo(() => allFaces.filter((f) => f.partId === feature.id), [allFaces, feature.id]);
  const selEdges = useMemo(() => allEdges.filter((e) => e.partId === feature.id), [allEdges, feature.id]);
  const touch = useUI((u) => u.touch);
  const lpHit = useRef<{ x: number; y: number; faceIndex: number } | null>(null);

  const openMenu = (x: number, y: number, faceIndex: number) => {
    const st = useStore.getState();
    const flat = !!(result && faceAt(result.mesh, faceIndex));
    if (!st.selection.includes(feature.id) && !useSel.getState().faces.some((f) => f.partId === feature.id)) {
      if (flat) useSel.getState().pickFace({ partId: feature.id, faceIndex }, false); else useSel.getState().pickBody(feature.id, false);
    }
    useContextMenu.getState().show(x, y, useStore.getState().selection.includes(feature.id) ? useStore.getState().selection : [feature.id], { partId: feature.id, faceIndex, flat });
  };
  const openMenuRef = useRef(openMenu); openMenuRef.current = openMenu; // the long-press timer must see the latest result
  const lp = useMemo(() => longPress(() => { const h = lpHit.current; if (h) openMenuRef.current(h.x, h.y, h.faceIndex); }, 450), []);

  /** nearest straight edge of this part within the pick radius (8 px, 24 on touch) of a screen point, else -1 */
  const edgeNear = (px: number, py: number): number => {
    if (!result) return -1;
    const edges = edgesFor(result.mesh);
    if (!edges.length) return -1;
    const radius = touch ? 24 : 8;
    const m = frameOf(t);
    const toPx = (p: [number, number, number]) => { const v = new THREE.Vector3(...p).applyMatrix4(m).project(camera); return [(v.x + 1) / 2 * size.width, (1 - v.y) / 2 * size.height, v.z]; };
    let best = -1, bd = radius;
    edges.forEach((e, i) => {
      const a = toPx(e.a), b = toPx(e.b);
      if (a[2]! > 1 || b[2]! > 1) return;
      const d = segDist(px, py, a[0]!, a[1]!, b[0]!, b[1]!);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  return (
    <group position={[t.position.x, t.position.y, t.position.z]} rotation={[deg(t.rotation.x), deg(t.rotation.y), deg(t.rotation.z), 'ZYX']}>
      {geometry && (geometry.attributes.position?.count ?? 0) > 0 && (
        <mesh geometry={geometry} castShadow receiveShadow userData={{ id: feature.id }}
          onPointerMove={(e) => lp.move(e.nativeEvent.clientX, e.nativeEvent.clientY)}
          onPointerOut={() => lp.cancel()}
          onPointerUp={() => lp.cancel()}
          onPointerDown={(e) => {
            if (e.nativeEvent.pointerType === 'touch' && e.faceIndex != null && !useSketch.getState().active && !useOp.getState().op) {
              lpHit.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, faceIndex: e.faceIndex };
              lp.start(e.nativeEvent.clientX, e.nativeEvent.clientY);
            }
          }}
          onContextMenu={(e) => {
            if (useSketch.getState().active || useOp.getState().op || e.faceIndex == null) return;
            e.nativeEvent.preventDefault(); e.stopPropagation();
            openMenu(e.nativeEvent.clientX, e.nativeEvent.clientY, e.faceIndex);
          }}
          onDoubleClick={(e) => {
            if (useSketch.getState().active || useOp.getState().op || picking) return;
            e.stopPropagation();
            useSel.getState().setNavOnly(false);
            useSel.getState().pickBody(feature.id, e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || useSel.getState().multi);
          }}
          onClick={(e) => {
            if (useSketch.getState().active || useOp.getState().op || (e.delta ?? 0) > 4) return;
            if (e.nativeEvent.detail >= 2) return; // the double-click handler takes it
            if (!result || e.faceIndex == null) return;
            e.stopPropagation();
            const add = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || useSel.getState().multi;
            if (picking) {
              const pf = faceAt(result.mesh, e.faceIndex);
              if (!pf || !e.face) { useStore.getState().toast("Can't sketch on a curved face — pick a flat one, or sketch on XY / XZ / YZ."); return; }
              const nm = new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld);
              const n = e.face.normal.clone().applyMatrix3(nm).normalize();
              useSketch.getState().startOnFace(feature.id, [e.point.x, e.point.y, e.point.z], [n.x, n.y, n.z]);
              return;
            }
            useSel.getState().setNavOnly(false);
            // priority: edge within the pick radius → flat face → body (curved surfaces)
            const rect = (e.nativeEvent.target as HTMLElement).getBoundingClientRect();
            const ei = edgeNear(e.nativeEvent.clientX - rect.left, e.nativeEvent.clientY - rect.top);
            if (ei >= 0) { useSel.getState().pickEdge({ partId: feature.id, index: ei }, add); return; }
            if (faceAt(result.mesh, e.faceIndex)) { useSel.getState().pickFace({ partId: feature.id, faceIndex: e.faceIndex }, add); return; }
            useSel.getState().pickBody(feature.id, add);
          }}>
          <meshStandardMaterial
            color={isHole ? colors.hole : slotColor}
            emissive={selected ? C.body : '#000000'}
            emissiveIntensity={selected && !printLook ? 0.06 : 0}
            roughness={printLook ? 0.92 : 0.5} metalness={printLook ? 0 : 0.1}
            transparent={isHole || ghost} opacity={isHole ? 0.42 : ghost ? 0.3 : 1} depthWrite={!isHole && !ghost}
            wireframe={wireframe}
          />
          {selected && !ghost && (result?.mesh.indices.length ?? 0) < EDGE_OVERLAY_MAX_INDICES && <Edges threshold={28} color={C.body} lineWidth={1.4} />}
        </mesh>
      )}
      {geometry && result && selFaces.map((f) => { const pf = faceAt(result.mesh, f.faceIndex); return pf ? <FaceFill key={f.faceIndex} geometry={geometry} mesh={result.mesh} triangles={pf.triangles} color={C.face} opacity={0.35} /> : null; })}
      {result && selEdges.length > 0 && <SelectedEdges mesh={result.mesh} indices={selEdges.map((e) => e.index)} />}
      {hasError && (
        <mesh onClick={() => useSel.getState().pickBody(feature.id, false)}>
          <boxGeometry args={[10, 10, 10]} />
          <meshBasicMaterial color={colors.hole} wireframe />
        </mesh>
      )}
    </group>
  );
}

function SelectedEdges({ mesh, edges: given, indices }: { mesh?: EvaluatedFeature['mesh']; edges?: MeshEdge[]; indices: number[] }) {
  const edges = useMemo(() => given ?? (mesh ? edgesFor(mesh) : []), [mesh, given]);
  return (
    <group>
      {indices.map((i) => { const e = edges[i]; return e ? <Line key={i} points={[e.a, e.b]} color={C.edge} lineWidth={3} depthTest={false} /> : null; })}
    </group>
  );
}

/** Gizmo at the primary body; moves every selected top-level part. W = translate, E = rotate. Escape mid-drag reverts. */
function SelectionGizmo({ primary, mode }: { primary: Feature; mode: 'translate' | 'rotate' }) {
  const proxy = useRef<THREE.Group>(null!);
  const startRef = useRef<{ pos: THREE.Vector3; rot: THREE.Euler; others: { id: string; t: Feature['transform'] }[]; mine: Feature['transform'] } | null>(null);
  const { beginGesture, endGesture } = useStore.getState();
  const touch = useUI((u) => u.touch);
  const step = useUI((u) => u.gridStep);
  const t = primary.transform;
  useEffect(() => {
    proxy.current.position.set(t.position.x, t.position.y, t.position.z);
    proxy.current.rotation.set(deg(t.rotation.x), deg(t.rotation.y), deg(t.rotation.z), 'ZYX');
  }, [t.position.x, t.position.y, t.position.z, t.rotation.x, t.rotation.y, t.rotation.z]);
  const [readout, setReadout] = useState<string | null>(null);
  const onChange = () => {
    const s = startRef.current; if (!s) return;
    const p = proxy.current.position, r = proxy.current.rotation;
    const dx = p.x - s.pos.x, dy = p.y - s.pos.y, dz = p.z - s.pos.z;
    const st = useStore.getState();
    st.setTransform(primary.id, {
      position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      rotation: { x: round(THREE.MathUtils.radToDeg(r.x)), y: round(THREE.MathUtils.radToDeg(r.y)), z: round(THREE.MathUtils.radToDeg(r.z)) },
    }, { undoable: false });
    for (const o of s.others) st.setTransform(o.id, { position: { x: round(o.t.position.x + dx), y: round(o.t.position.y + dy), z: round(o.t.position.z + dz) } }, { undoable: false });
    const rd = THREE.MathUtils.radToDeg;
    setReadout(mode === 'translate' ? `Δ ${fmt(dx)} · ${fmt(dy)} · ${fmt(dz)} mm` : `${fmt(rd(r.x) - rd(s.rot.x))}° · ${fmt(rd(r.y) - rd(s.rot.y))}° · ${fmt(rd(r.z) - rd(s.rot.z))}°`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = startRef.current; if (!s || e.key !== 'Escape') return;
      const st = useStore.getState();
      st.setTransform(primary.id, s.mine, { undoable: false });
      for (const o of s.others) st.setTransform(o.id, o.t, { undoable: false });
      startRef.current = null; setReadout(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [primary.id]);
  return (
    <>
      <TransformControls
        object={proxy}
        mode={mode}
        translationSnap={step}
        rotationSnap={deg(15)}
        size={touch ? 1.4 : 1}
        onMouseDown={() => {
          beginGesture();
          const d = useStore.getState().doc;
          const others = useStore.getState().selection.filter((id) => id !== primary.id).map((id) => d.features.find((f) => f.id === id)!).filter((f) => f && f.parentId === null).map((f) => ({ id: f.id, t: f.transform }));
          startRef.current = { pos: proxy.current.position.clone(), rot: proxy.current.rotation.clone(), others, mine: primary.transform };
        }}
        onMouseUp={() => { startRef.current = null; endGesture(); setReadout(null); }}
        onObjectChange={onChange}
      >
        <group ref={proxy} />
      </TransformControls>
      {readout && <Html position={[t.position.x, t.position.y, t.position.z]} style={{ pointerEvents: 'none', transform: 'translate(-50%, -140%)' }}><div className="readout">{readout}</div></Html>}
    </>
  );
}
const round = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ''));

function ViewController({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera, invalidate } = useThree();
  const fitToken = useViewStore((s) => s.fitToken);
  const preset = useViewStore((s) => s.preset);
  const align = useViewStore((s) => s.align);
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; up: THREE.Vector3; target: THREE.Vector3; t0: number } | null>(null);
  (window as unknown as { __cam: unknown }).__cam = camera; // scripted tests read the camera
  /** 0.35 s eased camera move (the sketch ortho snap, Frame, presets) */
  const fly = (pos: THREE.Vector3, up: THREE.Vector3, target: THREE.Vector3) => {
    anim.current = { from: camera.position.clone(), to: pos, up, target, t0: performance.now() };
    const tick = () => {
      const a = anim.current; if (!a) return;
      const k = Math.min(1, (performance.now() - a.t0) / 350), e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(a.from, a.to, e);
      camera.up.copy(a.up); camera.lookAt(a.target);
      if (controls.current) { controls.current.target.copy(a.target); controls.current.update(); }
      invalidate();
      if (k < 1) requestAnimationFrame(tick); else anim.current = null;
    };
    requestAnimationFrame(tick);
  };
  useEffect(() => {
    if (!align) return;
    const p = new THREE.Vector3(...align.point), n = new THREE.Vector3(...align.normal).normalize();
    const dist = Math.max(80, camera.position.distanceTo(controls.current?.target ?? p) * 0.8);
    // OrbitControls keeps Z as up; a straight-down look gets a hair of -Y so the roll is defined (X right, Y up on screen)
    const dir = Math.abs(n.z) > 0.999 ? new THREE.Vector3(0, -0.0001 * Math.sign(n.z), n.z).normalize() : n;
    fly(p.clone().addScaledVector(dir, dist), new THREE.Vector3(0, 0, 1), p);
  }, [align]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (fitToken === 0 && !preset) return;
    const { doc, results, selection } = useStore.getState();
    const box = new THREE.Box3();
    const ids = selection.length ? selection : topLevel(doc).map((f) => f.id);
    for (const id of ids) {
      const f = doc.features.find((x) => x.id === id);
      const r = results.get(id);
      if (!f || !r || r.error) continue;
      box.union(new THREE.Box3(new THREE.Vector3(r.bbox.min.x, r.bbox.min.y, r.bbox.min.z), new THREE.Vector3(r.bbox.max.x, r.bbox.max.y, r.bbox.max.z)).applyMatrix4(frameOf(f.transform)));
    }
    if (box.isEmpty()) {
      const f = selection.length ? doc.features.find((x) => x.id === selection[0]) : undefined;
      const c = f ? f.transform.position : { x: 0, y: 0, z: 0 };
      box.set(new THREE.Vector3(c.x - 40, c.y - 40, c.z), new THREE.Vector3(c.x + 40, c.y + 40, c.z + 20));
    }
    const center = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3()).length();
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov ?? 38);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (cam.aspect ?? 1));
    const dist = Math.max(60, (sz / 2) / Math.tan(Math.min(vfov, hfov) / 2) * 1.05);
    const dir = new THREE.Vector3();
    if (preset === 'top') dir.set(0, -0.0001, 1);
    else if (preset === 'front') dir.set(0, -1, 0.0001);
    else if (preset === 'right') dir.set(1, 0, 0.0001);
    else if (preset === 'iso') dir.set(1, -1, 0.8);
    else dir.copy(camera.position).sub(controls.current?.target ?? new THREE.Vector3());
    if (dir.lengthSq() < 1e-9) dir.set(1, -1, 0.8);
    fly(center.clone().addScaledVector(dir.normalize(), dist), new THREE.Vector3(0, 0, 1), center);
    useViewStore.setState({ preset: null });
  }, [fitToken, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * The active interactive op in the viewport: its handle (an arrow along the
 * axis), the ghost prism for push/pull, and the drag surface — the whole
 * viewport for push/pull, near the handle (20 px, 30 on touch) for fillet
 * and chamfer.
 */
function OpLayer() {
  const { camera, gl } = useThree();
  const op = useOp((o) => o.op);
  const dragging = useOp((o) => o.dragging);
  const touch = useUI((u) => u.touch);
  const step = useUI((u) => u.gridStep);
  const opKey = op ? `${op.kind}:${op.partId}` : '';
  useEffect(() => {
    if (!op) return;
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const rayAt = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      return { o: [ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z] as [number, number, number], d: [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z] as [number, number, number] };
    };
    const nearHandle = (ev: PointerEvent) => {
      const o = useOp.getState().op; if (!o) return false;
      if (o.kind === 'pushpull') return true;
      const r = el.getBoundingClientRect();
      const len = Math.max(1, o.value) + 6;
      const a = new THREE.Vector3(...o.origin).project(camera);
      const b = new THREE.Vector3(o.origin[0] + o.out[0] * len, o.origin[1] + o.out[1] * len, o.origin[2] + o.out[2] * len).project(camera);
      const d = segDist(ev.clientX - r.left, ev.clientY - r.top, (a.x + 1) / 2 * r.width, (1 - a.y) / 2 * r.height, (b.x + 1) / 2 * r.width, (1 - b.y) / 2 * r.height);
      return d < (touch ? 30 : 20);
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || !nearHandle(ev)) return;
      ev.preventDefault(); ev.stopPropagation();
      useOp.getState().dragStart();
      const { o, d } = rayAt(ev);
      useOp.getState().dragMove(o, d, 0);
      const onMove = (mv: PointerEvent) => { const { o: o2, d: d2 } = rayAt(mv); useOp.getState().dragMove(o2, d2, step); };
      const onUp = () => { useOp.getState().dragEnd(); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointerdown', onDown, true);
    return () => el.removeEventListener('pointerdown', onDown, true);
  }, [opKey, camera, gl, step, touch]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!op) return null;
  const axis = op.kind === 'pushpull' ? op.normal : op.out;
  const value = op.kind === 'pushpull' ? op.distance : op.value;
  const o = new THREE.Vector3(...op.origin), n = new THREE.Vector3(...axis);
  const signed = op.kind === 'pushpull' ? (value < 0 ? -1 : 1) : 1;
  const tip = o.clone().addScaledVector(n, signed * (Math.max(Math.abs(value), 1) + (op.kind === 'pushpull' ? 0 : 4)));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().multiplyScalar(signed));
  const sz = Math.max(0.6, camera.position.distanceTo(o) * 0.012);
  const colour = op.kind === 'pushpull' ? (value < 0 ? C.cut : C.pull) : C.handle;
  const label = op.kind === 'pushpull' ? `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} mm${value < 0 ? ' · cut' : ''}` : `${value.toFixed(1)} mm`;
  return (
    <group>
      {op.kind === 'pushpull' && Math.abs(value) >= 0.05 && <GhostPrism op={op} />}
      {op.kind === 'edgeop' && (
        <group position={[op.part.transform.position.x, op.part.transform.position.y, op.part.transform.position.z]} rotation={[deg(op.part.transform.rotation.x), deg(op.part.transform.rotation.y), deg(op.part.transform.rotation.z), 'ZYX']}>
          <SelectedEdges edges={op.edges} indices={op.indices} />
        </group>
      )}
      <Line points={[o, tip]} color={colour} lineWidth={dragging ? 4 : 3} depthTest={false} />
      <mesh position={tip} quaternion={q} renderOrder={10}>
        <coneGeometry args={[sz * 1.6, sz * 4.5, 16]} />
        <meshBasicMaterial color={colour} depthTest={false} />
      </mesh>
      <Html position={tip} style={{ pointerEvents: 'none', transform: 'translate(16px, -16px)' }} zIndexRange={[20, 0]}>
        <div className="readout">{label}</div>
      </Html>
    </group>
  );
}

/** Translucent prism of the push/pull being previewed (blue adds, red cuts). The real boolean runs once, at ✓. */
function GhostPrism({ op }: { op: PushPullOp }) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape(op.profile.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes = op.profile.holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const depth = op.symmetric ? op.distance * 2 : Math.abs(op.distance);
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.05, depth), bevelEnabled: false });
    const shift = op.symmetric ? -op.distance : op.distance < 0 ? -depth : 0;
    g.translate(0, 0, shift);
    g.applyMatrix4(new THREE.Matrix4().fromArray(op.planeMatrix));
    return g;
  }, [op.profile, op.distance, op.symmetric, op.planeMatrix]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} raycast={() => null}>
      <meshStandardMaterial color={op.distance < 0 ? C.cut : C.pull} transparent opacity={0.38} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Invisible ground: remembers where the pointer is, starts a sketch there while picking a plane, right-click / long-press adds a part here. */
function GroundPlane() {
  const lp = useMemo(() => longPress(() => { const h = pending.current; if (h && EXTRAS) useMenu.getState().show(h.x, h.y, { point: h.point, normal: [0, 0, 1] }); }), []);
  const pending = useRef<{ x: number; y: number; point: [number, number, number] } | null>(null);
  return (
    <mesh position={[0, 0, -0.01]}
      onPointerMove={(e) => { if (!useSketch.getState().active) useViewStore.getState().setGround([e.point.x, e.point.y]); lp.move(e.nativeEvent.clientX, e.nativeEvent.clientY); }}
      onPointerDown={(e) => {
        if (useSketch.getState().active || useOp.getState().op) return;
        pending.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, point: [e.point.x, e.point.y, 0] };
        if (e.nativeEvent.pointerType === 'touch') lp.start(e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      onPointerUp={() => lp.cancel()}
      onClick={(e) => { if (useSketch.getState().pickingFace && e.button === 0 && (e.delta ?? 0) < 4) { e.stopPropagation(); useSketch.getState().createAndStartAt([e.point.x, e.point.y, 0]); } }}
      onContextMenu={(e) => { if (!EXTRAS || useSketch.getState().active || useOp.getState().op) return; e.nativeEvent.preventDefault(); useMenu.getState().show(e.nativeEvent.clientX, e.nativeEvent.clientY, { point: [e.point.x, e.point.y, 0], normal: [0, 0, 1] }); }}>
      <planeGeometry args={[6000, 6000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Shift/Alt-drag in empty space: box-select bodies whose projected bbox overlaps the rectangle (under 4 px counts as a click). */
function Marquee() {
  const { camera, gl, size } = useThree();
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || !(ev.shiftKey || ev.altKey) || useSketch.getState().active || useOp.getState().op) return;
      ev.preventDefault(); ev.stopPropagation();
      const r = el.getBoundingClientRect();
      const start = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      setRect({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
      const onMove = (mv: PointerEvent) => setRect({ x0: start.x, y0: start.y, x1: mv.clientX - r.left, y1: mv.clientY - r.top });
      const onUp = (up: PointerEvent) => {
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
        const x1 = up.clientX - r.left, y1 = up.clientY - r.top;
        setRect(null);
        const minX = Math.min(start.x, x1), maxX = Math.max(start.x, x1), minY = Math.min(start.y, y1), maxY = Math.max(start.y, y1);
        if (maxX - minX < 4 && maxY - minY < 4) return;
        const { doc, results } = useStore.getState();
        const hits: string[] = [];
        for (const f of topLevel(doc)) {
          const res = results.get(f.id); if (!f.visible || !res || res.error) continue;
          const m = frameOf(f.transform);
          let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
          for (const cx of [res.bbox.min.x, res.bbox.max.x]) for (const cy of [res.bbox.min.y, res.bbox.max.y]) for (const cz of [res.bbox.min.z, res.bbox.max.z]) {
            const v = new THREE.Vector3(cx, cy, cz).applyMatrix4(m).project(camera);
            const px = (v.x + 1) / 2 * size.width, py = (1 - v.y) / 2 * size.height;
            bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py);
          }
          if (bx0 <= maxX && bx1 >= minX && by0 <= maxY && by1 >= minY) hits.push(f.id);
        }
        const st = useStore.getState();
        useSel.getState().setNavOnly(false);
        useSel.setState({ faces: [], edges: [], regions: [] });
        st.select(up.ctrlKey || up.metaKey ? [...new Set([...st.selection, ...hits])] : hits);
      };
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    };
    el.addEventListener('pointerdown', onDown, true);
    return () => el.removeEventListener('pointerdown', onDown, true);
  }, [camera, gl, size]);
  if (!rect) return null;
  return <Html calculatePosition={() => [0, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}><div className="marquee" style={{ left: Math.min(rect.x0, rect.x1), top: Math.min(rect.y0, rect.y1), width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0) }} /></Html>;
}

function Scene() {
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const showGrid = useStore((s) => s.showGrid);
  const wireframe = useStore((s) => s.wireframe);
  const printLook = useStore((s) => s.printLook);
  const sketching = useSketch((s) => s.active?.featureId ?? null);
  const pickingFace = useSketch((s) => s.pickingFace);
  const op = useOp((o) => o.op);
  const opDragging = useOp((o) => o.dragging);
  const tool = useTool((s) => s.tool);
  const navOnly = useSel((s) => s.navOnly);
  const colors = useThemeColors();
  const controls = useRef<OrbitControlsImpl | null>(null);
  const viewDoc = useStore((s) => s.viewDoc);
  const step = useUI((u) => u.gridStep);
  const parts = useMemo(() => topLevel(viewDoc).filter((f) => f.visible), [viewDoc]);
  const primary = selection.length ? parts.find((f) => f.id === selection[selection.length - 1]) : undefined;
  const gizmoOn = !!primary && !sketching && !op && !navOnly;
  const cell = step >= 10 ? 10 : step <= 0.1 ? 0.5 : step;
  return (
    <>
      <color attach="background" args={[colors.vp]} />
      <hemisphereLight args={['#ffffff', '#2b3340', printLook ? 0.25 : 0.6]} />
      {printLook && <directionalLight position={[220, 60, 140]} intensity={1.6} />}
      <directionalLight position={[120, -90, 200]} intensity={printLook ? 0.6 : 1.1} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-200} shadow-camera-right={200} shadow-camera-top={200} shadow-camera-bottom={-200} shadow-camera-far={800} shadow-bias={-0.0005} />
      <directionalLight position={[-150, 120, 80]} intensity={0.35} />
      {showGrid && <Grid args={[400, 400]} cellSize={cell} cellThickness={0.6} cellColor={colors.gridMinor} sectionSize={cell * 10} sectionThickness={1} sectionColor={colors.gridMajor} rotation={[Math.PI / 2, 0, 0]} fadeDistance={900} fadeStrength={1} infiniteGrid />}
      {parts.map((f) => (
        <Part key={f.id} feature={f} result={results.get(f.id)} selected={selection.includes(f.id)} colors={colors} wireframe={wireframe} printLook={printLook} ghost={sketching === f.id} picking={pickingFace} />
      ))}
      {gizmoOn && primary && <SelectionGizmo key={primary.id + tool} primary={primary} mode={tool === 'rotate' ? 'rotate' : 'translate'} />}
      <SketchLayer colors={{ accent: colors.accent, solid: '#9aa0a8', hole: colors.hole, vp: colors.vp }} />
      <OpLayer />
      <Marquee />
      <GroundPlane />
      <OrbitControls ref={controls} makeDefault enabled={!opDragging && op?.kind !== 'pushpull'} enableDamping dampingFactor={0.12} minDistance={10} maxDistance={3000} maxPolarAngle={sketching ? Math.PI : Math.PI / 2 + 0.25}
        mouseButtons={sketching ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE } : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        // in a sketch one finger draws (press-drag-release), two fingers pan and zoom
        touches={sketching ? { ONE: -1 as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_PAN } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      <GizmoHelper alignment="bottom-right" margin={[100, 120]}>
        <GizmoViewport axisColors={['#e63333', '#33e633', '#4d66f2']} labelColor="white" />
      </GizmoHelper>
      <ViewController controls={controls} />
    </>
  );
}

export function Viewport() {
  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 2]}
      camera={{ position: [170, -170, 130], up: [0, 0, 1], fov: 38, near: 0.5, far: 6000 }}
      onCreated={({ camera }) => { camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0); }}
      onPointerMissed={(e) => {
        if (useSketch.getState().active || useOp.getState().op || e.button !== 0 || e.shiftKey || e.altKey) return;
        if ((e as MouseEvent).detail >= 2) return;
        useSel.getState().clear();
      }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <Scene />
    </Canvas>
  );
}
