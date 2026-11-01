import { create } from 'zustand';

/** Shell state remembered per browser: open panels, theme, touch mode, grid step, onboarding. */
export type PanelId = 'create' | 'layers' | 'props';

const KEY = 'forma.ui.v3';
interface Persisted { light: boolean; touch: boolean; gridStep: number; snap: boolean; angleSnap: number; tooltips: boolean; tree: boolean; timeline: boolean; tourSeen: boolean }
function load(): Persisted {
  const def: Persisted = { light: false, touch: matchMedia('(pointer: coarse)').matches, gridStep: 1, snap: true, angleSnap: 15, tooltips: true, tree: window.innerWidth > 600, timeline: true, tourSeen: false };
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...def, ...JSON.parse(raw) }; } catch { /* blocked storage */ }
  return def;
}
const save = (p: Persisted) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } };

export const useUI = create<Persisted & {
  sheet: PanelId | null;
  tour: boolean;
  shortcuts: boolean;
  /** legacy panel collapse map (mobile shell) */
  collapsed: Record<PanelId, boolean>;
  toggle(id: PanelId): void;
  setCollapsed(id: PanelId, v: boolean): void;
  openSheet(id: PanelId | null): void;
  setLight(v: boolean): void;
  setTouch(v: boolean): void;
  setGridStep(v: number): void;
  setSnap(v: boolean): void;
  setAngleSnap(v: number): void;
  setTooltips(v: boolean): void;
  settings: boolean;
  setSettings(v: boolean): void;
  measure: boolean;
  setMeasure(v: boolean): void;
  setTree(v: boolean): void;
  setTimeline(v: boolean): void;
  setTour(v: boolean): void;
  setShortcuts(v: boolean): void;
  markTourSeen(): void;
}>((set, get) => {
  const persist = () => { const { light, touch, gridStep, snap, angleSnap, tooltips, tree, timeline, tourSeen } = get(); save({ light, touch, gridStep, snap, angleSnap, tooltips, tree, timeline, tourSeen }); };
  const init = load();
  return {
    ...init,
    sheet: null,
    tour: !init.tourSeen,
    shortcuts: false,
    collapsed: { create: false, layers: false, props: false },
    toggle: (id) => get().setCollapsed(id, !get().collapsed[id]),
    setCollapsed: (id, v) => set({ collapsed: { ...get().collapsed, [id]: v } }),
    openSheet: (sheet) => set((s) => ({ sheet: sheet === null ? null : s.sheet === sheet ? null : sheet })),
    setLight: (light) => { set({ light }); persist(); },
    setTouch: (touch) => { set({ touch }); persist(); },
    setGridStep: (gridStep) => { set({ gridStep }); persist(); },
    setSnap: (snap) => { set({ snap }); persist(); },
    setAngleSnap: (angleSnap) => { set({ angleSnap }); persist(); },
    setTooltips: (tooltips) => { set({ tooltips }); persist(); },
    settings: false,
    setSettings: (settings) => set({ settings }),
    measure: false,
    setMeasure: (measure) => set({ measure }),
    setTree: (tree) => { set({ tree }); persist(); },
    setTimeline: (timeline) => { set({ timeline }); persist(); },
    setTour: (tour) => set({ tour }),
    setShortcuts: (shortcuts) => set({ shortcuts }),
    markTourSeen: () => { set({ tourSeen: true, tour: false }); persist(); },
  };
});
