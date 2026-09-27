/**
 * Feature → Manifold. Every builder returns a fresh Manifold in the feature's
 * authoring frame (base on Z=0, footprint centred). Callers own the result and
 * must delete() it.
 */
import type { Manifold, ManifoldToplevel, Mesh } from 'manifold-3d';
import type { Feature, FeatureOf, Modifiers, Vec2 } from '../document/types.js';
import { chaikin, ensureCCW, profileContours } from './profile.js';
import { sketchToProfiles } from '../sketch/sketch.js';
import { dispose } from './manifold.js';

export class BuildError extends Error {
  constructor(message: string, public readonly featureId: string) { super(message); }
}

const deg2rad = Math.PI / 180;

export function buildPrimitive(wasm: ManifoldToplevel, f: Exclude<Feature, FeatureOf<'combine'> | FeatureOf<'module'>>): Manifold {
  const { Manifold, CrossSection } = wasm;
  let m: Manifold;
  switch (f.type) {
    case 'box':
      m = Manifold.cube([f.width, f.depth, f.height], true).translate([0, 0, f.height / 2]);
      break;
    case 'cylinder':
      m = Manifold.cylinder(f.height, f.radius, f.radius, f.segments);
      break;
    case 'cone':
      m = Manifold.cylinder(f.height, f.radiusBottom, Math.max(0, f.radiusTop), f.segments);
      break;
    case 'sphere':
      m = Manifold.sphere(f.radius, f.segments).translate([0, 0, f.radius]);
      break;
    case 'torus': {
      const cs = CrossSection.circle(f.tubeRadius, Math.max(8, Math.round(f.segments / 2))).translate([f.ringRadius, 0]);
      m = cs.revolve(f.segments).translate([0, 0, f.tubeRadius]);
      dispose(cs);
      break;
    }
    case 'tube': {
      const inner = Math.min(f.innerRadius, f.radius - 0.05);
      const outer = Manifold.cylinder(f.height, f.radius, f.radius, f.segments);
      const bore = Manifold.cylinder(f.height + 2, inner, inner, f.segments).translate([0, 0, -1]);
      m = Manifold.difference(outer, bore);
      dispose(outer, bore);
      break;
    }
    case 'extrude': {
      const profiles = f.sketch ? sketchToProfiles(f.sketch).profiles : f.profile ? [f.profile] : [];
      if (profiles.length === 0) throw new BuildError(f.sketch ? 'Sketch has no closed outline yet' : 'Extrusion has no outline', f.id);
      const cs = new CrossSection(profiles.flatMap(profileContours), 'Positive');
      const divisions = f.twist !== 0 ? Math.max(1, Math.round(Math.abs(f.twist) / 5)) : 0;
      m = cs.extrude(f.height, divisions, f.twist, [f.scaleTop, f.scaleTop]);
      dispose(cs);
      break;
    }
    case 'revolve': {
      m = Manifold.revolve([revolveProfile(f)], f.segments);
      break;
    }
    case 'mesh': {
      const mesh = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(f.positions), triVerts: sequentialIndices(f.positions.length / 3) });
      mesh.merge();
      try {
        m = Manifold.ofMesh(mesh);
      } catch (e) {
        throw new BuildError(`Mesh is not watertight: ${(e as Error).message}`, f.id);
      }
      if (f.scale !== 1) { const s = m.scale([f.scale, f.scale, f.scale]); dispose(m); m = s; }
      break;
    }
    default: {
      const never: never = f;
      throw new Error(`Unknown feature ${(never as Feature).type}`);
    }
  }
  if (m.isEmpty()) throw new BuildError('Shape is empty (check the dimensions)', f.id);
  return applyModifiers(m, f.modifiers);
}

function sequentialIndices(n: number): Uint32Array {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/** Closed CCW polygon (x = radius, y = height) for Manifold.revolve. */
export function revolveProfile(f: FeatureOf<'revolve'>): Vec2[] {
  const side = chaikin(f.profile, f.smoothing).map(([r, t]): Vec2 => [Math.max(0.01, r), t * f.height]);
  const pts: Vec2[] = [[0, 0], ...side];
  if (f.wall > 0) {
    const floor = Math.min(f.floor, f.height - 0.5);
    const top = side[side.length - 1]!;
    const inner = side.filter(([, y]) => y >= floor).map(([r, y]): Vec2 => [Math.max(0.01, r - f.wall), y]).reverse();
    if (inner.length > 0) {
      pts.push([Math.max(0.01, top[0] - f.wall), top[1]]);
      pts.push(...inner);
      pts.push([Math.max(0.01, inner[inner.length - 1]![0]), floor]);
      pts.push([0, floor]);
    } else pts.push([0, f.height]);
  } else pts.push([0, f.height]);
  return ensureCCW(pts);
}

const hasMods = (m: Modifiers) => m.twist !== 0 || m.taper !== 0 || m.rippleAmplitude !== 0 || m.grooveAmplitude !== 0;

/** Non-destructive surface modifiers via Manifold.warp; refines the mesh first so curves can bend. */
export function applyModifiers(m: Manifold, mods: Modifiers): Manifold {
  if (!hasMods(mods)) return m;
  const box = m.boundingBox();
  const z0 = box.min[2], h = Math.max(1e-6, box.max[2] - z0);
  const radius = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) / 2;
  // edge length that keeps curvature smooth without exploding the triangle count
  const targetEdge = Math.max(0.6, Math.min(h, radius * 2) / 40);
  const refined = m.refineToLength(targetEdge);
  dispose(m);
  const twist = mods.twist * deg2rad, taper = mods.taper / 100;
  const warped = refined.warp((v) => {
    const x = v[0], y = v[1], z = v[2];
    const t = (z - z0) / h;
    let r = Math.hypot(x, y);
    if (r < 1e-9) return;
    let a = Math.atan2(y, x);
    r *= 1 + taper * t;
    if (mods.rippleAmplitude) r += mods.rippleAmplitude * Math.sin(t * mods.rippleWaves * Math.PI * 2);
    if (mods.grooveAmplitude) r += mods.grooveAmplitude * 0.5 * (1 + Math.cos(a * mods.grooveCount));
    a += twist * t;
    v[0] = Math.cos(a) * r;
    v[1] = Math.sin(a) * r;
  });
  dispose(refined);
  return warped;
}

/** Apply a feature's transform (rotation XYZ degrees, then translation). Returns a new Manifold. */
export function placed(m: Manifold, f: Feature): Manifold {
  const { rotation: r, position: p } = f.transform;
  let out = m;
  if (r.x || r.y || r.z) { const t = out.rotate([r.x, r.y, r.z]); if (out !== m) dispose(out); out = t; }
  if (p.x || p.y || p.z) { const t = out.translate([p.x, p.y, p.z]); if (out !== m) dispose(out); out = t; }
  return out === m ? m.translate([0, 0, 0]) : out;
}

export type ManifoldMesh = Mesh;
