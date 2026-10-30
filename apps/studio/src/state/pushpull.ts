/**
 * Push / pull: tap a flat face, drag along its normal. Pulling outward adds
 * material, pushing inward cuts. The face outline becomes an extrude feature
 * on a plane at the face, inside the part's combine, so the result stays
 * parametric: the height is a number you can edit afterwards.
 */
import { create } from 'zustand';
import * as THREE from 'three';
import { addFeature, addToCombine, combine as combineDoc, featureById, makeFeature, planarFace, removeFeatures, ensureCCW, ensureCW, insetPolygon, type FeatureOf, type FormaDocument, type Profile, type Transform, type Vec2 } from '@forma/core';
import { useStore } from './store';
import { planeTransform } from './sketch';

export interface PushPullDrag {
  featureId: string;
  combineId: string;
  /** world-space anchor on the face and unit normal */
  origin: [number, number, number];
  normal: [number, number, number];
  /** signed distance along the normal so far (mm) */
  distance: number;
  /** line parameter of the press point, so the drag starts at 0 */
  t0: number | null;
  /** the face outline as measured; cuts use a copy grown by EPS so no wall is coplanar with the part */
  profile: Profile;
  docBefore: FormaDocument;
}

interface PushPullState {
  armed: boolean;
  drag: PushPullDrag | null;
  /** a press on a flat face that has not moved yet: becomes a drag after a few pixels, or a pick on release */
  press: { partId: string; faceIndex: number; point: [number, number, number]; ray: { origin: [number, number, number]; dir: [number, number, number] }; x: number; y: number } | null;
  pressAt(partId: string, faceIndex: number, point: [number, number, number], ray: { origin: [number, number, number]; dir: [number, number, number] }, x: number, y: number): boolean;
  /** a flat face that was clicked (not dragged): shows a handle and takes a typed distance */
  pending: { partId: string; faceIndex: number; origin: [number, number, number]; normal: [number, number, number] } | null;
  typed: string;
  arm(): void;
  disarm(): void;
  /** Remember a clicked face; `point` is the hit in world space. Returns false if the face is not flat. */
  pick(partId: string, faceIndex: number): boolean;
  typeChar(c: string): void;
  /** Apply the typed distance to the pending face (Enter). */
  commitTyped(): void;
  /** Push or pull `faceIndex` of `partId` by a signed distance in one step. */
  applyDistance(partId: string, faceIndex: number, distance: number): void;
  /** Start on a part face: `faceIndex` is the triangle hit, `point` the hit in world space. Returns false if the face is not flat. */
  begin(partId: string, faceIndex: number, point: [number, number, number], ray?: { origin: [number, number, number]; dir: [number, number, number] }): boolean;
  /** Pointer ray in world space (camera origin + direction). */
  move(rayOrigin: [number, number, number], rayDir: [number, number, number]): void;
  /** Set the signed distance of the running drag directly (mm). */
  setDistance(dist: number): void;
  end(): void;
  /** true for the click event that follows a real drag */
  justDragged(): boolean;
}

const MIN = 0.2;
/** cuts start this far outside the face and joins this far inside it, so booleans never fight a coplanar skin */
const EPS = 0.02;

let lastDragEnd = 0;
export const usePushPull = create<PushPullState>((set, get) => ({
  justDragged: () => performance.now() - lastDragEnd < 300,
  armed: false,
  drag: null,
  press: null,
  pending: null,
  typed: '',
  pressAt: (partId, faceIndex, point, ray, x, y) => {
    const st = useStore.getState();
    const result = st.results.get(partId);
    if (!result || result.error || !planarFace(result.mesh, faceIndex)) return false;
    set({ press: { partId, faceIndex, point, ray, x, y } });
    return true;
  },
  arm: () => set({ armed: true }),
  disarm: () => set({ armed: false, press: null, pending: null, typed: '' }),
  pick: (partId, faceIndex) => {
    const st = useStore.getState();
    const part = featureById(st.doc, partId);
    const result = st.results.get(partId);
    if (!part || !result || result.error) return false;
    const face = planarFace(result.mesh, faceIndex);
    if (!face) return false;
    const { mat } = frameOf(part.transform);
    const n = new THREE.Vector3(...face.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(mat)).normalize();
    const o = new THREE.Vector3(...face.origin).applyMatrix4(mat);
    set({ pending: { partId, faceIndex, origin: [o.x, o.y, o.z], normal: [n.x, n.y, n.z] }, typed: '' });
    return true;
  },
  typeChar: (c) => { if (!get().pending) return; if (/^[0-9.\-]$/.test(c)) set({ typed: (get().typed + c).slice(0, 8) }); },
  commitTyped: () => {
    const p = get().pending, v = parseFloat(get().typed);
    if (!p || !Number.isFinite(v) || v === 0) return;
    get().applyDistance(p.partId, p.faceIndex, v);
  },
  applyDistance: (partId, faceIndex, distance) => {
    if (!get().begin(partId, faceIndex, [0, 0, 0])) return;
    get().setDistance(Math.round(distance * 10) / 10);
    get().end();
    set({ pending: null, typed: '' });
  },
  begin: (partId, faceIndex, point, ray) => {
    const st = useStore.getState();
    const part = featureById(st.doc, partId);
    const result = st.results.get(partId);
    if (!part || !result || result.error) return false;
    const face = planarFace(result.mesh, faceIndex);
    if (!face) { st.toast('That face is not flat', 'error'); return false; }
    // part frame → world
    const t = part.transform;
    const mat = new THREE.Matrix4().compose(
      new THREE.Vector3(t.position.x, t.position.y, t.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(t.rotation.x), THREE.MathUtils.degToRad(t.rotation.y), THREE.MathUtils.degToRad(t.rotation.z), 'ZYX')),
      new THREE.Vector3(1, 1, 1),
    );
    const nm = new THREE.Matrix3().getNormalMatrix(mat);
    const n = new THREE.Vector3(...face.normal).applyMatrix3(nm).normalize();
    const originW = new THREE.Vector3(...face.origin).applyMatrix4(mat);
    const normal: [number, number, number] = [n.x, n.y, n.z];
    const origin: [number, number, number] = [originW.x, originW.y, originW.z];
    // sketch plane at the face; outline points expressed in that plane
    const planeT = planeTransform(origin, normal);
    const planeMat = new THREE.Matrix4().compose(
      new THREE.Vector3(planeT.position.x, planeT.position.y, planeT.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(planeT.rotation.x), THREE.MathUtils.degToRad(planeT.rotation.y), THREE.MathUtils.degToRad(planeT.rotation.z), 'ZYX')),
      new THREE.Vector3(1, 1, 1),
    ).invert();
    const to2d = (loop: [number, number, number][]): Vec2[] => loop.map(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).applyMatrix4(mat).applyMatrix4(planeMat); return [round(v.x), round(v.y)]; });
    const [outerLoop, ...holeLoops] = face.loops;
    const outer = ensureCCW(to2d(outerLoop!));
    const holes = holeLoops.map((h) => ensureCW(to2d(h)));
    if (outer.length < 3) return false;
    const f = makeFeature(st.doc, 'extrude', { profile: { outer, holes }, height: MIN + EPS, transform: shifted(planeT, normal, -EPS), name: `${part.name} face` });
    let doc = addFeature(st.doc, f);
    let combineId: string;
    if (part.type === 'combine') { combineId = part.id; doc = addToCombine(doc, combineId, f.id); }
    else if (part.parentId) { combineId = part.parentId; doc = addToCombine(doc, combineId, f.id); }
    else { const r = combineDoc(doc, [partId, f.id], part.name); doc = r.doc; combineId = r.combineId; }
    const docBefore = st.doc;
    st.beginGesture();
    st.setDoc(doc);
    st.select([f.id]);
    const drag: PushPullDrag = { featureId: f.id, combineId, origin, normal, distance: 0, t0: null, profile: { outer, holes }, docBefore };
    // anchor the drag where the user pressed, not at the face centre
    drag.t0 = ray ? lineParam(drag, ray.origin, ray.dir) : (point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1] + (point[2] - origin[2]) * normal[2];
    set({ drag, pending: null, typed: '' });
    return true;
  },
  move: (rayOrigin, rayDir) => {
    const d = get().drag; if (!d) return;
    const t = lineParam(d, rayOrigin, rayDir);
    if (t === null) return;
    if (d.t0 === null) { set({ drag: { ...d, t0: t } }); return; }
    get().setDistance(Math.round((t - d.t0) * 10) / 10);
  },
  setDistance: (dist) => {
    const d = get().drag; if (!d) return;
    if (dist === d.distance) return;
    const h = Math.max(MIN, Math.abs(dist)) + EPS;
    const cut = dist < 0;
    const st = useStore.getState();
    const f = featureById(st.doc, d.featureId);
    if (!f) return;
    const wasCut = f.type === 'extrude' && f.role === 'hole';
    const patch: Partial<FeatureOf<'extrude'>> = { height: h, flip: cut, role: cut ? 'hole' : 'solid', transform: shifted(planeTransform(d.origin, d.normal), d.normal, cut ? EPS : -EPS) };
    if (cut !== wasCut || d.distance === 0) patch.profile = cut ? grown(d.profile, EPS) : d.profile;
    st.patchFeature(d.featureId, patch, { undoable: false });
    set({ drag: { ...d, distance: dist } });
  },
  end: () => {
    const d = get().drag; if (!d) return;
    const st = useStore.getState();
    if (Math.abs(d.distance) < MIN) {
      // a tap, not a drag: leave nothing behind
      st.setDoc(d.docBefore);
      st.endGesture();
      st.select([]);
      set({ drag: null });
      return;
    }
    st.endGesture();
    lastDragEnd = performance.now();
    // keep the whole part selected so its faces stay draggable
    st.select([d.combineId]);
    set({ drag: null });
  },
}));

const round = (v: number) => Math.round(v * 1000) / 1000;

/** part frame → world matrix */
function frameOf(t: Transform) {
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(t.position.x, t.position.y, t.position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(t.rotation.x), THREE.MathUtils.degToRad(t.rotation.y), THREE.MathUtils.degToRad(t.rotation.z), 'ZYX')),
    new THREE.Vector3(1, 1, 1),
  );
  return { mat };
}

/** Outline grown outward by `by` mm (holes shrink), so a cut's walls sit just outside the part's own faces. */
function grown(p: Profile, by: number): Profile {
  return { outer: insetPolygon(p.outer, -by), holes: p.holes.map((h) => insetPolygon(h, -by)) };
}

/** The plane transform moved `by` mm along the normal (negative = into the part). */
function shifted(t: Transform, n: [number, number, number], by: number): Transform {
  return { ...t, position: { x: t.position.x + n[0] * by, y: t.position.y + n[1] * by, z: t.position.z + n[2] * by } };
}

/** Parameter along the normal line (through origin) of the point closest to the pointer ray. */
function lineParam(d: { origin: [number, number, number]; normal: [number, number, number] }, rayOrigin: [number, number, number], rayDir: [number, number, number]): number | null {
  const o = new THREE.Vector3(...d.origin), n = new THREE.Vector3(...d.normal);
  const c = new THREE.Vector3(...rayOrigin), r = new THREE.Vector3(...rayDir).normalize();
  const w0 = o.clone().sub(c);
  const a = n.dot(n), b = n.dot(r), c2 = r.dot(r), dd = n.dot(w0), e = r.dot(w0);
  const den = a * c2 - b * b;
  if (Math.abs(den) < 1e-9) return null;
  return (b * e - c2 * dd) / den;
}
export { removeFeatures };
