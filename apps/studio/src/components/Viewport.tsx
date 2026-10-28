import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, TransformControls, Edges, Line, Html } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { topLevel, type EvaluatedFeature, type Feature } from '@forma/core';
import { useStore } from '../state/store';
import { useViewStore } from '../state/view';
import { SketchLayer } from './SketchLayer';
import { useSketch } from '../state/sketch';
import { usePushPull } from '../state/pushpull';
import { useHover, faceAt } from '../state/hover';
import { useMenu, longPress, type MenuHit } from '../state/menu';
import { DimensionTags } from './DimensionTags';
import { useEdges, edgesFor, edgeJustClicked } from '../state/edges';
import { useTool } from '../state/tool';
import { useDrag } from '../state/drag';
export { useViewStore };

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

function useThemeColors() {
  const [c, setC] = useState(() => ({ solid: cssVar('--solid'), hole: cssVar('--hole'), accent: cssVar('--accent'), vp: cssVar('--vp'), gridMinor: cssVar('--grid-minor'), gridMajor: cssVar('--grid-major') }));
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const upd = () => setC({ solid: cssVar('--solid'), hole: cssVar('--hole'), accent: cssVar('--accent'), vp: cssVar('--vp'), gridMinor: cssVar('--grid-minor'), gridMajor: cssVar('--grid-major') });
    mq.addEventListener('change', upd);
    return () => mq.removeEventListener('change', upd);
  }, []);
  return c;
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

/** Above this many indices the selection edge overlay is skipped: it costs seconds and hides the surface under lines. */
const EDGE_OVERLAY_MAX_INDICES = 150_000;

function Part({ feature, result, selected, colors, wireframe, printLook, ghost, picking, onSelect }: {
  feature: Feature; result: EvaluatedFeature | undefined; selected: boolean; colors: ReturnType<typeof useThemeColors>; wireframe: boolean; printLook: boolean; ghost?: boolean; picking?: boolean;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const geometry = useMemo(() => (result ? toGeometry(result.mesh) : null), [result]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const t = feature.transform;
  const isHole = feature.role !== 'solid';
  const hasError = !!result?.error;
  const hover = useHover((h) => (h.hover?.partId === feature.id ? h.hover : null));
  const tool = useTool((s) => s.tool);
  const pending = usePushPull((s) => (s.pending?.partId === feature.id ? s.pending : null));
  const slotColor = useStore((s) => s.doc.filaments[feature.filament - 1]?.color ?? s.doc.filaments[0]!.color);
  // faces light up and can be dragged only in the Push / Pull tool (or while picking a plane to sketch on)
  const draggable = tool === 'pushpull' && !ghost && !picking;
  const showFace = (draggable || picking) && !ghost;
  const litFace = hover?.face ?? (pending && result ? faceAt(result.mesh, pending.faceIndex) : null);
  const faceGeometry = useMemo(() => {
    if (!geometry || !litFace || !showFace) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geometry.getAttribute('position'));
    const idx = new Uint32Array(litFace.triangles.length * 3);
    const src = result!.mesh.indices;
    litFace.triangles.forEach((tri, k) => { idx[k * 3] = src[tri * 3]!; idx[k * 3 + 1] = src[tri * 3 + 1]!; idx[k * 3 + 2] = src[tri * 3 + 2]!; });
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }, [geometry, litFace, showFace, result]);
  useEffect(() => () => faceGeometry?.dispose(), [faceGeometry]);
  const setHover = useHover.getState().set;
  const lpHit = useRef<{ x: number; y: number; hit: MenuHit } | null>(null);
  const lp = useMemo(() => longPress(() => { const h = lpHit.current; if (h) { usePushPull.getState().end(); useDrag.getState().end(); useMenu.getState().show(h.x, h.y, h.hit); } }), []);
  return (
    <group position={[t.position.x, t.position.y, t.position.z]} rotation={[deg(t.rotation.x), deg(t.rotation.y), deg(t.rotation.z), 'ZYX']}>
      {geometry && (geometry.attributes.position?.count ?? 0) > 0 && (
        <mesh geometry={geometry} castShadow receiveShadow userData={{ id: feature.id }}
          onPointerMove={(e) => {
            lp.move(e.nativeEvent.clientX, e.nativeEvent.clientY);
            if (useSketch.getState().active || usePushPull.getState().drag || useDrag.getState().drag || e.faceIndex === undefined || e.faceIndex === null || !result) return;
            e.stopPropagation();
            setHover({ partId: feature.id, faceIndex: e.faceIndex, face: showFace ? faceAt(result.mesh, e.faceIndex) : null });
          }}
          onPointerOut={() => { if (useHover.getState().hover?.partId === feature.id) setHover(null); lp.cancel(); }}
          onPointerUp={() => lp.cancel()}
          onContextMenu={(e) => {
            if (useSketch.getState().active || !e.face) return;
            e.nativeEvent.preventDefault(); e.stopPropagation();
            const nm = new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld);
            const n = e.face.normal.clone().applyMatrix3(nm).normalize();
            useMenu.getState().show(e.nativeEvent.clientX, e.nativeEvent.clientY, { point: [e.point.x, e.point.y, e.point.z], normal: [n.x, n.y, n.z], partId: feature.id, faceIndex: e.faceIndex ?? undefined });
          }}
          onPointerDown={(e) => {
            if (e.nativeEvent.pointerType === 'touch' && e.face && !useSketch.getState().active) {
              const nm = new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld);
              const n = e.face.normal.clone().applyMatrix3(nm).normalize();
              lpHit.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, hit: { point: [e.point.x, e.point.y, e.point.z], normal: [n.x, n.y, n.z], partId: feature.id, faceIndex: e.faceIndex ?? undefined } };
              lp.start(e.nativeEvent.clientX, e.nativeEvent.clientY);
            }
            if (e.button !== 0 || ghost || picking || useSketch.getState().active) return;
            const t = useTool.getState().tool;
            if (t === 'pushpull') {
              if (e.faceIndex === undefined || e.faceIndex === null || !result) return;
              if (!faceAt(result.mesh, e.faceIndex)) return; // curved surface: let the orbit have it
              e.stopPropagation();
              const ray = { origin: [e.ray.origin.x, e.ray.origin.y, e.ray.origin.z] as [number, number, number], dir: [e.ray.direction.x, e.ray.direction.y, e.ray.direction.z] as [number, number, number] };
              // a press only remembers the face; it becomes a drag after a few pixels, or a pick on release
              usePushPull.getState().pressAt(feature.id, e.faceIndex, [e.point.x, e.point.y, e.point.z], ray, e.nativeEvent.clientX, e.nativeEvent.clientY);
              return;
            }
            if (t === 'select' || t === 'move') {
              // press selects (⇧ adds) and starts sliding the selection on the plate
              e.stopPropagation();
              const st = useStore.getState();
              const add = e.shiftKey || e.metaKey || e.ctrlKey;
              if (!st.selection.includes(feature.id)) st.select([feature.id], add ? 'add' : 'replace');
              useEdges.getState().clear();
              useDrag.getState().begin(useStore.getState().selection, [e.point.x, e.point.y, e.point.z]);
            }
          }}
          onClick={(e) => {
            if (usePushPull.getState().justDragged() || useDrag.getState().justDragged()) { e.stopPropagation(); return; }
            if (!picking) {
              const t = useTool.getState().tool;
              if (t === 'pushpull') {
                // clicks on faces are handled on release by the press logic; a click elsewhere on the part just selects it
                if (result && e.faceIndex !== undefined && e.faceIndex !== null && faceAt(result.mesh, e.faceIndex)) { e.stopPropagation(); return; }
                useStore.getState().toast('That face is not flat — push/pull needs a flat face');
                onSelect(e);
                return;
              }
              if (t !== 'edges') useEdges.getState().clear();
              onSelect(e);
              return;
            }
            if (!e.face) return;
            e.stopPropagation();
            // face normal → world space, point → world space
            const nm = new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld);
            const n = e.face.normal.clone().applyMatrix3(nm).normalize();
            useSketch.getState().startOnFace(feature.id, [e.point.x, e.point.y, e.point.z], [n.x, n.y, n.z]);
          }}>
          <meshStandardMaterial
            color={isHole ? colors.hole : slotColor}
            emissive={selected ? colors.accent : '#000000'}
            emissiveIntensity={selected && !printLook ? 0.035 : 0}
            roughness={printLook ? 0.92 : 0.55} metalness={printLook ? 0 : 0.12}
            transparent={isHole || ghost} opacity={isHole ? 0.42 : ghost ? 0.3 : 1} depthWrite={!isHole && !ghost}
            wireframe={wireframe}
          />
          {selected && !ghost && !printLook && (result?.mesh.indices.length ?? 0) < EDGE_OVERLAY_MAX_INDICES && <Edges threshold={28} color={colors.accent} lineWidth={1} />}
        </mesh>
      )}
      {faceGeometry && (
        <mesh geometry={faceGeometry} raycast={() => null}>
          <meshBasicMaterial color={colors.accent} transparent opacity={0.28} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} side={THREE.DoubleSide} />
        </mesh>
      )}
      {selected && !ghost && result && !result.error && <DimensionTags feature={feature} result={result} />}
      {selected && !ghost && tool === 'edges' && result && !result.error && <EdgeLayer partId={feature.id} mesh={result.mesh} accent={colors.accent} />}
      {hasError && (
        <mesh onClick={onSelect}>
          <boxGeometry args={[10, 10, 10]} />
          <meshBasicMaterial color={colors.hole} wireframe />
        </mesh>
      )}
    </group>
  );
}

/** Pickable straight edges of the selected part: hover to highlight, click to select (⇧ adds), then round or chamfer. */
function EdgeLayer({ partId, mesh, accent }: { partId: string; mesh: EvaluatedFeature['mesh']; accent: string }) {
  const edges = useMemo(() => edgesFor(mesh), [mesh]);
  const hover = useEdges((e) => (e.hover?.partId === partId ? e.hover.index : -1));
  const selected = useEdges((e) => (e.selected?.partId === partId ? e.selected.indices : EMPTY));
  if (edges.length === 0) return null;
  return (
    <group>
      {edges.map((e, i) => {
        const on = selected.includes(i), hot = hover === i;
        const pts: [number, number, number][] = [e.a, e.b];
        return (
          <group key={i}>
            {(on || hot) && <Line points={pts} color={accent} lineWidth={on ? 4 : 2.5} transparent opacity={on ? 1 : 0.8} depthTest={false} />}
            <Line points={pts} color={accent} lineWidth={14} transparent opacity={0}
              onPointerOver={(ev: ThreeEvent<PointerEvent>) => { if (useSketch.getState().active || usePushPull.getState().drag) return; ev.stopPropagation(); useEdges.getState().setHover({ partId, index: i }); }}
              onPointerOut={() => { if (useEdges.getState().hover?.index === i) useEdges.getState().setHover(null); }}
              onPointerDown={(ev: ThreeEvent<PointerEvent>) => { ev.stopPropagation(); }}
              onClick={(ev: ThreeEvent<MouseEvent>) => { ev.stopPropagation(); useEdges.getState().toggle(partId, i, ev.shiftKey || ev.metaKey || ev.ctrlKey); }} />
          </group>
        );
      })}
    </group>
  );
}
const EMPTY: number[] = [];

/** Gizmo attached to a proxy object at the primary selection; moves all selected top-level parts. */
function SelectionGizmo({ primary, mode }: { primary: Feature; mode: 'translate' | 'rotate' }) {
  const proxy = useRef<THREE.Group>(null!);
  const startRef = useRef<{ pos: THREE.Vector3; rot: THREE.Euler; others: { id: string; t: Feature['transform'] }[] } | null>(null);
  const { beginGesture, endGesture } = useStore.getState();
  const t = primary.transform;
  useEffect(() => {
    proxy.current.position.set(t.position.x, t.position.y, t.position.z);
    // document rotations are Euler ZYX degrees: X, then Y, then Z about world axes (what Manifold.rotate does)
    proxy.current.rotation.set(deg(t.rotation.x), deg(t.rotation.y), deg(t.rotation.z), 'ZYX');
  }, [t.position.x, t.position.y, t.position.z, t.rotation.x, t.rotation.y, t.rotation.z]);

  const onChange = () => {
    const s = startRef.current;
    if (!s) return;
    const p = proxy.current.position, r = proxy.current.rotation;
    const dx = p.x - s.pos.x, dy = p.y - s.pos.y, dz = p.z - s.pos.z;
    const st = useStore.getState();
    st.setTransform(primary.id, {
      position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      rotation: { x: round(THREE.MathUtils.radToDeg(r.x)), y: round(THREE.MathUtils.radToDeg(r.y)), z: round(THREE.MathUtils.radToDeg(r.z)) },
    }, { undoable: false });
    for (const o of s.others) st.setTransform(o.id, { position: { x: round(o.t.position.x + dx), y: round(o.t.position.y + dy), z: round(o.t.position.z + dz) } }, { undoable: false });
  };
  return (
    <TransformControls
      object={proxy}
      mode={mode}
      translationSnap={1}
      rotationSnap={deg(5)}
      size={1.15}
      onMouseDown={() => {
        beginGesture();
        const d = useStore.getState().doc;
        const others = useStore.getState().selection.filter((id) => id !== primary.id).map((id) => d.features.find((f) => f.id === id)!).filter((f) => f && f.parentId === null).map((f) => ({ id: f.id, t: f.transform }));
        startRef.current = { pos: proxy.current.position.clone(), rot: proxy.current.rotation.clone(), others };
      }}
      onMouseUp={() => { startRef.current = null; endGesture(); }}
      onObjectChange={onChange}
    >
      <group ref={proxy} />
    </TransformControls>
  );
}
const round = (v: number) => Math.round(v * 100) / 100;

function ViewController({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const fitToken = useViewStore((s) => s.fitToken);
  const preset = useViewStore((s) => s.preset);
  const align = useViewStore((s) => s.align);
  useEffect(() => {
    if (!align) return;
    const p = new THREE.Vector3(...align.point), n = new THREE.Vector3(...align.normal).normalize();
    const dist = Math.max(80, camera.position.distanceTo(controls.current?.target ?? p) * 0.8);
    camera.position.copy(p).addScaledVector(n, dist);
    // "up" on screen: world Z unless the face is horizontal, then world Y
    camera.up.copy(Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1));
    camera.lookAt(p);
    if (controls.current) { controls.current.target.copy(p); controls.current.update(); }
  }, [align, camera, controls]);
  useEffect(() => {
    if (fitToken === 0 && !preset) return;
    const { doc, results, selection } = useStore.getState();
    const box = new THREE.Box3();
    const ids = selection.length ? selection : topLevel(doc).map((f) => f.id);
    for (const id of ids) {
      const f = doc.features.find((x) => x.id === id);
      const r = results.get(id);
      if (!f || !r || r.error) continue;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(f.transform.position.x, f.transform.position.y, f.transform.position.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(f.transform.rotation.x), deg(f.transform.rotation.y), deg(f.transform.rotation.z), 'ZYX')),
        new THREE.Vector3(1, 1, 1),
      );
      const b = new THREE.Box3(new THREE.Vector3(r.bbox.min.x, r.bbox.min.y, r.bbox.min.z), new THREE.Vector3(r.bbox.max.x, r.bbox.max.y, r.bbox.max.z)).applyMatrix4(m);
      box.union(b);
    }
    if (box.isEmpty()) {
      // nothing evaluated yet (e.g. a fresh sketch): frame the selected feature's position
      const f = selection.length ? doc.features.find((x) => x.id === selection[0]) : undefined;
      const c = f ? f.transform.position : { x: 0, y: 0, z: 0 };
      box.set(new THREE.Vector3(c.x - 40, c.y - 40, c.z), new THREE.Vector3(c.x + 40, c.y + 40, c.z + 20));
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov ?? 38);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (cam.aspect ?? 1));
    const dist = Math.max(60, (size / 2) / Math.tan(Math.min(vfov, hfov) / 2) * 1.05);
    const dir = new THREE.Vector3();
    if (preset === 'top') dir.set(0, -0.0001, 1);
    else if (preset === 'front') dir.set(0, -1, 0.0001);
    else if (preset === 'right') dir.set(1, 0, 0.0001);
    else if (preset === 'iso') dir.set(1, -1, 0.8);
    else dir.copy(camera.position).sub(controls.current?.target ?? new THREE.Vector3());
    if (dir.lengthSq() < 1e-9) dir.set(1, -1, 0.8);
    camera.position.copy(center).addScaledVector(dir.normalize(), dist);
    camera.up.set(0, 0, 1);
    camera.lookAt(center);
    if (controls.current) { controls.current.target.copy(center); controls.current.update(); }
    useViewStore.setState({ preset: null });
  }, [fitToken, preset, camera, controls]);
  return null;
}

/** Drives a push/pull drag from window pointer events and draws the arrow + value. */
function PushPullHandler() {
  const { camera, gl } = useThree();
  const drag = usePushPull((s) => s.drag);
  const press = usePushPull((s) => s.press);
  const colors = useThemeColors();
  useEffect(() => {
    if (!drag && !press) return;
    const ray = new THREE.Raycaster();
    const onMove = (ev: PointerEvent) => {
      const pp = usePushPull.getState();
      if (pp.press && !pp.drag) {
        // a press turns into a drag once the pointer has really moved
        if (Math.hypot(ev.clientX - pp.press.x, ev.clientY - pp.press.y) < 4) return;
        const pr = pp.press;
        usePushPull.setState({ press: null });
        if (!pp.begin(pr.partId, pr.faceIndex, pr.point, pr.ray)) return;
      }
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      usePushPull.getState().move([ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z], [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z]);
    };
    const onUp = () => {
      const pp = usePushPull.getState();
      if (pp.press && !pp.drag) {
        // a click: keep the face, show the handle, take a typed distance
        const pr = pp.press;
        usePushPull.setState({ press: null });
        pp.pick(pr.partId, pr.faceIndex);
        return;
      }
      pp.end();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
  }, [drag?.featureId, press, camera, gl]);
  if (!drag) return null;
  const o = new THREE.Vector3(...drag.origin), n = new THREE.Vector3(...drag.normal);
  const tip = o.clone().addScaledVector(n, drag.distance);
  const far = o.clone().addScaledVector(n, 400), near = o.clone().addScaledVector(n, -400);
  return (
    <group>
      <Line points={[near, far]} color={colors.accent} lineWidth={1} dashed dashSize={2} gapSize={2} transparent opacity={0.5} />
      <Line points={[o, tip]} color={colors.accent} lineWidth={3} />
      <mesh position={tip}><sphereGeometry args={[1.2, 12, 12]} /><meshBasicMaterial color={colors.accent} depthTest={false} /></mesh>
      <Html position={tip} style={{ pointerEvents: 'none', transform: 'translate(14px, -14px)' }}>
        <div className="sketch-label">{drag.distance >= 0 ? '+' : '−'}{Math.abs(drag.distance).toFixed(1)} mm · {drag.distance >= 0 ? 'pull' : 'push'}</div>
      </Html>
    </group>
  );
}

/** Drives a plate drag (sliding selected parts) from window pointer events. */
function PlateDragHandler() {
  const { camera, gl } = useThree();
  const drag = useDrag((s) => s.drag);
  useEffect(() => {
    if (!drag) return;
    const ray = new THREE.Raycaster();
    const onMove = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      useDrag.getState().move([ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z], [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z], ev.shiftKey ? 10 : 1);
    };
    const onUp = () => useDrag.getState().end();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
  }, [drag, camera, gl]);
  return null;
}

/**
 * Handle on a clicked face in the Push / Pull tool: an arrow along the
 * normal you can drag, and a chip that takes a typed distance (Enter
 * applies, negative cuts).
 */
function FaceHandle() {
  const pending = usePushPull((s) => s.pending);
  const typed = usePushPull((s) => s.typed);
  const colors = useThemeColors();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (pending) requestAnimationFrame(() => inputRef.current?.focus()); }, [pending]);
  if (!pending) return null;
  const o = new THREE.Vector3(...pending.origin), n = new THREE.Vector3(...pending.normal);
  const tip = o.clone().addScaledVector(n, 14);
  const apply = () => usePushPull.getState().commitTyped();
  return (
    <group>
      <Line points={[o, tip]} color={colors.accent} lineWidth={3} depthTest={false} />
      <mesh position={tip} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const ray = { origin: [e.ray.origin.x, e.ray.origin.y, e.ray.origin.z] as [number, number, number], dir: [e.ray.direction.x, e.ray.direction.y, e.ray.direction.z] as [number, number, number] };
          usePushPull.getState().begin(pending.partId, pending.faceIndex, pending.origin, ray);
        }}>
        <coneGeometry args={[2.2, 6, 16]} />
        <meshBasicMaterial color={colors.accent} depthTest={false} />
      </mesh>
      <Html position={tip} style={{ transform: 'translate(16px, -16px)' }} zIndexRange={[30, 0]}>
        <form className="face-chip" onSubmit={(e) => { e.preventDefault(); apply(); }} onPointerDown={(e) => e.stopPropagation()}>
          <input ref={inputRef} className="dim-input" value={typed} placeholder="mm" inputMode="decimal"
            onChange={(e) => usePushPull.setState({ typed: e.target.value.replace(/[^0-9.\-]/g, '').slice(0, 8) })}
            onKeyDown={(e) => { if (e.key === 'Escape') { usePushPull.setState({ pending: null, typed: '' }); } e.stopPropagation(); }} />
          <small>type a distance, Enter · negative cuts · or drag the arrow</small>
        </form>
      </Html>
    </group>
  );
}

/** Invisible ground: remembers where the pointer is (new parts land there) and opens the radial menu on right-click / long-press. */
function GroundPlane() {
  const lp = useMemo(() => longPress(() => { const h = pending.current; if (h) useMenu.getState().show(h.x, h.y, { point: h.point, normal: [0, 0, 1] }); }), []);
  const pending = useRef<{ x: number; y: number; point: [number, number, number] } | null>(null);
  return (
    <mesh position={[0, 0, -0.01]}
      onPointerMove={(e) => {
        if (!useSketch.getState().active) useViewStore.getState().setGround([e.point.x, e.point.y]);
        lp.move(e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      onPointerDown={(e) => {
        if (useSketch.getState().active) return;
        pending.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, point: [e.point.x, e.point.y, 0] };
        if (e.nativeEvent.pointerType === 'touch') lp.start(e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      onPointerUp={() => lp.cancel()}
      onClick={(e) => { if (useSketch.getState().pickingFace && e.button === 0 && (e.delta ?? 0) < 4) { e.stopPropagation(); useSketch.getState().createAndStartAt([e.point.x, e.point.y, 0]); } }}
      onContextMenu={(e) => { if (useSketch.getState().active) return; e.nativeEvent.preventDefault(); useMenu.getState().show(e.nativeEvent.clientX, e.nativeEvent.clientY, { point: [e.point.x, e.point.y, 0], normal: [0, 0, 1] }); }}>
      <planeGeometry args={[6000, 6000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Pointer cursor: grab on a draggable flat face, crosshair while picking. */
function CursorFeedback() {
  const { gl } = useThree();
  const hoverFace = useHover((h) => !!h.hover?.face);
  const hoverPart = useHover((h) => !!h.hover);
  const picking = useSketch((s) => s.pickingFace);
  const tool = useTool((s) => s.tool);
  const dragging = usePushPull((s) => !!s.drag);
  const sliding = useDrag((s) => !!s.drag);
  useEffect(() => {
    gl.domElement.style.cursor = dragging || sliding ? 'grabbing' : picking ? 'crosshair' : tool === 'pushpull' ? (hoverFace ? 'ns-resize' : 'crosshair') : hoverPart && (tool === 'select' || tool === 'move') ? 'grab' : '';
  }, [gl, hoverFace, hoverPart, picking, tool, dragging, sliding]);
  return null;
}

function Scene() {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const showGrid = useStore((s) => s.showGrid);
  const wireframe = useStore((s) => s.wireframe);
  const printLook = useStore((s) => s.printLook);
  const sketching = useSketch((s) => s.active?.featureId ?? null);
  const pickingFace = useSketch((s) => s.pickingFace);
  const pushDragging = usePushPull((s) => !!s.drag);
  const pushPressed = usePushPull((s) => !!s.press);
  const plateDragging = useDrag((s) => !!s.drag);
  const tool = useTool((s) => s.tool);
  const colors = useThemeColors();
  const controls = useRef<OrbitControlsImpl | null>(null);
  const viewDoc = useStore((s) => s.viewDoc);
  const parts = useMemo(() => topLevel(viewDoc).filter((f) => f.visible), [viewDoc]);
  const primary = selection.length ? parts.find((f) => f.id === selection[selection.length - 1]) : undefined;

  return (
    <>
      <color attach="background" args={[colors.vp]} />
      <hemisphereLight args={['#ffffff', '#3b4553', printLook ? 0.25 : 0.55]} />
      {printLook && <directionalLight position={[220, 60, 140]} intensity={1.6} />}
      <directionalLight position={[120, -90, 200]} intensity={printLook ? 0.6 : 1.1} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-200} shadow-camera-right={200} shadow-camera-top={200} shadow-camera-bottom={-200} shadow-camera-far={800} shadow-bias={-0.0005} />
      <directionalLight position={[-150, 120, 80]} intensity={0.35} />
      {showGrid && <Grid args={[400, 400]} cellSize={1} cellThickness={0.6} cellColor={colors.gridMinor} sectionSize={10} sectionThickness={1} sectionColor={colors.gridMajor} rotation={[Math.PI / 2, 0, 0]} fadeDistance={700} fadeStrength={1} infiniteGrid />}
      {parts.map((f) => (
        <Part key={f.id} feature={f} result={results.get(f.id)} selected={selection.includes(f.id)} colors={colors} wireframe={wireframe} printLook={printLook} ghost={sketching === f.id} picking={pickingFace}
          onSelect={(e) => { if (sketching) return; e.stopPropagation(); select([f.id], e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace'); }} />
      ))}
      {primary && !sketching && (tool === 'move' || tool === 'rotate') && <SelectionGizmo key={primary.id + tool} primary={primary} mode={tool === 'move' ? 'translate' : 'rotate'} />}
      <SketchLayer colors={colors} />
      <PushPullHandler />
      <FaceHandle />
      <PlateDragHandler />
      <CursorFeedback />
      <GroundPlane />
      <OrbitControls ref={controls} makeDefault enabled={!pushDragging && !plateDragging && !pushPressed} enableDamping dampingFactor={0.12} minDistance={10} maxDistance={3000} maxPolarAngle={sketching ? Math.PI : Math.PI / 2 + 0.25}
        mouseButtons={sketching ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE } : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />
      <GizmoHelper alignment="bottom-right" margin={[70, 110]}>
        <GizmoViewport axisColors={['#e0574f', '#5fb37a', '#6ea0ff']} labelColor="white" />
      </GizmoHelper>
      <ViewController controls={controls} />
    </>
  );
}

export function Viewport() {
  const clearSelection = useStore((s) => s.clearSelection);
  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 2]}
      camera={{ position: [170, -170, 130], up: [0, 0, 1], fov: 38, near: 0.5, far: 6000 }}
      onCreated={({ camera }) => { camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0); }}
      onPointerMissed={(e) => { if (!useSketch.getState().active && e.button === 0 && !edgeJustClicked() && !usePushPull.getState().justDragged() && !useDrag.getState().justDragged()) { useEdges.getState().clear(); usePushPull.setState({ pending: null, typed: '' }); clearSelection(); } }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <Scene />
    </Canvas>
  );
}
