import { create } from 'zustand';
import {
  History, addFeature, combine as combineDoc, createDocument, duplicate as duplicateDoc, featureById, makeFeature,
  parseDocument, removeFeatures, sampleDocument, serializeDocument, ungroup as ungroupDoc, updateFeature, composeTransforms,
  type EvaluatedFeature, type Feature, type FeatureType, type FormaDocument, type Transform,
} from '@forma/core';
import { workerClient, type ModuleInfo } from './worker-client';

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
  toasts: Toast[];
  fileName: string | null;
}

interface Actions {
  // document
  setDoc(next: FormaDocument, opts?: { undoable?: boolean }): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void; redo(): void;
  canUndo(): boolean; canRedo(): boolean;
  newDocument(): void;
  loadSample(): void;
  openFile(file: File): Promise<void>;
  saveFile(): void;
  // features
  addPrimitive(type: Exclude<FeatureType, 'combine' | 'module' | 'mesh' | 'extrude'>): void;
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
  // selection & view
  select(ids: string[], mode?: 'replace' | 'toggle' | 'add'): void;
  clearSelection(): void;
  toggleGrid(): void; toggleWireframe(): void;
  // export
  exportModel(format: 'stl' | '3mf', onlySelection?: boolean): Promise<void>;
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
    set({ doc, evaluating: true });
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
    showGrid: true,
    wireframe: false,
    toasts: [],
    fileName: null,

    setDoc: (next, opts) => apply(next, opts?.undoable ?? true),
    beginGesture: () => { if (!gestureBefore) gestureBefore = history.value; },
    endGesture: () => {
      if (gestureBefore && gestureBefore !== history.value) history.checkpoint(gestureBefore);
      gestureBefore = null;
    },
    undo: () => { const d = history.undo(); set({ doc: d, selection: get().selection.filter((id) => featureById(d, id)) }); workerClient.evaluate(d); persist(d); },
    redo: () => { const d = history.redo(); set({ doc: d, selection: get().selection.filter((id) => featureById(d, id)) }); workerClient.evaluate(d); persist(d); },
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

    addPrimitive: (type) => {
      const doc = get().doc;
      const t = placeNew();
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

    exportModel: async (format, onlySelection) => {
      const { doc, selection } = get();
      const ids = onlySelection && selection.length ? selection : undefined;
      try {
        get().toast(format === 'stl' ? 'Unioning parts for STL…' : 'Packing 3MF…');
        const bytes = await workerClient.exportModel(doc, format, ids);
        const base = doc.name.replace(/[^\w-]+/g, '_') || 'model';
        download(bytes, `${base}.${format}`, format === 'stl' ? 'model/stl' : 'model/3mf');
        get().toast(`Exported ${base}.${format} (${(bytes.length / 1024).toFixed(0)} KB)`);
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
