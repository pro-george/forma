import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import type { LampMesh } from './geometry';
import type { Swatch } from './config';

/**
 * The lamp on a soft floor. Geometry comes from Forma in mm, Z up; the scene is
 * three.js Y up, so the shade geometry is rotated once when it is built.
 * Legs and bases are visual only: they are standard Artea parts, not printed
 * from the design.
 */

/** The bits of drei's OrbitControls we drive by hand. */
type OrbitControlsImpl = { target: THREE.Vector3; update(): void; autoRotate: boolean };

const SUPPORT_HEIGHT: Record<string, number> = { tulip: 110, oli: 70, lumi: 70, cloud: 46, onda: 52 };

function toGeometry(m: LampMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  if (m.normals.length === m.positions.length && m.normals.length > 0) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.rotateX(-Math.PI / 2);
  g.computeBoundingSphere();
  return g;
}

function Leg({ from, to, radius, color }: { from: THREE.Vector3; to: THREE.Vector3; radius: number; color: string }) {
  const { pos, quat, len } = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(from, to);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { pos: new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), quat: q, len: dir.length() };
  }, [from, to]);
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[radius, radius * 0.8, len, 20]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
  );
}

function Support({ family, topRadius, color }: { family: string; topRadius: number; color: string }) {
  const h = SUPPORT_HEIGHT[family] ?? 60;
  if (family === 'tulip' || family === 'oli' || family === 'lumi') {
    const n = family === 'tulip' ? 3 : 4;
    const top = Math.max(14, topRadius * (family === 'tulip' ? 0.35 : 0.72));
    const foot = family === 'tulip' ? Math.max(top + 40, topRadius * 1.05) : top * 1.18;
    const legs = Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2 + Math.PI / 6;
      return { from: new THREE.Vector3(Math.cos(a) * top, h + 4, Math.sin(a) * top), to: new THREE.Vector3(Math.cos(a) * foot, 0, Math.sin(a) * foot) };
    });
    return (
      <group>
        {legs.map((l, k) => <Leg key={k} from={l.from} to={l.to} radius={family === 'tulip' ? 4 : 6} color={color} />)}
        <mesh position={[0, h + 2, 0]} castShadow>
          <cylinderGeometry args={[top + 3, top + 3, 4, 40]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
      </group>
    );
  }
  // pedestal bases: Cloud (smooth stem) and Onda (ribbed)
  const r = family === 'cloud' ? 20 : Math.min(32, Math.max(22, topRadius * 0.5));
  return (
    <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[r, r, h, family === 'onda' ? 28 : 48]} />
      <meshStandardMaterial color={color} roughness={family === 'onda' ? 0.75 : 0.5} flatShading={family === 'onda'} />
    </mesh>
  );
}

function Shade({ mesh, shade, lit, lift }: { mesh: LampMesh; shade: Swatch; lit: boolean; lift: number }) {
  const geometry = useMemo(() => toGeometry(mesh), [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const glow = shade.translucent ? 0.55 : 0.28;
  return (
    <mesh geometry={geometry} position={[0, lift, 0]} castShadow receiveShadow>
      <meshPhysicalMaterial
        color={shade.hex}
        roughness={0.62}
        sheen={0.4}
        sheenColor="#ffffff"
        side={THREE.FrontSide}
        transmission={shade.translucent && !lit ? 0.35 : 0}
        thickness={1.6}
        emissive={lit ? '#ff9f43' : '#000000'}
        emissiveIntensity={lit ? glow : 0}
      />
    </mesh>
  );
}

function Fit({ height, width }: { height: number; width: number }) {
  const { camera, size } = useThree();
  const last = useRef({ h: 0, w: 0, a: 0 });
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const prev = last.current;
    if (prev.h && Math.abs(height - prev.h) < 40 && Math.abs(width - prev.w) < 40 && Math.abs(aspect - prev.a) < 0.2) return; // keep the user's framing for small changes
    last.current = { h: height, w: width, a: aspect };
    const persp = camera as THREE.PerspectiveCamera;
    const vHalf = THREE.MathUtils.degToRad(persp.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const margin = 1.35;
    const dist = Math.max((height * margin) / (2 * Math.tan(vHalf)), (width * margin) / (2 * Math.tan(hHalf))) + width * 0.5;
    const dir = new THREE.Vector3(0.55, 0.3, 0.85).normalize();
    camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, height * 0.45, 0));
  }, [height, width, camera, size.width, size.height]);
  return null;
}

function Turntable({ enabled, controls }: { enabled: boolean; controls: React.RefObject<OrbitControlsImpl | null> }) {
  useFrame(() => { if (controls.current) controls.current.autoRotate = enabled; });
  return null;
}

export function Viewport({ mesh, family, width, shade, base, lit, spinning, onInteract }: {
  mesh: LampMesh | null; family: string; width: number; shade: Swatch; base: Swatch; lit: boolean; spinning: boolean; onInteract: () => void;
}) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const lift = SUPPORT_HEIGHT[family] ?? 60;
  const total = (mesh?.height ?? 200) + lift;
  const bulbY = lift + 34;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 32, near: 5, far: 6000, position: [300, 300, 500] }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerDown={onInteract}
      aria-label="Previzualizare 3D a lămpii"
    >
      <color attach="background" args={[lit ? '#16110d' : '#f5eee6']} />
      <fog attach="fog" args={[lit ? '#16110d' : '#f5eee6', 900, 2600]} />
      <hemisphereLight args={[lit ? '#6b4a2c' : '#ffffff', lit ? '#120d09' : '#e9dccb', lit ? 0.55 : 1.1]} />
      {!lit && <directionalLight position={[260, 520, 300]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={1.2} shadow-camera-left={-300} shadow-camera-right={300} shadow-camera-top={500} shadow-camera-bottom={-100} />}
      {lit && <pointLight position={[0, bulbY, 0]} color="#ffb35c" intensity={9} distance={1400} decay={1.1} castShadow shadow-bias={-0.002} shadow-normalBias={1.5} />}
      {lit && <directionalLight position={[-300, 400, 500]} intensity={0.35} color="#ffd9b0" />}
      {lit && (
        <mesh position={[0, bulbY, 0]}>
          <sphereGeometry args={[16, 24, 24]} />
          <meshBasicMaterial color="#fff2d8" />
        </mesh>
      )}
      <group>
        {mesh && !mesh.error && <Shade mesh={mesh} shade={shade} lit={lit} lift={lift} />}
        <Support family={family} topRadius={mesh?.bottomRadius ?? 40} color={base.hex} />
      </group>
      <ContactShadows position={[0, 0.2, 0]} scale={900} far={400} blur={2.6} opacity={lit ? 0.65 : 0.4} color={lit ? '#000000' : '#5a4a36'} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1400, 64]} />
        <meshStandardMaterial color={lit ? '#1a140f' : '#efe6da'} roughness={1} />
      </mesh>
      <OrbitControls ref={controls as never} target={[0, total * 0.45, 0]} makeDefault enableDamping dampingFactor={0.1} enablePan={false} minDistance={220} maxDistance={2200} minPolarAngle={0.2} maxPolarAngle={Math.PI / 2 - 0.04} autoRotateSpeed={0.9} />
      <Fit height={total} width={width + 40} />
      <Turntable enabled={spinning} controls={controls} />
    </Canvas>
  );
}
