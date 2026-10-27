import { create } from 'zustand';

/** Floating-panel layout state (collapsed panels), remembered per browser. */
export type PanelId = 'create' | 'layers' | 'props';

const KEY = 'forma.ui.v2';
function load(): Record<PanelId, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { create: false, layers: false, props: false, ...JSON.parse(raw) };
  } catch { /* private mode or blocked storage: fall through */ }
  return { create: false, layers: false, props: false };
}

export const useUI = create<{
  collapsed: Record<PanelId, boolean>;
  /** phone layout: the one bottom sheet that is open */
  sheet: PanelId | null;
  toggle(id: PanelId): void;
  setCollapsed(id: PanelId, v: boolean): void;
  openSheet(id: PanelId | null): void;
}>((set, get) => ({
  collapsed: load(),
  sheet: null,
  openSheet: (sheet) => set((s) => ({ sheet: s.sheet === sheet ? null : sheet })),
  toggle: (id) => get().setCollapsed(id, !get().collapsed[id]),
  setCollapsed: (id, v) => {
    const collapsed = { ...get().collapsed, [id]: v };
    set({ collapsed });
    try { localStorage.setItem(KEY, JSON.stringify(collapsed)); } catch { /* ignore */ }
  },
}));
