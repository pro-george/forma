import { create } from 'zustand';
import {
  History, addFeature, combine as combineDoc, splitFeature as splitDoc, createDocument, duplicate as duplicateDoc, featureById, makeFeature,
  parseDocument, removeFeatures, sampleDocument, serializeDocument, ungroup as ungroupDoc, updateFeature, composeTransforms,
  type EvaluatedFeature, type Feature, type FeatureType, type FormaDocument, type Transform,
} from '@forma/core';
import { useViewStore } from './view';
import { planeTransform } from './plane';
import { workerClient, type ModuleInfo, type ExportFormat } from './worker-client';

export interface Toast { id: number; text: string; kind?: 'info' | 'error'; }

interface State {
  doc: FormaDocument;
  results: Map<string, EvaluatedFeature>;
  evaluating: boolean;
  lastEvalMs: number;
  ready: boolean;
  modules: ModuleInfo[];
  selection: string[];
  showGrid: boolean;
  wireframe: boolean;
  /** matte PLA-like shading with a hard key light, to judge relief the way a print will look */
  printLook: boolean;
  toasts: Toast[];
  fileName: string | null;
}

interface Actions {
  // document
  setDoc(next: FormaDocument, opts?: { undoable?: boolean }): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void; redo(): void;
  /** timeline for the history strip */
  timeline(): { past: readonly FormaDocument[]; current: FormaDocument; future: readonly FormaDocument[] };
  jumpHistory(delta: number): void;
  /** bumps on every history change so the strip re-renders */
  historyTick: number;
  canUndo(): boolean; canRedo(): boolean;
  newDocument(): void;
  loadSample(): void;
  openFile(file: File): Promise<void>;
  saveFile(): void;
  // features
  /** `at` places the part with its base centred on that point and standing on that normal; otherwise it lands at the last pointed ground spot. */
  addPrimitive(type: Exclude<FeatureType, 'combine' | 'module' | 'mesh' | 'extrude'>, at?: { point: [number, number, number]; normal: [number, number, number] }): void;
  addModule(id: string): void;
  patchFeature(id: string, patch: Partial<Feature> | ((f: Feature) => Feature), opts?: { undoable?: boolean }): void;
  setTransform(id: string, t: Partial<Transform>, opts?: { undoable?: boolean }): void;
  moveSelectionBy(dx: number, dy: number, dz: number): void;
  toggleRole(ids?: string[]): void;
  toggleVisible(id: string): void;
  combineSelected(): void;
  ungroupSelected(): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  bakeModule(id: string): Promise<void>;
  rotateSelected(deg: number): void;
  splitFeature(id: string, opts: { axis: 'x' | 'y' | 'z'; at: number; gap: number }): void;
  // selection & view
  select(ids: string[], mode?: 'replace' | 'toggle' | 'add'): void;
  clearSelection(): void;
  toggleGrid(): void; toggleWireframe(): void; togglePrintLook(): void;
  // export
  exportModel(format: ExportFormat, onlySelection?: boolean): Promise<void>;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

const STORAGE_KEY = 'forma.studio.doc.v1';

function loadInitial(): FormaDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseDocument(JSON.parse(raw));
  } catch { /* fall through */ }
  return sampleDocument();
}

const history = new History(loadInitial());
let gestureBefore: FormaDocument | null = null;
let toastId = 0;
let saveTimer: number | undefined;

function persist(doc: FormaDocument) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)); } catch { /* quota */ } }, 400);
}

function download(bytes: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const useStore = create<State & Actions>((set, get) => {
  const apply = (next: FormaDocument, undoable = true) => {
    const doc = undoable && !gestureBefore ? history.commit(next) : history.replace(next);
    set({ doc, evaluating: true, historyTick: get().historyTick + 1 });
    workerClient.evaluate(doc);
    persist(doc);
  };

  workerClient.onResult((res, doc) => {
    if (doc !== get().doc && doc !== history.value) return; // stale
    const map = new Map<string, EvaluatedFeature>();
    for (const f of res.features) map.set(f.id, f);
    set({ results: map, evaluating: false, lastEvalMs: res.totalMs });
  });
  workerClient.onError((e) => { set({ evaluating: false }); get().toast(`Geometry error: ${e.message}`, 'error'); });
  workerClient.whenReady().then(({ modules }) => {
    set({ ready: true, modules });
    workerClient.evaluate(get().doc);
  });

  const snap5 = (v: number) => Math.round(v / 5) * 5;
  /** Where the pointer last touched the ground, snapped to 5 mm. */
  const placeAtPointer = (): Transform | null => {
    const g = useViewStore.getState().ground;
    if (!g) return null;
    return { position: { x: snap5(g[0]), y: snap5(g[1]), z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  };
  /** Standing on a plane through `point` with the given up normal (a face, or the ground). */
  const placeOn = (point: [number, number, number], normal: [number, number, number]): Transform => {
    const t = planeTransform(point, normal);
    if (Math.abs(normal[2] - 1) < 1e-6) t.position = { x: snap5(point[0]), y: snap5(point[1]), z: Math.round(point[2] * 10) / 10 };
    return t;
  };
  const placeNew = (): Transform => {
    const n = get().doc.features.filter((f) => f.parentId === null).length;
    return { position: { x: ((n % 4) - 1.5) * 30, y: (Math.floor(n / 4) % 4 - 1.5) * 30, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  };

  return {
    doc: history.value,
    results: new Map(),
    evaluating: true,
    lastEvalMs: 0,
    ready: false,
    modules: [],
    selection: [],
    historyTick: 0,
    showGrid: true,
    wireframe: false,
    printLook: false,
    toasts: [],
    fileName: null,

    setDoc: (next, opts) => apply(next, opts?.undoable ?? true),
    beginGesture: () => { if (!gestureBefore) gestureBefore = history.value; },
    endGesture: () => {
      if (gestureBefore && gestureBefore !== history.value) { history.checkpoint(gestureBefore); set({ historyTick: get().historyTick + 1 }); }
      gestureBefore = null;
    },
    timeline: () => history.entries(),
    jumpHistory: (delta) => { const d = history.jump(delta); set({ doc: d, selection: get().selection.filter((id) => featureById(d, id)), historyTick: get().historyTick + 1 }); workerClient.evaluate(d); persist(d); },
    undo: () => { const d = history.undo(); set({ doc: d, selection: get().selection.filter((id) => featureById(d, id)), historyTick: get().historyTick + 1 }); workerClient.evaluate(d); persist(d); },
    redo: () => { const d = history.redo(); set({ doc: d, selection: get().selection.filter((id) => featureById(d, id)), historyTick: get().historyTick + 1 }); workerClient.evaluate(d); persist(d); },
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
    newDocument: () => { set({ selection: [], fileName: null }); apply(createDocument()); },
    loadSample: () => { set({ selection: [], fileName: null }); apply(sampleDocument()); },
    openFile: async (file) => {
      try {
        const doc = parseDocument(JSON.parse(await file.text()));
        set({ selection: [], fileName: file.name });
        apply(doc);
        get().toast(`Opened ${file.name}`);
      } catch (e) { get().toast(`Could not open file: ${(e as Error).message}`, 'error'); }
    },
    saveFile: () => {
      const { doc, fileName } = get();
      const name = fileName ?? `${doc.name.replace(/[^\w-]+/g, '_') || 'model'}.forma`;
      download(serializeDocument(doc), name, 'application/json');
      set({ fileName: name });
    },

    addPrimitive: (type, at) => {
      const doc = get().doc;
      const t = at ? placeOn(at.point, at.normal) : placeAtPointer() ?? placeNew();
      let f: Feature;
      switch (type) {
        case 'box': f = makeFeature(doc, 'box', { width: 40, depth: 30, height: 20, transform: t }); break;
        case 'cylinder': f = makeFeature(doc, 'cylinder', { radius: 15, height: 30, transform: t }); break;
        case 'cone': f = makeFeature(doc, 'cone', { radiusBottom: 15, radiusTop: 0, height: 30, transform: t }); break;
        case 'sphere': f = makeFeature(doc, 'sphere', { radius: 15, transform: t }); break;
        case 'torus': f = makeFeature(doc, 'torus', { ringRadius: 18, tubeRadius: 5, transform: t }); break;
        case 'tube': f = makeFeature(doc, 'tube', { radius: 15, innerRadius: 11, height: 30, transform: t }); break;
        case 'revolve': f = makeFeature(doc, 'revolve', { height: 60, profile: [[20, 0], [27, 0.14], [30, 0.34], [21, 0.56], [24, 0.76], [17, 0.9], [20, 1]], transform: t }); break;
      }
      apply(addFeature(doc, f));
      set({ selection: [f.id] });
    },
    addModule: (moduleId) => {
      const doc = get().doc;
      const info = get().modules.find((m) => m.id === moduleId);
      const f = makeFeature(doc, 'module', { name: info?.name ?? moduleId, moduleId, inputs: {}, transform: placeNew() });
      apply(addFeature(doc, f));
      set({ selection: [f.id] });
    },
    patchFeature: (id, patch, opts) => apply(updateFeature(get().doc, id, patch), opts?.undoable ?? true),
    setTransform: (id, t, opts) => apply(updateFeature(get().doc, id, (f) => ({ ...f, transform: { ...f.transform, ...t } })), opts?.undoable ?? true),
    moveSelectionBy: (dx, dy, dz) => {
      let doc = get().doc;
      for (const id of get().selection) {
        const f = featureById(doc, id);
        if (!f || f.parentId) continue;
        doc = updateFeature(doc, id, { transform: { ...f.transform, position: { x: f.transform.position.x + dx, y: f.transform.position.y + dy, z: f.transform.position.z + dz } } });
      }
      apply(doc);
    },
    toggleRole: (ids) => {
      let doc = get().doc;
      for (const id of ids ?? get().selection) doc = updateFeature(doc, id, (f) => ({ ...f, role: f.role === 'hole' ? 'solid' : 'hole' }));
      apply(doc);
    },
    toggleVisible: (id) => apply(updateFeature(get().doc, id, (f) => ({ ...f, visible: !f.visible }))),
    splitFeature: (id, opts) => {
      try {
        const r = splitDoc(get().doc, id, opts);
        apply(r.doc);
        set({ selection: r.ids });
        get().toast('Split into two parts');
      } catch (e) { get().toast((e as Error).message, 'error'); }
    },
    combineSelected: () => {
      const { doc, selection } = get();
      const top = selection.filter((id) => featureById(doc, id)?.parentId === null);
      if (top.length < 2) { get().toast('Select two or more parts to combine'); return; }
      if (!top.some((id) => featureById(doc, id)?.role === 'solid')) { get().toast('A combine needs at least one solid'); return; }
      const r = combineDoc(doc, top);
      apply(r.doc);
      set({ selection: [r.combineId] });
    },
    ungroupSelected: () => {
      let { doc } = get();
      const cs = get().selection.filter((id) => featureById(doc, id)?.type === 'combine');
      if (!cs.length) { get().toast('Select a combined part to ungroup'); return; }
      const kids: string[] = [];
      for (const id of cs) { const c = featureById(doc, id); if (c?.type === 'combine') kids.push(...c.childIds); doc = ungroupDoc(doc, id); }
      apply(doc);
      set({ selection: kids });
    },
    duplicateSelected: () => {
      const r = duplicateDoc(get().doc, get().selection);
      if (!r.newIds.length) return;
      apply(r.doc);
      set({ selection: r.newIds });
    },
    deleteSelected: () => {
      const sel = get().selection;
      if (!sel.length) return;
      apply(removeFeatures(get().doc, sel));
      set({ selection: [] });
    },
    bakeModule: async (id) => {
      const doc = get().doc;
      const mod = featureById(doc, id);
      if (!mod || mod.type !== 'module') return;
      try {
        const feats = await workerClient.bake(doc, id);
        let next = removeFeatures(doc, [id]);
        const ids: string[] = [];
        for (const f of feats) {
          const placed = makeFeature(next, f.type as never, { ...(f as object), transform: composeTransforms(mod.transform, f.transform) } as never) as Feature;
          next = addFeature(next, placed);
          ids.push(placed.id);
        }
        const r = combineDoc(next, ids, mod.name);
        apply(r.doc);
        set({ selection: [r.combineId] });
        get().toast(`Baked into ${feats.length} editable parts`);
      } catch (e) { get().toast(`Bake failed: ${(e as Error).message}`, 'error'); }
    },
    rotateSelected: (deg) => {
      let doc = get().doc;
      for (const id of get().selection) doc = updateFeature(doc, id, (f) => ({ ...f, transform: { ...f.transform, rotation: { ...f.transform.rotation, z: (f.transform.rotation.z + deg) % 360 } } }));
      apply(doc);
    },

    select: (ids, mode = 'replace') => {
      const cur = get().selection;
      if (mode === 'replace') set({ selection: ids });
      else if (mode === 'add') set({ selection: [...new Set([...cur, ...ids])] });
      else set({ selection: ids.reduce((acc, id) => (acc.includes(id) ? acc.filter((x) => x !== id) : [...acc, id]), cur) });
    },
    clearSelection: () => set({ selection: [] }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    toggleWireframe: () => set((s) => ({ wireframe: !s.wireframe })),
    togglePrintLook: () => set((s) => ({ printLook: !s.printLook })),

    exportModel: async (format, onlySelection) => {
      const { doc: live, selection } = get();
      const ids = onlySelection && selection.length ? selection : undefined;
      // modules with a preview/print "detail" switch always export at print quality
      const doc = { ...live, features: live.features.map((f) => f.type === 'module' && 'detail' in f.inputs ? { ...f, inputs: { ...f.inputs, detail: 'print' } } : f) };
      try {
        get().toast(format === 'stl' ? 'Building print-quality mesh…' : format === 'obj' ? 'Writing OBJ…' : 'Packing 3MF…');
        const bytes = await workerClient.exportModel(doc, format, ids);
        const base = doc.name.replace(/[^\w-]+/g, '_') || 'model';
        const ext = format === 'bambu' ? '3mf' : format;
        download(bytes, `${base}.${ext}`, format === 'stl' ? 'model/stl' : format === 'obj' ? 'model/obj' : 'model/3mf');
        const slots = new Set(doc.features.filter((f) => f.parentId === null && f.visible && f.role === 'solid' && (!ids || ids.includes(f.id))).map((f) => f.filament));
        get().toast(`Exported ${base}.${ext} (${(bytes.length / 1024).toFixed(0)} KB)${format === 'bambu' && slots.size > 1 ? ` · ${slots.size} filament slots` : ''}`);
      } catch (e) { get().toast(`Export failed: ${(e as Error).message}`, 'error'); }
    },
    toast: (text, kind = 'info') => {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
      window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 2600);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
});

export const selectFeature = (id: string) => (s: State) => featureById(s.doc, id);
