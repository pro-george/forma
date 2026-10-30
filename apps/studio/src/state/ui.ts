import { create } from 'zustand';

/** Shell state remembered per browser: open panels, theme, touch mode, grid step, onboarding. */
export type PanelId = 'create' | 'layers' | 'props';
export type PhoneSheet = 'items' | 'history' | 'create' | 'props' | 'menu' | null;
const PHONE = '(max-width: 600px)';

const KEY = 'forma.ui.v3';
interface Persisted { light: boolean; touch: boolean; gridStep: number; tree: boolean; timeline: boolean; tourSeen: boolean }
function load(): Persisted {
  const def: Persisted = { light: false, touch: matchMedia('(pointer: coarse)').matches, gridStep: 1, tree: window.innerWidth > 600, timeline: true, tourSeen: false };
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...def, ...JSON.parse(raw) }; } catch { /* blocked storage */ }
  return def;
}
const save = (p: Persisted) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } };

export const useUI = create<Persisted & {
  sheet: PanelId | null;
  /** narrow screen: the phone layout (bottom bar + sheets) replaces the floating im-touch shell */
  phone: boolean;
  phoneSheet: PhoneSheet;
  openPhoneSheet(s: PhoneSheet): void;
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
  setTree(v: boolean): void;
  setTimeline(v: boolean): void;
  setTour(v: boolean): void;
  setShortcuts(v: boolean): void;
  markTourSeen(): void;
}>((set, get) => {
  const persist = () => { const { light, touch, gridStep, tree, timeline, tourSeen } = get(); save({ light, touch, gridStep, tree, timeline, tourSeen }); };
  const init = load();
  return {
    ...init,
    sheet: null,
    phone: matchMedia(PHONE).matches,
    phoneSheet: null,
    openPhoneSheet: (phoneSheet) => set({ phoneSheet }),
    tour: !init.tourSeen,
    shortcuts: false,
    collapsed: { create: false, layers: false, props: false },
    toggle: (id) => get().setCollapsed(id, !get().collapsed[id]),
    setCollapsed: (id, v) => set({ collapsed: { ...get().collapsed, [id]: v } }),
    openSheet: (sheet) => set((s) => ({ sheet: sheet === null ? null : s.sheet === sheet ? null : sheet })),
    setLight: (light) => { set({ light }); persist(); },
    setTouch: (touch) => { set({ touch }); persist(); },
    setGridStep: (gridStep) => { set({ gridStep }); persist(); },
    setTree: (tree) => { set({ tree }); persist(); },
    setTimeline: (timeline) => { set({ timeline }); persist(); },
    setTour: (tour) => set({ tour }),
    setShortcuts: (shortcuts) => set({ shortcuts }),
    markTourSeen: () => { set({ tourSeen: true, tour: false }); persist(); },
  };
});

// follow rotations and window resizes
matchMedia(PHONE).addEventListener('change', (e) => useUI.setState({ phone: e.matches, phoneSheet: null }));
