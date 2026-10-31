/**
 * Sketch editing state and geometry helpers for the studio. The document
 * stays the source of truth (the extrude feature's `sketch`); this slice
 * holds only the transient editing state: tool, draft points, cursor, typed
 * numbers, selection.
 */
import { create } from 'zustand';
import { addFeature, addToCombine, combine as combineDoc, featureById, makeFeature, removeFeatures, sk, sketchToProfiles, endpoints, tessellate, solveSketch, tryAddConstraint, pruneConstraints, measure, constraintId, evalParams, evalExpr, isParamName, type Constraint, type PointRef, type DimensionSpec, type FeatureOf, type FormaDocument, type Sketch, type SketchEntity, type Transform, type Vec2 } from '@forma/core';
import * as THREE from 'three';
import { useStore } from './store';
import { useViewStore } from './view';
import { useSel } from './sel';
import { useUI } from './ui';
import { infer, lineLineIntersection, lineCircleIntersections, type Guide } from './inference';
import { planeTransform } from './plane';
export { planeTransform };

export type SketchTool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'polygon' | 'trim' | 'dim';
/** a picked sketch element: an entity, or one of its points */
export interface SketchPick { id: string; pt?: PointRef['pt'] }
/** an inline dimension being typed: a new one from `spec`, or an existing constraint `id` */
export interface DimEdit { id?: string; spec?: DimensionSpec; value: string; at: Vec2 }

export interface SnapResult { p: Vec2; kind: 'grid' | 'point' | 'axis' | 'free'; ref?: Vec2; guides: Guide[] }
export type RectMode = 'corner' | 'center';
export type CircleMode = 'center' | '2pt';

interface SketchState {
  active: null | {
    featureId: string;
    tool: SketchTool;
    draft: Vec2[];
    cursor: Vec2 | null;
    snap: SnapResult | null;
    typed: string;
    /** rectangle: the first typed dimension (width) once Enter locked it; the next typed value is the height */
    typedW: string | null;
    selected: string | null;
    /** the sketch selection (Select / Dimension tools): entities and points, Multi / Ctrl adds */
    picks: SketchPick[];
    /** a selected constraint glyph or dimension (Delete removes it) */
    selectedConstraint: string | null;
    /** inline dimension editor */
    dimEdit: DimEdit | null;
    /** closed region index under the cursor (Select tool) */
    hoverRegion: number | null;
    hoverVertex: Vec2 | null;
    dragVertex: { from: Vec2; ids: string[] } | null;
    docAtEntry: FormaDocument;
  };
  /** true while the user is asked to click a face to sketch on */
  pickingFace: boolean;
  /** polygon tool: number of sides (3+) */
  polygonSides: number;
  setPolygonSides(n: number): void;
  rectMode: RectMode;
  circleMode: CircleMode;
  setRectMode(m: RectMode): void;
  setCircleMode(m: CircleMode): void;
  /** screen pixels per sketch mm at the cursor — the layer reports it so tolerances follow the zoom */
  pxPerMm: number;
  setScale(pxPerMm: number): void;
  /** index of the closed region containing the local point, or null */
  regionAt(local: Vec2): number | null;
  /** the part the current face sketch was started on (its combine gets the join/cut) */
  host: { partId: string; combineId: string; point: [number, number, number]; normal: [number, number, number] } | null;
  /** set by the start helpers that align the camera themselves, so start() does not fly twice */
  aligning: boolean;
  start(featureId: string): void;
  createAndStart(): void;
  /** Start a ground sketch centred on a world point. */
  createAndStartAt(point: [number, number, number]): void;
  /** Start a sketch on a world plane through the origin: XY (plate), XZ (front) or YZ (side). */
  createAndStartOn(plane: 'xy' | 'xz' | 'yz'): void;
  /** Look straight at the sketch plane again (orthographic-style framing). */
  lookAt(): void;
  armFacePick(): void;
  disarmFacePick(): void;
  /** Start a sketch on a planar face of `partId`: `point` and `normal` are in world space. */
  startOnFace(partId: string, point: [number, number, number], normal: [number, number, number]): void;
  /** Make the current face sketch join (extrude outward) or cut (extrude into the part). */
  setMode(mode: 'join' | 'cut'): void;
  setTool(t: SketchTool): void;
  move(local: Vec2, mods: { shift: boolean; alt: boolean }): void;
  click(local: Vec2, mods: { shift: boolean; alt: boolean }): void;
  doubleClick(): void;
  typeChar(c: string): void;
  backspace(): void;
  enter(): void;
  escape(): void;
  select(id: string | null): void;
  /** pick an entity or a point (Select / Dimension tools); `add` keeps the current picks */
  pick(p: SketchPick | null, add: boolean): void;
  selectConstraint(id: string | null): void;
  /** constraints that can be added to the current picks, in Materializr's Add Constraint order */
  constraintOptions(): { kind: Constraint['kind']; label: string }[];
  /** add a constraint of `kind` to the current picks; dimensions open the inline editor first */
  addConstraint(kind: Constraint['kind']): void;
  /** open the inline editor on an existing dimension */
  editDimension(id: string, at: Vec2): void;
  setDimValue(v: string): void;
  /** commit the inline editor: a number, an expression, or `name = expr` (creates a parameter) */
  commitDim(): void;
  cancelDim(): void;
  removeConstraint(id: string): void;
  /** solve the sketch as it is now (for colouring and the dof readout) */
  solved(): ReturnType<typeof solveSketch> | null;
  deleteSelected(): void;
  /** Set the length of the selected line (moves its end point) or the radius of the selected circle/arc. */
  setSelectedSize(v: number): void;
  /** Move the selected entity by (dx, dy) mm; connected endpoints follow. */
  nudgeSelected(dx: number, dy: number): void;
  beginVertexDrag(local: Vec2): boolean;
  dragVertexTo(local: Vec2, mods: { shift: boolean; alt: boolean }): void;
  endVertexDrag(): void;
  finish(): void;
  cancel(): void;
}

const GRID = 1; // fallback when the UI store is unavailable
/** pixel tolerances (Materializr SketchTool): weld points at 6 px, point at lines / directions at 12 px */
const WELD_PX = 6, POINT_PX = 12;
/** distance from p to segment ab */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const round2 = (v: number) => Math.round(v * 100) / 100;

function currentSketch(featureId: string): Sketch {
  const f = featureById(useStore.getState().doc, featureId);
  return f && f.type === 'extrude' && f.sketch ? f.sketch : { entities: [], constraints: [] };
}

function writeSketch(featureId: string, entities: SketchEntity[], undoable: boolean, constraints?: Constraint[]) {
  const cur = currentSketch(featureId);
  const next = pruneConstraints({ entities, constraints: constraints ?? cur.constraints ?? [] });
  useStore.getState().patchFeature(featureId, { sketch: next } as Partial<FeatureOf<'extrude'>>, { undoable });
}

/** Parameter values of the document, for dimension expressions. */
function scopeOf(): Record<string, number> { return evalParams(useStore.getState().doc.params ?? []).scope; }

/** Solve the sketch with the given entities and write it; on a conflict the entities are written as they are and the user is told once. */
function solveAndWrite(featureId: string, entities: SketchEntity[], undoable: boolean, hold?: { p: PointRef; at: Vec2 }, constraints?: Constraint[]) {
  const cur = currentSketch(featureId);
  const sketch: Sketch = { entities, constraints: constraints ?? cur.constraints ?? [] };
  if (!(sketch.constraints?.length) && !hold) { writeSketch(featureId, entities, undoable, sketch.constraints); return; }
  const r = solveSketch(sketch, { hold, scope: scopeOf() });
  writeSketch(featureId, r.status === 'solved' ? r.entities : entities, undoable, sketch.constraints);
}

/** Entities an inference guide implies a constraint for (SolidCraft's inference adds the matching constraint). */
function guideConstraint(guide: { kind: string } | undefined, line: SketchEntity, ref?: string): Constraint | null {
  if (!guide) return null;
  if (guide.kind === 'horizontal') return { id: constraintId(), kind: 'horizontal', l: line.id };
  if (guide.kind === 'vertical') return { id: constraintId(), kind: 'vertical', l: line.id };
  if (guide.kind === 'parallel' && ref) return { id: constraintId(), kind: 'parallel', a: line.id, b: ref };
  if (guide.kind === 'perpendicular' && ref) return { id: constraintId(), kind: 'perpendicular', a: line.id, b: ref };
  return null;
}

/** All snap-worthy points in the sketch: endpoints, centres, midpoints. */
function snapPoints(sketch: Sketch): Vec2[] {
  const pts: Vec2[] = [];
  for (const e of sketch.entities) {
    const ep = endpoints(e);
    if (ep) { pts.push(ep[0], ep[1]); if (e.type === 'line') pts.push([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]); }
    if (e.type === 'circle' || e.type === 'arc') pts.push(e.center);
  }
  return pts;
}

/** Inference with the current zoom: pixel tolerances become mm through pxPerMm. */
export function computeSnap(raw: Vec2, sketch: Sketch, anchor: Vec2 | null, mods: { shift: boolean; alt: boolean }, extra: Vec2[] = [], ignore: string[] = []): SnapResult {
  const ppm = Math.max(0.5, useSketch.getState().pxPerMm || 8);
  const ui = useUI.getState();
  const r = infer(raw, sketch, anchor, { weld: WELD_PX / ppm, point: POINT_PX / ppm, grid: ui.snap ? ui.gridStep : 0, angle: ui.angleSnap, shift: mods.shift, alt: mods.alt, extra, ignore });
  const k = r.guides[0]?.kind ?? 'grid';
  const kind: SnapResult['kind'] = k === 'free' ? 'free' : k === 'grid' ? 'grid' : ['endpoint', 'midpoint', 'center', 'intersection', 'online'].includes(k) ? 'point' : 'axis';
  return { p: r.p, kind, ref: kind === 'axis' && anchor ? anchor : undefined, guides: r.guides };
}

/** Point-in-polygon (even-odd) in sketch mm. */
function inside(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Apply a typed length to the direction anchor→p. */
function withTypedLength(anchor: Vec2, p: Vec2, typed: string): Vec2 {
  const L = parseFloat(typed);
  if (!Number.isFinite(L) || L <= 0) return p;
  const dx = p[0] - anchor[0], dy = p[1] - anchor[1], len = Math.hypot(dx, dy) || 1;
  return [round2(anchor[0] + (dx / len) * L), round2(anchor[1] + (dy / len) * L)];
}

export const useSketch = create<SketchState>((set, get) => {
  const upd = (patch: Partial<NonNullable<SketchState['active']>>) => { const a = get().active; if (a) set({ active: { ...a, ...patch } }); };
  /** add entities and, with them, the constraints they come with (auto H/V, typed dimensions); refused constraints are simply dropped */
  const commitEntities = (add: SketchEntity[], cons: Constraint[] = []) => {
    const a = get().active!;
    const cur = currentSketch(a.featureId);
    let sketch: Sketch = { entities: [...cur.entities, ...add], constraints: cur.constraints ?? [] };
    const scope = scopeOf();
    for (const c of cons) { const r = tryAddConstraint(sketch, c, scope); if (r.ok) sketch = r.sketch; }
    writeSketch(a.featureId, sketch.entities, true, sketch.constraints);
  };
  const typedNumber = (t: string) => { const v = parseFloat(t); return Number.isFinite(v) && v > 0 ? v : null; };
  return {
    active: null,
    start: (featureId) => {
      const st = useStore.getState();
      const f = featureById(st.doc, featureId);
      if (!f || f.type !== 'extrude') return;
      if (!f.sketch) {
        // legacy fixed profile: convert to editable lines so the user can keep going
        const outer = f.profile?.outer ?? [];
        const entities = outer.map((p, i) => sk.line(p, outer[(i + 1) % outer.length]!));
        writeSketch(featureId, entities, true);
      }
      st.select([featureId]);
      set({ active: { featureId, tool: 'line', draft: [], cursor: null, snap: null, typed: '', typedW: null, selected: null, picks: [], selectedConstraint: null, dimEdit: null, hoverRegion: null, hoverVertex: null, dragVertex: null, docAtEntry: useStore.getState().doc } });
      useSel.getState().clear();
      // callers that know the plane align the camera themselves (createAndStartOn / startOnFace); editing an existing sketch looks at its plane
      if (!get().host && !get().aligning) get().lookAt();
    },
    pickingFace: false,
    polygonSides: 6,
    setPolygonSides: (n) => set({ polygonSides: Math.max(3, Math.min(64, Math.round(n))) }),
    rectMode: 'corner',
    circleMode: 'center',
    setRectMode: (rectMode) => { set({ rectMode }); upd({ draft: [], typed: '', typedW: null }); },
    setCircleMode: (circleMode) => { set({ circleMode }); upd({ draft: [], typed: '', typedW: null }); },
    pxPerMm: 8,
    setScale: (pxPerMm) => { if (Math.abs(pxPerMm - get().pxPerMm) > 0.05) set({ pxPerMm }); },
    regionAt: (local) => {
      const a = get().active; if (!a) return null;
      const r = sketchToProfiles(currentSketch(a.featureId));
      for (let i = 0; i < r.profiles.length; i++) {
        const pr = r.profiles[i]!;
        if (inside(local, pr.outer) && !pr.holes.some((h) => inside(local, h))) return i;
      }
      return null;
    },
    host: null,
    aligning: false,
    armFacePick: () => set({ pickingFace: true }),
    disarmFacePick: () => set({ pickingFace: false }),
    startOnFace: (partId, point, normal) => {
      const st = useStore.getState();
      const part = featureById(st.doc, partId);
      if (!part) return;
      const t = planeTransform(point, normal);
      const f = makeFeature(st.doc, 'extrude', { sketch: { entities: [], constraints: [] }, height: 10, transform: t });
      let doc = addFeature(st.doc, f);
      // the sketch must live in the same combine as the part so its extrusion joins or cuts it
      let combineId: string;
      if (part.type === 'combine') {
        combineId = part.id;
        doc = addToCombine(doc, combineId, f.id);
      } else if (part.parentId) {
        combineId = part.parentId;
        doc = addToCombine(doc, combineId, f.id);
      } else {
        const r = combineDoc(doc, [partId, f.id], part.name);
        doc = r.doc; combineId = r.combineId;
      }
      const docBefore = st.doc;
      st.setDoc(doc);
      set({ pickingFace: false, host: { partId, combineId, point, normal } });
      get().start(f.id);
      set((state) => (state.active ? { active: { ...state.active, docAtEntry: docBefore, tool: 'rect' } } : {}));
      useViewStore.getState().alignTo(point, normal);
    },
    setMode: (mode) => {
      const a = get().active; if (!a) return;
      const host = get().host;
      // cuts start a hair outside the face, joins a hair inside, so the boolean never fights a coplanar skin
      const eps = 0.02;
      const patch: Partial<FeatureOf<'extrude'>> = { role: mode === 'cut' ? 'hole' : 'solid', flip: mode === 'cut' };
      if (host) {
        const t = planeTransform(host.point, host.normal), n = host.normal, by = mode === 'cut' ? eps : -eps;
        patch.transform = { ...t, position: { x: t.position.x + n[0] * by, y: t.position.y + n[1] * by, z: t.position.z + n[2] * by } };
      }
      useStore.getState().patchFeature(a.featureId, patch, { undoable: true });
    },
    createAndStartAt: (point) => {
      const st = useStore.getState();
      const f = makeFeature(st.doc, 'extrude', { sketch: { entities: [], constraints: [] }, height: 10, transform: { position: { x: Math.round(point[0]), y: Math.round(point[1]), z: Math.round(point[2] * 10) / 10 }, rotation: { x: 0, y: 0, z: 0 } } });
      st.setDoc(addFeature(st.doc, f));
      get().start(f.id);
    },
    createAndStartOn: (plane) => {
      const st = useStore.getState();
      const normal: [number, number, number] = plane === 'xy' ? [0, 0, 1] : plane === 'xz' ? [0, -1, 0] : [1, 0, 0];
      const t = plane === 'xy' ? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } : planeTransform([0, 0, 0], normal);
      const f = makeFeature(st.doc, 'extrude', { sketch: { entities: [], constraints: [] }, height: 10, transform: t, name: `Sketch ${st.doc.features.filter((x) => x.type === 'extrude').length + 1}` });
      st.setDoc(addFeature(st.doc, f));
      set({ host: null, aligning: true });
      get().start(f.id);
      set({ aligning: false });
      useViewStore.getState().alignTo([0, 0, 0], normal);
    },
    lookAt: () => {
      const a = get().active; if (!a) return;
      const f = featureById(useStore.getState().doc, a.featureId); if (!f) return;
      const t = f.transform;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(t.rotation.x), THREE.MathUtils.degToRad(t.rotation.y), THREE.MathUtils.degToRad(t.rotation.z), 'ZYX'));
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      useViewStore.getState().alignTo([t.position.x, t.position.y, t.position.z], [n.x, n.y, n.z]);
    },
    createAndStart: () => {
      const st = useStore.getState();
      const n = st.doc.features.filter((x) => x.parentId === null).length;
      const f = makeFeature(st.doc, 'extrude', { sketch: { entities: [], constraints: [] }, height: 10, transform: { position: { x: ((n % 4) - 1.5) * 30, y: (Math.floor(n / 4) % 4 - 1.5) * 30, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } });
      st.setDoc(addFeature(st.doc, f));
      get().start(f.id);
    },
    setTool: (tool) => { upd({ tool, draft: [], typed: '', typedW: null, picks: [], selectedConstraint: null, dimEdit: null }); if (tool !== 'select') useSel.getState().clear(); },
    move: (local, mods) => {
      const a = get().active; if (!a) return;
      const sketch = currentSketch(a.featureId);
      const anchor = a.draft.length ? a.draft[a.draft.length - 1]! : null;
      const snap = computeSnap(local, sketch, anchor, mods, a.tool === 'line' && a.draft.length >= 3 ? [a.draft[0]!] : []);
      const ppm = Math.max(0.5, get().pxPerMm || 8);
      const hover = snapPoints(sketch).find((p) => Math.hypot(p[0] - local[0], p[1] - local[1]) < POINT_PX / ppm) ?? null;
      if (snap?.kind === 'point' && a.snap?.kind !== 'point') { try { navigator.vibrate?.(8); } catch { /* unsupported */ } }
      const hoverRegion = a.tool === 'select' && !hover ? get().regionAt(local) : null;
      upd({ cursor: local, snap: a.tool === 'select' ? null : snap, hoverVertex: a.tool === 'select' ? hover : null, hoverRegion });
    },
    click: (local, mods) => {
      const a = get().active; if (!a) return;
      const sketch = currentSketch(a.featureId);
      const anchor = a.draft.length ? a.draft[a.draft.length - 1]! : null;
      let p = computeSnap(local, sketch, anchor, mods, a.tool === 'line' && a.draft.length >= 3 ? [a.draft[0]!] : []).p;
      if (anchor && a.typed && (a.tool === 'line' || a.tool === 'polygon')) p = withTypedLength(anchor, p, a.typed);
      switch (a.tool) {
        case 'select': {
          // a click inside a closed region selects it (Push in the dock); elsewhere clears
          const idx = get().regionAt(local);
          if (idx !== null) useSel.getState().pickRegion({ sketchId: a.featureId, index: idx }, mods.shift);
          else useSel.getState().clear();
          upd({ selected: null });
          return;
        }
        case 'line': {
          if (!anchor) { upd({ draft: [p], typed: '' }); return; }
          if (Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) < 0.01) return;
          const closes = a.draft.length >= 2 && Math.hypot(p[0] - a.draft[0]![0], p[1] - a.draft[0]![1]) < 0.01;
          const line = sk.line(anchor, p);
          const snap = computeSnap(local, sketch, anchor, mods, a.draft.length >= 3 ? [a.draft[0]!] : []);
          const cons: Constraint[] = [];
          const g = guideConstraint(snap.guides.find((x) => ['horizontal', 'vertical', 'parallel', 'perpendicular'].includes(x.kind)), line, (snap.guides.find((x) => x.kind === 'parallel' || x.kind === 'perpendicular') as { ref?: string } | undefined)?.ref);
          if (g) cons.push(g);
          const L = typedNumber(a.typed);
          if (L !== null) cons.push({ id: constraintId(), kind: 'length', l: line.id, value: L });
          commitEntities([line], cons);
          upd({ draft: closes ? [] : [...a.draft, p], typed: '' });
          return;
        }
        case 'rect': {
          if (!anchor) { upd({ draft: [p], typed: '', typedW: null }); return; }
          const corners = rectCorners(anchor, p, get().rectMode, a.typedW, a.typed);
          if (!corners) return;
          const r = sk.rect(corners[0], corners[1]);
          const [bot, rgt, top, lft] = r as [SketchEntity, SketchEntity, SketchEntity, SketchEntity];
          const cons: Constraint[] = [
            { id: constraintId(), kind: 'horizontal', l: bot.id }, { id: constraintId(), kind: 'horizontal', l: top.id },
            { id: constraintId(), kind: 'vertical', l: rgt.id }, { id: constraintId(), kind: 'vertical', l: lft.id },
          ];
          const W = typedNumber(a.typedW ?? ''), H = typedNumber(a.typed);
          if (a.typedW !== null && W !== null) cons.push({ id: constraintId(), kind: 'length', l: bot.id, value: W });
          if (a.typedW !== null && H !== null) cons.push({ id: constraintId(), kind: 'length', l: rgt.id, value: H });
          commitEntities(r, cons);
          upd({ draft: [], typed: '', typedW: null });
          return;
        }
        case 'circle': {
          if (!anchor) { upd({ draft: [p], typed: '' }); return; }
          const c = circleFrom(anchor, p, get().circleMode, a.typed);
          if (!c) return;
          const circle = sk.circle(c.center, round2(c.radius));
          const D = typedNumber(a.typed);
          commitEntities([circle], D !== null ? [{ id: constraintId(), kind: 'diameter', c: circle.id, value: D }] : []);
          upd({ draft: [], typed: '' });
          return;
        }
        case 'arc': {
          if (a.draft.length < 2) { upd({ draft: [...a.draft, p], typed: '' }); return; }
          const [s, e] = a.draft as [Vec2, Vec2];
          commitEntities([sk.arc3(s, p, e)]);
          upd({ draft: [], typed: '' });
          return;
        }
        case 'polygon': {
          // centre, then radius + rotation: vertex 0 sits under the cursor (SketchTool.cpp:4123)
          if (!anchor) { upd({ draft: [p], typed: '' }); return; }
          const r = Math.hypot(p[0] - anchor[0], p[1] - anchor[1]);
          if (r < 0.05) return;
          const n = Math.max(3, Math.round(get().polygonSides));
          const a0 = Math.atan2(p[1] - anchor[1], p[0] - anchor[0]);
          const pts: Vec2[] = [];
          for (let i = 0; i < n; i++) { const t = a0 + (i * 2 * Math.PI) / n; pts.push([round2(anchor[0] + r * Math.cos(t)), round2(anchor[1] + r * Math.sin(t))]); }
          commitEntities(pts.map((q, i) => sk.line(q, pts[(i + 1) % n]!)));
          upd({ draft: [], typed: '' });
          return;
        }
        case 'trim': {
          // remove the piece under the click between its nearest intersections with the rest of the sketch
          const sketch = currentSketch(a.featureId);
          const ppm = Math.max(0.5, get().pxPerMm || 8);
          let best: SketchEntity | null = null, bd = POINT_PX / ppm;
          for (const e of sketch.entities) {
            const pts = tessellate(e);
            const closed = e.type === 'circle';
            for (let i = 0; i + 1 < pts.length + (closed ? 1 : 0); i++) { const d = segDist(local, pts[i % pts.length]!, pts[(i + 1) % pts.length]!); if (d < bd) { bd = d; best = e; } }
          }
          if (!best) return;
          const pieces = trimPieces(best, local, sketch.entities.filter((e) => e.id !== best!.id));
          writeSketch(a.featureId, [...sketch.entities.filter((e) => e.id !== best!.id), ...pieces], true);
          return;
        }
      }
    },
    doubleClick: () => { const a = get().active; if (!a) return; if (a.draft.length) upd({ draft: [], typed: '' }); },
    typeChar: (c) => { const a = get().active; if (!a) return; if (/^[0-9.]$/.test(c)) upd({ typed: (a.typed + c).slice(0, 8) }); },
    backspace: () => {
      const a = get().active; if (!a) return;
      if (a.typed) { upd({ typed: a.typed.slice(0, -1) }); return; }
      get().deleteSelected();
    },
    enter: () => {
      const a = get().active; if (!a) return;
      // rectangle: the first Enter locks the width, the second (with a height typed) commits
      if (a.tool === 'rect' && a.typed && a.draft.length && a.typedW === null) { upd({ typedW: a.typed, typed: '' }); return; }
      // Enter with a typed value: place the next point along the current cursor direction (length, diameter, size);
      // with no pointer position yet (touch), build towards +X / +Y from the anchor
      if (a.typed && a.draft.length) {
        const anchor = a.draft[a.draft.length - 1]!;
        const cur = a.cursor && Math.hypot(a.cursor[0] - anchor[0], a.cursor[1] - anchor[1]) > 0.01 ? a.cursor : ([anchor[0] + 10, anchor[1] + 10] as Vec2);
        get().click(cur, { shift: false, alt: true });
        return;
      }
      if (a.draft.length) { upd({ draft: [], typed: '' }); return; }
      get().finish();
    },
    escape: () => {
      const a = get().active; if (!a) return;
      if (a.dimEdit) { upd({ dimEdit: null }); return; }
      if (a.typed) { upd({ typed: '' }); return; }
      if (a.typedW !== null) { upd({ typedW: null }); return; }
      if (a.draft.length) { upd({ draft: [], typed: '', typedW: null }); return; }
      if (a.selected || a.picks.length || a.selectedConstraint) { upd({ selected: null, picks: [], selectedConstraint: null }); return; }
      if (useSel.getState().regions.length) { useSel.getState().clear(); return; }
      get().finish();
    },
    select: (id) => upd({ selected: id, picks: id ? [{ id }] : [], selectedConstraint: null }),
    pick: (p, add) => {
      const a = get().active; if (!a) return;
      if (!p) { upd({ picks: [], selected: null, selectedConstraint: null }); return; }
      const same = (x: SketchPick) => x.id === p.id && (x.pt ?? null) === (p.pt ?? null);
      const picks = add ? (a.picks.some(same) ? a.picks.filter((x) => !same(x)) : [...a.picks, p]) : [p];
      upd({ picks, selected: picks.length === 1 && !picks[0]!.pt ? picks[0]!.id : null, selectedConstraint: null });
    },
    selectConstraint: (id) => upd({ selectedConstraint: id, picks: [], selected: null }),
    constraintOptions: () => {
      const a = get().active; if (!a) return [];
      const sketch = currentSketch(a.featureId);
      const byId = new Map(sketch.entities.map((e) => [e.id, e]));
      const picks = a.picks.filter((p) => byId.has(p.id));
      const pts = picks.filter((p) => p.pt);
      const ents = picks.filter((p) => !p.pt);
      const lines = ents.filter((p) => byId.get(p.id)!.type === 'line');
      const curves = ents.filter((p) => byId.get(p.id)!.type !== 'line');
      const out: { kind: Constraint['kind']; label: string }[] = [];
      if (lines.length >= 1 && ents.length === lines.length && pts.length === 0) { out.push({ kind: 'horizontal', label: 'Horizontal' }, { kind: 'vertical', label: 'Vertical' }); }
      if (pts.length === 2 && ents.length === 0) { out.push({ kind: 'coincident', label: 'Coincident' }, { kind: 'distance', label: 'Distance…' }); }
      if (pts.length === 1 && curves.length === 1) out.push({ kind: 'pointOnCurve', label: 'Point on curve' });
      if (pts.length === 1 && lines.length === 1) out.push({ kind: 'midpoint', label: 'Midpoint' }, { kind: 'pointOnCurve', label: 'Point on line' });
      if (lines.length === 2 && ents.length === 2 && pts.length === 0) out.push({ kind: 'parallel', label: 'Parallel' }, { kind: 'perpendicular', label: 'Perpendicular' }, { kind: 'equal', label: 'Equal length' }, { kind: 'angle', label: 'Angle…' });
      if (lines.length === 1 && ents.length === 1 && pts.length === 0) out.push({ kind: 'length', label: 'Length…' });
      if (pts.length === 1 && ents.length === 0) out.push({ kind: 'fix', label: 'Fix Position' });
      if (curves.length === 1 && ents.length === 1 && pts.length === 0) out.push({ kind: 'radius', label: 'Radius…' }, { kind: 'diameter', label: 'Diameter…' });
      if (lines.length === 1 && curves.length === 1) out.push({ kind: 'tangent', label: 'Tangent (curve + line)' });
      if (curves.length === 2 && ents.length === 2) out.push({ kind: 'concentric', label: 'Concentric' }, { kind: 'equal', label: 'Equal radius' }, { kind: 'tangent', label: 'Tangent' });
      return out;
    },
    addConstraint: (kind) => {
      const a = get().active; if (!a) return;
      const sketch = currentSketch(a.featureId);
      const byId = new Map(sketch.entities.map((e) => [e.id, e]));
      const picks = a.picks.filter((p) => byId.has(p.id));
      const pts = picks.filter((p) => p.pt).map((p) => ({ id: p.id, pt: p.pt! }));
      const ents = picks.filter((p) => !p.pt).map((p) => p.id);
      const lines = ents.filter((id) => byId.get(id)!.type === 'line');
      const curves = ents.filter((id) => byId.get(id)!.type !== 'line');
      const st = useStore.getState();
      const build = (): Constraint[] | DimensionSpec | null => {
        const id = constraintId();
        switch (kind) {
          case 'horizontal': case 'vertical': return lines.map((l) => ({ id: constraintId(), kind, l }));
          case 'coincident': return pts.length === 2 ? [{ id, kind, p: pts[0]!, q: pts[1]! }] : null;
          case 'pointOnCurve': return pts[0] && ents[0] ? [{ id, kind, p: pts[0], c: ents[0] }] : null;
          case 'midpoint': return pts[0] && lines[0] ? [{ id, kind, p: pts[0], l: lines[0] }] : null;
          case 'parallel': case 'perpendicular': return lines.length === 2 ? [{ id, kind, a: lines[0]!, b: lines[1]! }] : null;
          case 'equal': return lines.length === 2 ? [{ id, kind, a: lines[0]!, b: lines[1]! }] : curves.length === 2 ? [{ id, kind, a: curves[0]!, b: curves[1]! }] : null;
          case 'tangent': return lines[0] && curves[0] ? [{ id, kind, a: lines[0], b: curves[0] }] : curves.length === 2 ? [{ id, kind, a: curves[0]!, b: curves[1]! }] : null;
          case 'concentric': return curves.length === 2 ? [{ id, kind, a: curves[0]!, b: curves[1]! }] : null;
          case 'fix': return pts[0] ? [{ id, kind, p: pts[0] }] : null;
          case 'distance': return pts.length === 2 ? { kind, p: pts[0]!, q: pts[1]! } : null;
          case 'distanceX': return pts.length === 2 ? { kind, p: pts[0]!, q: pts[1]! } : null;
          case 'distanceY': return pts.length === 2 ? { kind, p: pts[0]!, q: pts[1]! } : null;
          case 'length': return lines[0] ? { kind, l: lines[0] } : null;
          case 'radius': return curves[0] ? { kind, c: curves[0] } : null;
          case 'diameter': return curves[0] ? { kind, c: curves[0] } : null;
          case 'angle': return lines.length === 2 ? { kind, a: lines[0]!, b: lines[1]! } : null;
        }
      };
      const b = build();
      if (!b) { st.toast('Pick the elements this constraint needs first.'); return; }
      if (!Array.isArray(b)) {
        // a dimension: open the inline editor with the measured value
        const v = measure(sketch, b);
        if (v === null) return;
        const at = a.cursor ?? [0, 0];
        upd({ dimEdit: { spec: b, value: String(Math.round(Math.abs(v) * 100) / 100), at } });
        return;
      }
      let cur: Sketch = sketch;
      const scope = scopeOf();
      for (const c of b) { const r = tryAddConstraint(cur, c, scope); if (!r.ok) { st.toast(r.reason); return; } cur = r.sketch; }
      writeSketch(a.featureId, cur.entities, true, cur.constraints);
      upd({ picks: [], selected: null });
    },
    editDimension: (id, at) => {
      const a = get().active; if (!a) return;
      const c = (currentSketch(a.featureId).constraints ?? []).find((x) => x.id === id);
      if (!c || !('value' in c)) return;
      upd({ dimEdit: { id, value: c.expr ?? String(c.value), at }, selectedConstraint: id, picks: [], selected: null });
    },
    setDimValue: (value) => { const a = get().active; if (a?.dimEdit) upd({ dimEdit: { ...a.dimEdit, value } }); },
    commitDim: () => {
      const a = get().active; if (!a || !a.dimEdit) return;
      const st = useStore.getState();
      let text = a.dimEdit.value.trim();
      // `name = expr` creates (or updates) a parameter and binds the dimension to it — only once the dimension is accepted
      let expr: string | undefined;
      let newParams: NonNullable<FormaDocument['params']> | null = null;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(text);
      if (m) {
        const name = m[1]!, body = m[2]!;
        if (!isParamName(name)) { st.toast(`"${name}" can't be a parameter name.`); return; }
        const params = [...(st.doc.params ?? [])];
        const i = params.findIndex((p) => p.name === name);
        try { evalExpr(body, evalParams(params.filter((p) => p.name !== name)).scope); } catch (e) { st.toast(`Parameter: ${(e as Error).message}`); return; }
        if (i >= 0) params[i] = { ...params[i]!, expr: body }; else params.push({ name, expr: body, kind: 'length' });
        newParams = params; expr = name; text = name;
      }
      const scope = newParams ? evalParams(newParams).scope : scopeOf();
      let value: number;
      try { value = evalExpr(text, scope); } catch (e) { st.toast(`Dimension: ${(e as Error).message}`); return; }
      if (!/^[-+]?[0-9.]+$/.test(text)) expr = text; // anything but a plain number stays an expression
      if (a.dimEdit.spec && a.dimEdit.spec.kind !== 'angle' && value <= 0) { st.toast('A dimension must be greater than 0.'); return; }
      const sketch = currentSketch(a.featureId);
      let out: Sketch;
      if (a.dimEdit.id) {
        const cons = (sketch.constraints ?? []).map((c) => (c.id === a.dimEdit!.id && 'value' in c ? { ...c, value, expr } : c));
        const r = solveSketch({ entities: sketch.entities, constraints: cons }, { scope });
        if (r.status === 'failed') { st.toast("Can't reach that value with the other constraints."); return; }
        out = { entities: r.entities, constraints: cons };
      } else if (a.dimEdit.spec) {
        const c = { ...a.dimEdit.spec, id: constraintId(), value, expr } as Constraint;
        const r = tryAddConstraint(sketch, c, scope);
        if (!r.ok) { st.toast(r.reason); return; }
        out = r.sketch;
      } else return;
      if (newParams) st.setDoc({ ...st.doc, params: newParams }, { undoable: true });
      writeSketch(a.featureId, out.entities, true, out.constraints);
      upd({ dimEdit: null, picks: [], selected: null, selectedConstraint: null });
    },
    cancelDim: () => upd({ dimEdit: null }),
    removeConstraint: (id) => {
      const a = get().active; if (!a) return;
      const sketch = currentSketch(a.featureId);
      writeSketch(a.featureId, sketch.entities, true, (sketch.constraints ?? []).filter((c) => c.id !== id));
      upd({ selectedConstraint: null });
    },
    solved: () => {
      const a = get().active; if (!a) return null;
      const sketch = currentSketch(a.featureId);
      return solveSketch(sketch, { scope: scopeOf() });
    },
    setSelectedSize: (v) => {
      const a = get().active; if (!a || !a.selected || !(v > 0)) return;
      const entities = currentSketch(a.featureId).entities.map((e) => {
        if (e.id !== a.selected) return e;
        if (e.type === 'line') {
          const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
          return { ...e, b: [round2(e.a[0] + ((e.b[0] - e.a[0]) / L) * v), round2(e.a[1] + ((e.b[1] - e.a[1]) / L) * v)] as Vec2 };
        }
        if (e.type === 'circle' || e.type === 'arc') return { ...e, radius: round2(v) };
        return e;
      });
      solveAndWrite(a.featureId, entities, true);
    },
    nudgeSelected: (dx, dy) => {
      const a = get().active; if (!a || !a.selected) return;
      const sketch = currentSketch(a.featureId);
      const target = sketch.entities.find((e) => e.id === a.selected);
      if (!target) return;
      // move the entity and every endpoint that touches it, so the outline stays closed
      const touched = new Set<string>();
      const ep = endpoints(target);
      const pts: Vec2[] = ep ? [ep[0], ep[1]] : target.type === 'circle' ? [target.center] : [];
      const same = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
      const mv = (p: Vec2): Vec2 => [round2(p[0] + dx), round2(p[1] + dy)];
      const entities = sketch.entities.map((e) => {
        if (e.id === target.id) { touched.add(e.id); return shift(e, dx, dy); }
        if (e.type === 'line') {
          const na = pts.some((p) => same(p, e.a)) ? mv(e.a) : e.a, nb = pts.some((p) => same(p, e.b)) ? mv(e.b) : e.b;
          return na !== e.a || nb !== e.b ? { ...e, a: na, b: nb } : e;
        }
        return e;
      });
      writeSketch(a.featureId, entities, true);
    },
    deleteSelected: () => {
      const a = get().active; if (!a) return;
      if (a.selectedConstraint) { get().removeConstraint(a.selectedConstraint); return; }
      const ids = new Set(a.picks.filter((p) => !p.pt).map((p) => p.id));
      if (a.selected) ids.add(a.selected);
      if (!ids.size) return;
      writeSketch(a.featureId, currentSketch(a.featureId).entities.filter((e) => !ids.has(e.id)), true);
      upd({ selected: null, picks: [] });
    },
    beginVertexDrag: (local) => {
      const a = get().active; if (!a) return false;
      const sketch = currentSketch(a.featureId);
      const ids: string[] = [];
      let from: Vec2 | null = null;
      for (const e of sketch.entities) {
        const ep = endpoints(e);
        const cands = ep ? [...ep] : [];
        if (e.type === 'circle') cands.push(e.center);
        for (const p of cands) {
          if (Math.hypot(p[0] - local[0], p[1] - local[1]) < POINT_PX / Math.max(0.5, get().pxPerMm || 8)) { from = from ?? p; if (Math.hypot(p[0] - from[0], p[1] - from[1]) < 0.01) ids.push(e.id); }
        }
      }
      if (!from) return false;
      useStore.getState().beginGesture();
      upd({ dragVertex: { from, ids: [...new Set(ids)] } });
      return true;
    },
    dragVertexTo: (local, mods) => {
      const a = get().active; if (!a || !a.dragVertex) return;
      const { from, ids } = a.dragVertex;
      const sketch = currentSketch(a.featureId);
      const others: Sketch = { entities: sketch.entities.filter((e) => !ids.includes(e.id)), constraints: [] };
      const target = computeSnap(local, others, null, mods, [], ids).p;
      const same = (p: Vec2) => Math.hypot(p[0] - from[0], p[1] - from[1]) < 0.01;
      // the dragged point as a handle: the solver holds it at the target and the constraints do the rest
      let handle: PointRef | null = null;
      for (const e of sketch.entities) {
        if (!ids.includes(e.id)) continue;
        if (e.type === 'line') { if (same(e.a)) { handle = { id: e.id, pt: 'a' }; break; } if (same(e.b)) { handle = { id: e.id, pt: 'b' }; break; } }
        else if (same(e.center)) { handle = { id: e.id, pt: 'c' }; break; }
      }
      if (handle) {
        const r = solveSketch(sketch, { hold: { p: handle, at: target }, scope: scopeOf() });
        if (r.status === 'solved') { writeSketch(a.featureId, r.entities, false); upd({ dragVertex: { from: target, ids }, cursor: local }); }
        return;
      }
      const entities = sketch.entities.map((e): SketchEntity => {
        if (!ids.includes(e.id)) return e;
        if (e.type === 'line') return { ...e, a: same(e.a) ? target : e.a, b: same(e.b) ? target : e.b };
        if (e.type === 'circle') return same(e.center) ? { ...e, center: target } : e;
        return e;
      });
      writeSketch(a.featureId, entities, false);
      upd({ dragVertex: { from: target, ids }, cursor: local });
    },
    endVertexDrag: () => { const a = get().active; if (!a || !a.dragVertex) return; useStore.getState().endGesture(); upd({ dragVertex: null }); },
    finish: () => {
      const a = get().active; if (!a) return;
      useSel.getState().clear();
      const st = useStore.getState();
      const f = featureById(st.doc, a.featureId);
      if (f && f.type === 'extrude' && f.sketch && sketchToProfiles(f.sketch).profiles.length === 0) {
        // nothing usable was drawn: drop the empty feature instead of leaving an error in the tree
        st.setDoc(removeFeatures(st.doc, [a.featureId]));
        st.clearSelection();
        st.toast('Sketch had no closed outline, nothing was created');
      }
      set({ active: null, host: null });
    },
    cancel: () => {
      const a = get().active; if (!a) return;
      useSel.getState().clear();
      useStore.getState().setDoc(a.docAtEntry);
      useStore.getState().clearSelection();
      set({ active: null, host: null });
    },
  };
});

function shift(e: SketchEntity, dx: number, dy: number): SketchEntity {
  if (e.type === 'line') return { ...e, a: [round2(e.a[0] + dx), round2(e.a[1] + dy)], b: [round2(e.b[0] + dx), round2(e.b[1] + dy)] };
  return { ...e, center: [round2(e.center[0] + dx), round2(e.center[1] + dy)] };
}

/** Summary line for the HUD. */
export function sketchStatus(featureId: string): { closed: number; holes: number; open: number } {
  const s = currentSketch(featureId);
  const r = sketchToProfiles(s);
  return { closed: r.profiles.length, holes: r.profiles.reduce((n, p) => n + p.holes.length, 0), open: r.openIds.length };
}

/** Rectangle corners from the anchor and the cursor: corner-to-corner or centre-out, with typed width / height taking over the cursor. */
export function rectCorners(anchor: Vec2, p: Vec2, mode: RectMode, typedW: string | null, typed: string): [Vec2, Vec2] | null {
  let w = p[0] - anchor[0], h = p[1] - anchor[1];
  const W = parseFloat(typedW ?? ''), H = parseFloat(typed);
  if (typedW !== null && Number.isFinite(W) && W > 0) { w = Math.sign(w || 1) * W; if (Number.isFinite(H) && H > 0) h = Math.sign(h || 1) * H; }
  else if (typedW === null && Number.isFinite(H) && H > 0) { w = Math.sign(w || 1) * H; }
  if (Math.abs(w) < 0.01 || Math.abs(h) < 0.01) return null;
  if (mode === 'center') return [[round2(anchor[0] - w), round2(anchor[1] - h)], [round2(anchor[0] + w), round2(anchor[1] + h)]];
  return [anchor, [round2(anchor[0] + w), round2(anchor[1] + h)]];
}

/** Circle from the anchor and the cursor: centre + radius point, or two points on the diameter; a typed value is the diameter. */
export function circleFrom(anchor: Vec2, p: Vec2, mode: CircleMode, typed: string): { center: Vec2; radius: number } | null {
  const D = parseFloat(typed);
  if (mode === '2pt') {
    let r = Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) / 2;
    let q = p;
    if (Number.isFinite(D) && D > 0) { const L = Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) || 1; q = [anchor[0] + ((p[0] - anchor[0]) / L) * D, anchor[1] + ((p[1] - anchor[1]) / L) * D]; r = D / 2; }
    if (r < 0.05) return null;
    return { center: [round2((anchor[0] + q[0]) / 2), round2((anchor[1] + q[1]) / 2)], radius: r };
  }
  let r = Math.hypot(p[0] - anchor[0], p[1] - anchor[1]);
  if (Number.isFinite(D) && D > 0) r = D / 2;
  if (r < 0.05) return null;
  return { center: anchor, radius: r };
}

/** Split `e` at its intersections with `others` and drop the piece nearest `at`. Lines split exactly; circles become arcs; arcs are removed whole. */
function trimPieces(e: SketchEntity, at: Vec2, others: SketchEntity[]): SketchEntity[] {
  if (e.type === 'line') {
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L2 = dx * dx + dy * dy || 1;
    const ts = new Set<number>([0, 1]);
    for (const o of others) {
      const hits = o.type === 'line' ? [lineLineIntersection(e.a, e.b, o.a, o.b)].filter((x): x is Vec2 => !!x)
        : o.type === 'circle' ? lineCircleIntersections(e.a, e.b, o.center, o.radius) : [];
      for (const h of hits) { const t = ((h[0] - e.a[0]) * dx + (h[1] - e.a[1]) * dy) / L2; if (t > 1e-4 && t < 1 - 1e-4) ts.add(round2(t * 1000) / 1000); }
    }
    const sorted = [...ts].sort((a, b) => a - b);
    if (sorted.length <= 2) return [];
    const tAt = Math.max(0, Math.min(1, ((at[0] - e.a[0]) * dx + (at[1] - e.a[1]) * dy) / L2));
    const pieces: SketchEntity[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const t0 = sorted[i]!, t1 = sorted[i + 1]!;
      if (tAt >= t0 && tAt <= t1) continue;
      pieces.push(sk.line([round2(e.a[0] + dx * t0), round2(e.a[1] + dy * t0)], [round2(e.a[0] + dx * t1), round2(e.a[1] + dy * t1)]));
    }
    return pieces;
  }
  if (e.type === 'circle') {
    const angs = new Set<number>();
    for (const o of others) {
      const hits = o.type === 'line' ? lineCircleIntersections(o.a, o.b, e.center, e.radius) : [];
      for (const h of hits) angs.add(Math.atan2(h[1] - e.center[1], h[0] - e.center[0]));
    }
    const sorted = [...angs].sort((a, b) => a - b);
    if (sorted.length < 2) return [];
    const aAt = Math.atan2(at[1] - e.center[1], at[0] - e.center[0]);
    const pt = (t: number): Vec2 => [round2(e.center[0] + Math.cos(t) * e.radius), round2(e.center[1] + Math.sin(t) * e.radius)];
    const pieces: SketchEntity[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const t0 = sorted[i]!, t1 = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 2 * Math.PI;
      let a = aAt; if (a < t0) a += 2 * Math.PI;
      if (a >= t0 && a <= t1) continue;
      pieces.push(sk.arc3(pt(t0), pt((t0 + t1) / 2), pt(t1)));
    }
    return pieces;
  }
  return [];
}
