/**
 * Edge selection and the fillet / chamfer tool. Edges come from the
 * evaluated mesh of the selected part (straight edges between flat faces);
 * applying a treatment adds one tool body per edge to the part's combine,
 * so every round and chamfer stays an editable feature.
 */
import { create } from 'zustand';
import { meshEdges, edgeToolSection, eulerFromBasis, composeTransforms, addFeature, addToCombine, combine as combineDoc, featureById, makeFeature, type Feature, type FormaDocument, type MeshEdge, type TriangleMesh, type Transform } from '@forma/core';
import { useStore } from './store';

const EPS = 0.02;
const MAX_EDGES = 600;
let lastEdgeClick = 0;
/** true right after an edge was clicked: the canvas reports fat-line hits as "missed" clicks */
export const edgeJustClicked = () => performance.now() - lastEdgeClick < 400;

const cache = new WeakMap<TriangleMesh, MeshEdge[]>();
/** Straight edges of a mesh (memoised); empty when the mesh is too dense to be useful. */
export function edgesFor(mesh: TriangleMesh): MeshEdge[] {
  let e = cache.get(mesh);
  if (!e) {
    e = meshEdges(mesh).edges;
    if (e.length > MAX_EDGES) e = [];
    cache.set(mesh, e);
  }
  return e;
}

export const useEdges = create<{
  hover: { partId: string; index: number } | null;
  selected: { partId: string; indices: number[] } | null;
  kind: 'round' | 'chamfer';
  size: number;
  setHover(h: { partId: string; index: number } | null): void;
  toggle(partId: string, index: number, add: boolean): void;
  clear(): void;
  setKind(k: 'round' | 'chamfer'): void;
  setSize(s: number): void;
  /** Build the tool bodies for the selected edges and add them to the part. */
  apply(): void;
}>((set, get) => ({
  hover: null,
  selected: null,
  kind: 'round',
  size: 2,
  setHover: (hover) => set((s) => (s.hover?.partId === hover?.partId && s.hover?.index === hover?.index ? s : { hover })),
  toggle: (partId, index, add) => {
    lastEdgeClick = performance.now();
    set((s) => {
      if (!add || !s.selected || s.selected.partId !== partId) return { selected: { partId, indices: [index] } };
      const has = s.selected.indices.includes(index);
      return { selected: { partId, indices: has ? s.selected.indices.filter((i) => i !== index) : [...s.selected.indices, index] } };
    });
    // the canvas may report the click as "missed" (fat lines are not meshes) and clear the part: keep it selected
    const keep = () => { const st = useStore.getState(); if (!st.selection.includes(partId)) st.select([partId]); };
    keep(); setTimeout(keep, 0);
  },
  clear: () => set({ selected: null, hover: null }),
  setKind: (kind) => set({ kind }),
  setSize: (size) => set({ size: Math.max(0.1, size) }),
  apply: () => {
    const sel = get().selected;
    if (!sel || sel.indices.length === 0) return;
    const st = useStore.getState();
    const part = featureById(st.doc, sel.partId);
    const result = st.results.get(sel.partId);
    if (!part || !result) return;
    const { kind, size } = get();
    const r = buildEdgeTools(st.doc, part, edgesFor(result.mesh), sel.indices, kind, size);
    if (!r) { st.toast('Those edges cannot take a round of that size', 'error'); return; }
    st.setDoc(r.doc);
    st.select([r.combineId]);
    set({ selected: null, hover: null });
    st.toast(`${kind === 'round' ? 'Rounded' : 'Chamfered'} ${r.count} edge${r.count > 1 ? 's' : ''} — each is a feature in the tree`);
  },
}));

/**
 * Add one tool body per edge (a prism along the edge with a round or chamfer
 * section) to the part's combine. Pure: returns the new document, or null
 * when no edge could take the treatment.
 */
export function buildEdgeTools(doc0: FormaDocument, part: Feature, edges: MeshEdge[], indices: number[], kind: 'round' | 'chamfer', size: number): { doc: FormaDocument; combineId: string; count: number } | null {
  let doc = doc0;
  const ids: string[] = [];
  for (const i of indices) {
    const edge = edges[i];
    if (!edge) continue;
    const sec = edgeToolSection(edge, kind, Math.min(size, edge.length / 2), EPS);
    if (!sec) continue;
    const { u, v } = sec.frame;
    const d = edge.dir;
    const local: Transform = {
      position: { x: edge.a[0] - d[0] * EPS, y: edge.a[1] - d[1] * EPS, z: edge.a[2] - d[2] * EPS },
      rotation: eulerFromBasis({ x: u[0], y: u[1], z: u[2] }, { x: v[0], y: v[1], z: v[2] }, { x: d[0], y: d[1], z: d[2] }),
    };
    const world = composeTransforms(part.transform, local);
    const f = makeFeature(doc, 'extrude', {
      name: `${kind === 'round' ? 'Round' : 'Chamfer'} ${size} mm`, role: sec.role,
      profile: { outer: sec.points, holes: [] }, height: edge.length + 2 * EPS, transform: world,
    });
    doc = addFeature(doc, f);
    ids.push(f.id);
  }
  if (ids.length === 0) return null;
  let combineId: string;
  if (part.type === 'combine') { combineId = part.id; for (const id of ids) doc = addToCombine(doc, combineId, id); }
  else if (part.parentId) { combineId = part.parentId; for (const id of ids) doc = addToCombine(doc, combineId, id); }
  else { const r = combineDoc(doc, [part.id, ...ids], part.name); doc = r.doc; combineId = r.combineId; }
  return { doc, combineId, count: ids.length };
}
