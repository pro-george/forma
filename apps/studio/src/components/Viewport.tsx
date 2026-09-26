import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, TransformControls, Edges, Line } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { create } from 'zustand';
import { topLevel, type EvaluatedFeature, type Feature } from '@forma/core';
import { useStore } from '../state/store';

/** View commands from outside the canvas (toolbar, keyboard). */
export const useViewStore = create<{ fitToken: number; preset: 'iso' | 'top' | 'front' | 'right' | null; gizmoMode: 'translate' | 'rotate'; fit(): void; setPreset(p: 'iso' | 'top' | 'front' | 'right'): void; setGizmoMode(m: 'translate' | 'rotate'): void }>((set) => ({
  fitToken: 0, preset: null, gizmoMode: 'translate',
  fit: () => set((s) => ({ fitToken: s.fitToken + 1 })),
  setPreset: (preset) => set((s) => ({ preset, fitToken: s.fitToken + 1 })),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
}));

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

function Part({ feature, result, selected, colors, wireframe, onSelect }: {
  feature: Feature; result: EvaluatedFeature | undefined; selected: boolean; colors: ReturnType<typeof useThemeColors>; wireframe: boolean;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const geometry = useMemo(() => (result ? toGeometry(result.mesh) : null), [result]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const t = feature.transform;
  const isHole = feature.role === 'hole';
  const hasError = !!result?.error;
  return (
    <group position={[t.position.x, t.position.y, t.position.z]} rotation={[deg(t.rotation.x), deg(t.rotation.y), deg(t.rotation.z)]}>
      {geometry && (geometry.attributes.position?.count ?? 0) > 0 && (
        <mesh geometry={geometry} onClick={onSelect} castShadow receiveShadow userData={{ id: feature.id }}>
          <meshStandardMaterial
            color={isHole ? colors.hole : colors.solid}
            emissive={selected ? colors.accent : '#000000'}
            emissiveIntensity={selected ? 0.12 : 0}
            roughness={0.55} metalness={0.12}
            transparent={isHole} opacity={isHole ? 0.42 : 1} depthWrite={!isHole}
            wireframe={wireframe}
          />
          {selected && <Edges threshold={28} color={colors.accent} lineWidth={1} />}
        </mesh>
      )}
      {hasError && (
        <mesh onClick={onSelect}>
          <boxGeometry args={[10, 10, 10]} />
          <meshBasicMaterial color={colors.hole} wireframe />
        </mesh>
      )}
    </group>
  );
}

/** Gizmo attached to a proxy object at the primary selection; moves all selected top-level parts. */
function SelectionGizmo({ primary, mode }: { primary: Feature; mode: 'translate' | 'rotate' }) {
  const proxy = useRef<THREE.Group>(null!);
  const startRef = useRef<{ pos: THREE.Vector3; rot: THREE.Euler; others: { id: string; t: Feature['transform'] }[] } | null>(null);
  const { beginGesture, endGesture } = useStore.getState();
  const t = primary.transform;
  useEffect(() => {
    proxy.current.position.set(t.position.x, t.position.y, t.position.z);
    proxy.current.rotation.set(deg(t.rotation.x), deg(t.rotation.y), deg(t.rotation.z));
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
      size={0.8}
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

function SketchLayer() {
  const tool = useStore((s) => s.tool);
  const pts = useStore((s) => s.sketchPoints);
  const addSketchPoint = useStore((s) => s.addSketchPoint);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const colors = useThemeColors();
  if (tool !== 'sketch') return null;
  const snap = (v: number) => Math.round(v);
  const line: [number, number, number][] = pts.map(([x, y]) => [x, y, 0.05]);
  if (cursor) line.push([cursor[0], cursor[1], 0.05]);
  if (pts.length >= 2) line.push([pts[0]![0], pts[0]![1], 0.05]);
  return (
    <group>
      <mesh
        position={[0, 0, 0]}
        onPointerMove={(e) => { e.stopPropagation(); setCursor([snap(e.point.x), snap(e.point.y)]); }}
        onClick={(e) => { e.stopPropagation(); addSketchPoint([snap(e.point.x), snap(e.point.y)]); }}
        onDoubleClick={(e) => { e.stopPropagation(); useStore.getState().finishSketch(); }}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {line.length >= 2 && <Line points={line} color={colors.accent} lineWidth={1.5} />}
      {pts.map((p, i) => (
        <mesh key={i} position={[p[0], p[1], 0.1]}>
          <circleGeometry args={[0.9, 16]} />
          <meshBasicMaterial color={colors.accent} />
        </mesh>
      ))}
      {cursor && (
        <mesh position={[cursor[0], cursor[1], 0.1]}>
          <ringGeometry args={[0.7, 1, 16]} />
          <meshBasicMaterial color={colors.accent} />
        </mesh>
      )}
    </group>
  );
}

function ViewController({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const fitToken = useViewStore((s) => s.fitToken);
  const preset = useViewStore((s) => s.preset);
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
        new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(f.transform.rotation.x), deg(f.transform.rotation.y), deg(f.transform.rotation.z))),
        new THREE.Vector3(1, 1, 1),
      );
      const b = new THREE.Box3(new THREE.Vector3(r.bbox.min.x, r.bbox.min.y, r.bbox.min.z), new THREE.Vector3(r.bbox.max.x, r.bbox.max.y, r.bbox.max.z)).applyMatrix4(m);
      box.union(b);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 30));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = Math.max(60, size * 1.25);
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

function Scene() {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const showGrid = useStore((s) => s.showGrid);
  const wireframe = useStore((s) => s.wireframe);
  const tool = useStore((s) => s.tool);
  const gizmoMode = useViewStore((s) => s.gizmoMode);
  const colors = useThemeColors();
  const controls = useRef<OrbitControlsImpl | null>(null);
  const parts = useMemo(() => topLevel(doc).filter((f) => f.visible), [doc]);
  const primary = selection.length ? parts.find((f) => f.id === selection[selection.length - 1]) : undefined;

  return (
    <>
      <color attach="background" args={[colors.vp]} />
      <hemisphereLight args={['#ffffff', '#3b4553', 0.55]} />
      <directionalLight position={[120, -90, 200]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-200} shadow-camera-right={200} shadow-camera-top={200} shadow-camera-bottom={-200} shadow-camera-far={800} shadow-bias={-0.0005} />
      <directionalLight position={[-150, 120, 80]} intensity={0.35} />
      {showGrid && <Grid args={[400, 400]} cellSize={1} cellThickness={0.6} cellColor={colors.gridMinor} sectionSize={10} sectionThickness={1} sectionColor={colors.gridMajor} rotation={[Math.PI / 2, 0, 0]} fadeDistance={700} fadeStrength={1} infiniteGrid />}
      {parts.map((f) => (
        <Part key={f.id} feature={f} result={results.get(f.id)} selected={selection.includes(f.id)} colors={colors} wireframe={wireframe}
          onSelect={(e) => { if (tool !== 'select') return; e.stopPropagation(); select([f.id], e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace'); }} />
      ))}
      {primary && tool === 'select' && <SelectionGizmo key={primary.id + gizmoMode} primary={primary} mode={gizmoMode} />}
      <SketchLayer />
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minDistance={10} maxDistance={3000} maxPolarAngle={Math.PI / 2 + 0.25} />
      <GizmoHelper alignment="bottom-right" margin={[70, 110]}>
        <GizmoViewport axisColors={['#e0574f', '#5fb37a', '#6ea0ff']} labelColor="white" />
      </GizmoHelper>
      <ViewController controls={controls} />
    </>
  );
}

export function Viewport() {
  const clearSelection = useStore((s) => s.clearSelection);
  const tool = useStore((s) => s.tool);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [170, -170, 130], up: [0, 0, 1], fov: 38, near: 0.5, far: 6000 }}
      onCreated={({ camera }) => { camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0); }}
      onPointerMissed={(e) => { if (tool === 'select' && e.button === 0) clearSelection(); }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <Scene />
    </Canvas>
  );
}
