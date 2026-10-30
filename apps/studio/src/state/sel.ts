/**
 * Sub-body selection: faces, edges and sketch regions. Bodies (parts) stay
 * in the document store's `selection`; this slice holds what was picked ON
 * them. The two together give the selection context the tool dock reads:
 *
 *   edges > faces > region > body > nothing
 *
 * Rules (as in Materializr's SelectionManager): a new pick replaces the
 * selection, Ctrl/⌘ (or the Multi toggle) toggles items in; selecting a body
 * drops that body's faces and edges; clicking empty space clears everything.
 */
import { create } from 'zustand';
import { useStore } from './store';

export interface FaceSel { partId: string; faceIndex: number }
export interface EdgeSel { partId: string; index: number }
export interface RegionSel { sketchId: string; index: number }
export type SelContext = 'none' | 'body' | 'face' | 'edge' | 'region' | 'sketch';

interface SelState {
  faces: FaceSel[];
  edges: EdgeSel[];
  regions: RegionSel[];
  /** touch "Multi" toggle: taps add instead of replace */
  multi: boolean;
  /** phone layout: what a tap picks — explicit instead of nearest-wins */
  filter: 'body' | 'face' | 'edge';
  setFilter(f: 'body' | 'face' | 'edge'): void;
  /** the body was picked from the items list, not the viewport: no gizmo until a viewport click (SelectionManager navigationOnly) */
  navOnly: boolean;
  setNavOnly(v: boolean): void;
  pickFace(f: FaceSel, add: boolean): void;
  pickEdge(e: EdgeSel, add: boolean): void;
  pickRegion(r: RegionSel, add: boolean): void;
  /** body selection goes through the document store; this drops the body's sub-picks and the others unless adding */
  pickBody(id: string, add: boolean): void;
  clear(): void;
  setMulti(v: boolean): void;
}

const sameFace = (a: FaceSel, b: FaceSel) => a.partId === b.partId && a.faceIndex === b.faceIndex;
const sameEdge = (a: EdgeSel, b: EdgeSel) => a.partId === b.partId && a.index === b.index;
const sameRegion = (a: RegionSel, b: RegionSel) => a.sketchId === b.sketchId && a.index === b.index;

export const useSel = create<SelState>((set, get) => ({
  filter: 'body',
  setFilter: (filter) => set({ filter }),
  faces: [],
  edges: [],
  regions: [],
  multi: false,
  navOnly: false,
  setNavOnly: (navOnly) => set({ navOnly }),
  setMulti: (multi) => set({ multi }),
  pickFace: (f, add) => {
    const st = useStore.getState();
    if (!add) { st.select([]); set({ faces: [f], edges: [], regions: [] }); return; }
    const has = get().faces.some((x) => sameFace(x, f));
    set({ faces: has ? get().faces.filter((x) => !sameFace(x, f)) : [...get().faces, f] });
  },
  pickEdge: (e, add) => {
    const st = useStore.getState();
    if (!add) { st.select([]); set({ edges: [e], faces: [], regions: [] }); return; }
    const has = get().edges.some((x) => sameEdge(x, e));
    set({ edges: has ? get().edges.filter((x) => !sameEdge(x, e)) : [...get().edges, e] });
  },
  pickRegion: (r, add) => {
    const st = useStore.getState();
    if (!add) { st.select([]); set({ regions: [r], faces: [], edges: [] }); return; }
    const has = get().regions.some((x) => sameRegion(x, r));
    set({ regions: has ? get().regions.filter((x) => !sameRegion(x, r)) : [...get().regions, r] });
  },
  pickBody: (id, add) => {
    const st = useStore.getState();
    // a body swallows its own faces/edges (SelectionManager.cpp:31-40)
    set({ faces: get().faces.filter((x) => x.partId !== id), edges: get().edges.filter((x) => x.partId !== id), regions: add ? get().regions : [] });
    if (!add) { set({ faces: [], edges: [] }); st.select([id]); return; }
    st.select([id], 'toggle');
  },
  clear: () => { set({ faces: [], edges: [], regions: [] }); useStore.getState().clearSelection(); },
}));

/** What the toolbar should offer right now. */
export function selContext(inSketch: boolean): SelContext {
  const s = useSel.getState();
  if (s.regions.length) return 'region';
  if (inSketch) return 'sketch';
  if (s.edges.length) return 'edge';
  if (s.faces.length) return 'face';
  if (useStore.getState().selection.length) return 'body';
  return 'none';
}
