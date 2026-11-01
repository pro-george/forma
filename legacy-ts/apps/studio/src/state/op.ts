/**
 * Interactive operations — the Materializr model: an op is BEGUN from the
 * selection, shows a handle and a value, previews while you drag or type,
 * and only becomes a history step when you CONFIRM (Enter / ✓). Cancel
 * (Esc / ✗) leaves the model exactly as it was.
 *
 *   pushpull  a flat face (or, later, a sketch region) swept along its normal;
 *             positive adds material, negative cuts. Drag anywhere in the
 *             viewport while the arrow is up. Preview is a ghost prism — the
 *             real boolean runs once, at commit.
 *   edgeop    fillet or chamfer on the picked edges; handle at the first
 *             edge's midpoint pointing outward; value starts at 0, min 0.1 mm
 *             once dragged. Preview is the real feature set, applied as one
 *             gesture and restored on cancel.
 */
import { create } from 'zustand';
import * as THREE from 'three';
import { featureById, planarFace, sketchToProfiles, type Feature, type FormaDocument, type MeshEdge, type Vec2 } from '@forma/core';
import { useSketch } from './sketch';
import { useStore } from './store';
import { usePushPull } from './pushpull';
import { edgesFor, buildEdgeTools } from './edges';
import { useSel } from './sel';
import { planeTransform } from './plane';

type V3 = [number, number, number];

export interface PushPullOp {
  kind: 'pushpull';
  partId: string;
  /** -1 when the op pushes a sketch region (then `region` is set) */
  faceIndex: number;
  region?: { sketchId: string; index: number };
  /** world-space arrow frame */
  origin: V3;
  normal: V3;
  /** outline in the plane frame (mm), for the ghost prism */
  profile: { outer: Vec2[]; holes: Vec2[][] };
  planeMatrix: number[]; // THREE.Matrix4 elements, plane → world
  distance: number;
  symmetric: boolean;
  /** line parameter of the press point so a drag starts from the current value */
  t0: number | null;
  startDistance: number;
}

export interface EdgeOp {
  kind: 'edgeop';
  partId: string;
  indices: number[];
  tool: 'round' | 'chamfer';
  value: number;
  /** handle frame: midpoint of the first edge and the outward direction */
  origin: V3;
  out: V3;
  t0: number | null;
  startValue: number;
  docBefore: FormaDocument;
  /** the part and its edges as they were at begin — the preview rebuilds from these, never from live results */
  part: Feature;
  edges: MeshEdge[];
  previewTimer: number | null;
  previewed: boolean;
}

export type Op = PushPullOp | EdgeOp;

interface OpState {
  op: Op | null;
  /** true while the pointer drags the handle (orbit is suspended) */
  dragging: boolean;
  typed: string;
  beginPushPull(): boolean;
  /** Push a closed region of the active (or selected) sketch: the extrude's height, join or cut by sign. */
  beginRegionPush(): boolean;
  beginEdgeOp(tool: 'round' | 'chamfer'): boolean;
  setValue(v: number, exact?: boolean): void;
  setSymmetric(v: boolean): void;
  setTool(tool: 'round' | 'chamfer'): void;
  /** pointer ray in world space; grid step for snapping dragged values */
  dragStart(): void;
  dragMove(origin: V3, dir: V3, step: number): void;
  dragEnd(): void;
  confirm(): void;
  cancel(): void;
}

const MIN_EDGE = 0.1;

export const useOp = create<OpState>((set, get) => ({
  op: null,
  dragging: false,
  typed: '',

  beginPushPull: () => {
    const st = useStore.getState();
    const face = useSel.getState().faces[0];
    if (!face) { st.toast('Push/Pull: select a flat face first.'); return false; }
    const part = featureById(st.doc, face.partId);
    const result = st.results.get(face.partId);
    if (!part || !result || result.error) return false;
    const pf = planarFace(result.mesh, face.faceIndex);
    if (!pf) { st.toast("Can't push/pull a curved face — pick a flat one, or sketch on a plane and push the region."); return false; }
    const mat = frameMatrix(part.transform);
    const n = new THREE.Vector3(...pf.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(mat)).normalize();
    const o = new THREE.Vector3(...pf.origin).applyMatrix4(mat);
    const normal: V3 = [n.x, n.y, n.z], origin: V3 = [o.x, o.y, o.z];
    const planeT = planeTransform(origin, normal);
    const planeM = frameMatrix(planeT);
    const inv = planeM.clone().invert();
    const to2d = (loop: V3[]): Vec2[] => loop.map(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).applyMatrix4(mat).applyMatrix4(inv); return [v.x, v.y]; });
    const [outer, ...holes] = pf.loops;
    get().cancel();
    set({ op: { kind: 'pushpull', partId: face.partId, faceIndex: face.faceIndex, origin, normal, profile: { outer: to2d(outer!), holes: holes.map(to2d) }, planeMatrix: planeM.elements.slice(), distance: 0, symmetric: false, t0: null, startDistance: 0 }, typed: '' });
    return true;
  },

  beginRegionPush: () => {
    const st = useStore.getState();
    const r = useSel.getState().regions[0];
    if (!r) { st.toast('Push/Pull: click inside a closed region first.'); return false; }
    const f = featureById(st.doc, r.sketchId);
    if (!f || f.type !== 'extrude' || !f.sketch) return false;
    const pr = sketchToProfiles(f.sketch).profiles[r.index];
    if (!pr) { st.toast('That region is no longer closed.'); return false; }
    const mat = frameMatrix(f.transform);
    const n = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(mat)).normalize();
    const c = pr.outer.reduce((a, p) => [a[0] + p[0] / pr.outer.length, a[1] + p[1] / pr.outer.length], [0, 0]);
    const o = new THREE.Vector3(c[0], c[1], 0).applyMatrix4(mat);
    get().cancel();
    const host = useSketch.getState().host;
    const current = host ? (f.role === 'hole' ? -f.height : f.height) : f.flip ? -f.height : f.height;
    set({ op: { kind: 'pushpull', partId: f.id, faceIndex: -1, region: r, origin: [o.x, o.y, o.z], normal: [n.x, n.y, n.z], profile: { outer: pr.outer, holes: pr.holes }, planeMatrix: mat.elements.slice(), distance: Math.round(current * 10) / 10, symmetric: false, t0: null, startDistance: 0 }, typed: '' });
    return true;
  },

  beginEdgeOp: (tool) => {
    const st = useStore.getState();
    const picked = useSel.getState().edges;
    if (!picked.length) { st.toast(`${tool === 'round' ? 'Fillet' : 'Chamfer'}: click an edge first (Ctrl/⌘-click adds more).`); return false; }
    const partId = picked[0]!.partId;
    const indices = picked.filter((e) => e.partId === partId).map((e) => e.index);
    const part = featureById(st.doc, partId);
    const result = st.results.get(partId);
    if (!part || !result) return false;
    const edges = edgesFor(result.mesh);
    const e = edges[indices[0]!];
    if (!e) return false;
    const mat = frameMatrix(part.transform);
    const nm = new THREE.Matrix3().getNormalMatrix(mat);
    const mid = new THREE.Vector3((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2).applyMatrix4(mat);
    // outward = sum of the adjacent face normals, made perpendicular to the edge (EdgeOpController.cpp:98-150)
    const d = new THREE.Vector3(...e.dir).applyMatrix3(nm).normalize();
    const out = new THREE.Vector3(...e.nA).add(new THREE.Vector3(...e.nB)).applyMatrix3(nm);
    out.addScaledVector(d, -out.dot(d));
    if (out.lengthSq() < 1e-9) out.set(0, 0, 1);
    out.normalize();
    get().cancel();
    set({ op: { kind: 'edgeop', partId, indices, tool, value: 0, origin: [mid.x, mid.y, mid.z], out: [out.x, out.y, out.z], t0: null, startValue: 0, docBefore: st.doc, part, edges, previewTimer: null, previewed: false }, typed: '' });
    return true;
  },

  setValue: (v, exact = false) => {
    const op = get().op; if (!op) return;
    if (op.kind === 'pushpull') {
      const d = exact ? v : Math.round(v * 10) / 10;
      set({ op: { ...op, distance: op.symmetric ? Math.max(0, d) : d } });
    } else {
      const val = v <= 0 ? 0 : Math.max(MIN_EDGE, exact ? v : Math.round(v * 10) / 10);
      set({ op: { ...op, value: val } });
      schedulePreview();
    }
  },
  setSymmetric: (symmetric) => { const op = get().op; if (op?.kind === 'pushpull') set({ op: { ...op, symmetric, distance: symmetric ? Math.max(0.1, Math.abs(op.distance)) : op.distance } }); },
  setTool: (tool) => { const op = get().op; if (op?.kind === 'edgeop') { set({ op: { ...op, tool } }); schedulePreview(); } },

  dragStart: () => {
    const op = get().op; if (!op) return;
    set({ dragging: true, op: op.kind === 'pushpull' ? { ...op, t0: null, startDistance: op.distance } : { ...op, t0: null, startValue: op.value } });
  },
  dragMove: (ro, rd, step) => {
    const op = get().op; if (!op || !get().dragging) return;
    const axis = op.kind === 'pushpull' ? op.normal : op.out;
    const t = lineParam(op.origin, axis, ro, rd);
    if (t === null) return;
    if (op.t0 === null) { set({ op: { ...op, t0: t } }); return; }
    const raw = (op.kind === 'pushpull' ? op.startDistance : op.startValue) + (t - op.t0);
    const snapped = step > 0 ? Math.round(raw / step) * step : raw;
    get().setValue(snapped);
  },
  dragEnd: () => set({ dragging: false }),

  confirm: () => {
    const op = get().op; if (!op) return;
    const st = useStore.getState();
    if (op.kind === 'pushpull') {
      set({ op: null, dragging: false, typed: '' });
      if (Math.abs(op.distance) < 0.05) { st.toast('Push/Pull: nothing to apply — distance is 0.'); return; }
      if (op.region) {
        // a sketch region: the extrude's height; the sign joins (out of the plane) or cuts (into the host)
        const sk = useSketch.getState();
        const d = op.distance;
        if (sk.host && sk.active?.featureId === op.partId) sk.setMode(d < 0 ? 'cut' : 'join');
        st.patchFeature(op.partId, { height: Math.abs(d), ...(sk.host ? {} : { flip: d < 0 }) } as Partial<Feature>, { undoable: true });
        if (sk.active?.featureId === op.partId) sk.finish();
        useSel.getState().clear();
        return;
      }
      usePushPull.getState().applyDistance(op.partId, op.faceIndex, op.symmetric ? op.distance : op.distance);
      useSel.getState().clear();
      return;
    }
    // edge op: the preview IS the result; make sure the latest value is applied, then keep it
    if (op.previewTimer) { clearTimeout(op.previewTimer); }
    if (op.value < MIN_EDGE) { get().cancel(); st.toast(`${op.tool === 'round' ? 'Fillet' : 'Chamfer'} at 0 — nothing applied.`); return; }
    applyEdgePreview(true);
    set({ op: null, dragging: false, typed: '' });
    useSel.getState().clear();
  },

  cancel: () => {
    const op = get().op; if (!op) return;
    if (op.kind === 'edgeop') {
      if (op.previewTimer) clearTimeout(op.previewTimer);
      if (op.previewed) { const st = useStore.getState(); st.setDoc(op.docBefore, { undoable: false }); st.endGesture(); }
    }
    set({ op: null, dragging: false, typed: '' });
  },
}));

function schedulePreview() {
  const op = useOp.getState().op;
  if (!op || op.kind !== 'edgeop') return;
  if (op.previewTimer) clearTimeout(op.previewTimer);
  const timer = window.setTimeout(() => applyEdgePreview(false), 120);
  useOp.setState({ op: { ...op, previewTimer: timer } });
}

/** Re-run the fillet/chamfer features from the clean document at the current value. */
function applyEdgePreview(final: boolean) {
  const op = useOp.getState().op;
  if (!op || op.kind !== 'edgeop') return;
  const st = useStore.getState();
  // restore the clean doc silently, then apply through the edges store (one gesture = one undo step)
  st.beginGesture();
  let doc = op.docBefore;
  let combineId: string | null = null;
  if (op.value >= MIN_EDGE) {
    const r = buildEdgeTools(op.docBefore, op.part, op.edges, op.indices, op.tool, op.value);
    if (r) { doc = r.doc; combineId = r.combineId; }
    else if (final) st.toast(`Those edges can't take a ${op.tool === 'round' ? 'round' : 'chamfer'} of ${op.value} mm — try a smaller size.`);
  }
  st.setDoc(doc);
  if (final) { st.endGesture(); if (combineId) st.select([combineId]); }
  const cur = useOp.getState().op;
  if (cur && cur.kind === 'edgeop') useOp.setState({ op: { ...cur, previewed: true, previewTimer: null } });
}

function frameMatrix(t: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }): THREE.Matrix4 {
  const r = THREE.MathUtils.degToRad;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t.position.x, t.position.y, t.position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r(t.rotation.x), r(t.rotation.y), r(t.rotation.z), 'ZYX')),
    new THREE.Vector3(1, 1, 1),
  );
}

/** Parameter along the line (origin, axis) of the point closest to the ray. */
function lineParam(origin: V3, axis: V3, ro: V3, rd: V3): number | null {
  const o = new THREE.Vector3(...origin), n = new THREE.Vector3(...axis);
  const c = new THREE.Vector3(...ro), r = new THREE.Vector3(...rd).normalize();
  const w0 = o.clone().sub(c);
  const a = n.dot(n), b = n.dot(r), c2 = r.dot(r), dd = n.dot(w0), e = r.dot(w0);
  const den = a * c2 - b * b;
  if (Math.abs(den) < 1e-9) return null;
  return (b * e - c2 * dd) / den;
}
