/**
 * Sketch editing state and geometry helpers for the studio. The document
 * stays the source of truth (the extrude feature's `sketch`); this slice
 * holds only the transient editing state: tool, draft points, cursor, typed
 * numbers, selection.
 */
import { create } from 'zustand';
import { addFeature, featureById, makeFeature, removeFeatures, sk, sketchToProfiles, endpoints, type FeatureOf, type FormaDocument, type Sketch, type SketchEntity, type Vec2 } from '@forma/core';
import { useStore } from './store';
import { useViewStore } from './view';

export type SketchTool = 'select' | 'line' | 'rect' | 'circle' | 'arc';

export interface SnapResult { p: Vec2; kind: 'grid' | 'point' | 'axis' | 'free'; ref?: Vec2 }

interface SketchState {
  active: null | {
    featureId: string;
    tool: SketchTool;
    draft: Vec2[];
    cursor: Vec2 | null;
    snap: SnapResult | null;
    typed: string;
    selected: string | null;
    hoverVertex: Vec2 | null;
    dragVertex: { from: Vec2; ids: string[] } | null;
    docAtEntry: FormaDocument;
  };
  start(featureId: string): void;
  createAndStart(): void;
  setTool(t: SketchTool): void;
  move(local: Vec2, mods: { shift: boolean; alt: boolean }): void;
  click(local: Vec2, mods: { shift: boolean; alt: boolean }): void;
  doubleClick(): void;
  typeChar(c: string): void;
  backspace(): void;
  enter(): void;
  escape(): void;
  select(id: string | null): void;
  deleteSelected(): void;
  beginVertexDrag(local: Vec2): boolean;
  dragVertexTo(local: Vec2, mods: { shift: boolean; alt: boolean }): void;
  endVertexDrag(): void;
  finish(): void;
  cancel(): void;
}

const GRID = 1;
const POINT_SNAP = 1.6;
const round2 = (v: number) => Math.round(v * 100) / 100;

function currentSketch(featureId: string): Sketch {
  const f = featureById(useStore.getState().doc, featureId);
  return f && f.type === 'extrude' && f.sketch ? f.sketch : { entities: [] };
}

function writeSketch(featureId: string, entities: SketchEntity[], undoable: boolean) {
  useStore.getState().patchFeature(featureId, { sketch: { entities } } as Partial<FeatureOf<'extrude'>>, { undoable });
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

export function computeSnap(raw: Vec2, sketch: Sketch, anchor: Vec2 | null, mods: { shift: boolean; alt: boolean }, extra: Vec2[] = []): SnapResult {
  if (mods.alt) return { p: [round2(raw[0]), round2(raw[1])], kind: 'free' };
  // 1. existing points
  let best: Vec2 | null = null, bd = POINT_SNAP;
  for (const p of [...snapPoints(sketch), ...extra]) { const d = Math.hypot(p[0] - raw[0], p[1] - raw[1]); if (d < bd) { bd = d; best = p; } }
  if (best) return { p: best, kind: 'point' };
  // 2. axis alignment with the anchor (horizontal / vertical / 45° with shift)
  let p: Vec2 = [Math.round(raw[0] / GRID) * GRID, Math.round(raw[1] / GRID) * GRID];
  if (anchor) {
    const dx = raw[0] - anchor[0], dy = raw[1] - anchor[1], len = Math.hypot(dx, dy);
    if (len > 0.5) {
      if (mods.shift) {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const L = Math.round(len / GRID) * GRID;
        return { p: [round2(anchor[0] + Math.cos(a) * L), round2(anchor[1] + Math.sin(a) * L)], kind: 'axis', ref: anchor };
      }
      const tol = Math.max(0.8, len * 0.06);
      if (Math.abs(dy) < tol) return { p: [p[0], anchor[1]], kind: 'axis', ref: anchor };
      if (Math.abs(dx) < tol) return { p: [anchor[0], p[1]], kind: 'axis', ref: anchor };
    }
  }
  return { p, kind: 'grid' };
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
  const commitEntities = (add: SketchEntity[]) => {
    const a = get().active!;
    writeSketch(a.featureId, [...currentSketch(a.featureId).entities, ...add], true);
  };
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
      set({ active: { featureId, tool: 'line', draft: [], cursor: null, snap: null, typed: '', selected: null, hoverVertex: null, dragVertex: null, docAtEntry: useStore.getState().doc } });
      useViewStore.getState().setPreset('top');
    },
    createAndStart: () => {
      const st = useStore.getState();
      const n = st.doc.features.filter((x) => x.parentId === null).length;
      const f = makeFeature(st.doc, 'extrude', { sketch: { entities: [] }, height: 10, transform: { position: { x: ((n % 4) - 1.5) * 30, y: (Math.floor(n / 4) % 4 - 1.5) * 30, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } });
      st.setDoc(addFeature(st.doc, f));
      get().start(f.id);
    },
    setTool: (tool) => upd({ tool, draft: [], typed: '' }),
    move: (local, mods) => {
      const a = get().active; if (!a) return;
      const sketch = currentSketch(a.featureId);
      const anchor = a.draft.length ? a.draft[a.draft.length - 1]! : null;
      const snap = computeSnap(local, sketch, anchor, mods, a.tool === 'line' && a.draft.length >= 3 ? [a.draft[0]!] : []);
      const hover = snapPoints(sketch).find((p) => Math.hypot(p[0] - local[0], p[1] - local[1]) < POINT_SNAP) ?? null;
      upd({ cursor: local, snap, hoverVertex: a.tool === 'select' ? hover : null });
    },
    click: (local, mods) => {
      const a = get().active; if (!a) return;
      const sketch = currentSketch(a.featureId);
      const anchor = a.draft.length ? a.draft[a.draft.length - 1]! : null;
      let p = computeSnap(local, sketch, anchor, mods, a.tool === 'line' && a.draft.length >= 3 ? [a.draft[0]!] : []).p;
      if (anchor && a.typed && (a.tool === 'line' || a.tool === 'circle' || a.tool === 'rect')) p = withTypedLength(anchor, p, a.typed);
      switch (a.tool) {
        case 'select': return;
        case 'line': {
          if (!anchor) { upd({ draft: [p], typed: '' }); return; }
          if (Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) < 0.01) return;
          const closes = a.draft.length >= 2 && Math.hypot(p[0] - a.draft[0]![0], p[1] - a.draft[0]![1]) < 0.01;
          commitEntities([sk.line(anchor, p)]);
          upd({ draft: closes ? [] : [...a.draft, p], typed: '' });
          return;
        }
        case 'rect': {
          if (!anchor) { upd({ draft: [p], typed: '' }); return; }
          if (Math.abs(p[0] - anchor[0]) < 0.01 || Math.abs(p[1] - anchor[1]) < 0.01) return;
          commitEntities(sk.rect(anchor, p));
          upd({ draft: [], typed: '' });
          return;
        }
        case 'circle': {
          if (!anchor) { upd({ draft: [p], typed: '' }); return; }
          const r = Math.hypot(p[0] - anchor[0], p[1] - anchor[1]);
          if (r < 0.05) return;
          commitEntities([sk.circle(anchor, round2(r))]);
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
      // Enter with a typed length: place the next point along the current cursor direction
      if (a.typed && a.cursor && a.draft.length) { get().click(a.cursor, { shift: false, alt: false }); return; }
      if (a.draft.length) { upd({ draft: [], typed: '' }); return; }
      get().finish();
    },
    escape: () => {
      const a = get().active; if (!a) return;
      if (a.typed) { upd({ typed: '' }); return; }
      if (a.draft.length) { upd({ draft: [], typed: '' }); return; }
      if (a.selected) { upd({ selected: null }); return; }
      get().finish();
    },
    select: (id) => upd({ selected: id }),
    deleteSelected: () => {
      const a = get().active; if (!a || !a.selected) return;
      writeSketch(a.featureId, currentSketch(a.featureId).entities.filter((e) => e.id !== a.selected), true);
      upd({ selected: null });
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
          if (Math.hypot(p[0] - local[0], p[1] - local[1]) < POINT_SNAP) { from = from ?? p; if (Math.hypot(p[0] - from[0], p[1] - from[1]) < 0.01) ids.push(e.id); }
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
      const others: Sketch = { entities: sketch.entities.filter((e) => !ids.includes(e.id)) };
      const target = computeSnap(local, others, null, mods).p;
      const same = (p: Vec2) => Math.hypot(p[0] - from[0], p[1] - from[1]) < 0.01;
      const entities = sketch.entities.map((e): SketchEntity => {
        if (!ids.includes(e.id)) return e;
        if (e.type === 'line') return { ...e, a: same(e.a) ? target : e.a, b: same(e.b) ? target : e.b };
        if (e.type === 'circle') return same(e.center) ? { ...e, center: target } : e;
        // arc: move the whole arc if its centre matched, otherwise keep (endpoint editing of arcs comes with constraints)
        return e;
      });
      writeSketch(a.featureId, entities, false);
      upd({ dragVertex: { from: target, ids }, cursor: local });
    },
    endVertexDrag: () => { const a = get().active; if (!a || !a.dragVertex) return; useStore.getState().endGesture(); upd({ dragVertex: null }); },
    finish: () => {
      const a = get().active; if (!a) return;
      const st = useStore.getState();
      const f = featureById(st.doc, a.featureId);
      if (f && f.type === 'extrude' && f.sketch && sketchToProfiles(f.sketch).profiles.length === 0) {
        // nothing usable was drawn: drop the empty feature instead of leaving an error in the tree
        st.setDoc(removeFeatures(st.doc, [a.featureId]));
        st.clearSelection();
        st.toast('Sketch had no closed outline, nothing was created');
      }
      set({ active: null });
    },
    cancel: () => {
      const a = get().active; if (!a) return;
      useStore.getState().setDoc(a.docAtEntry);
      useStore.getState().clearSelection();
      set({ active: null });
    },
  };
});

/** Summary line for the HUD. */
export function sketchStatus(featureId: string): { closed: number; holes: number; open: number } {
  const s = currentSketch(featureId);
  const r = sketchToProfiles(s);
  return { closed: r.profiles.length, holes: r.profiles.reduce((n, p) => n + p.holes.length, 0), open: r.openIds.length };
}
