import { create } from 'zustand';

/** Floating-panel layout state (collapsed panels), remembered per browser. */
export type PanelId = 'create' | 'parts' | 'props';

const KEY = 'forma.ui.v1';
function load(): Record<PanelId, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { create: false, parts: false, props: false, ...JSON.parse(raw) };
  } catch { /* private mode or blocked storage: fall through */ }
  return { create: false, parts: false, props: false };
}

export const useUI = create<{
  collapsed: Record<PanelId, boolean>;
  toggle(id: PanelId): void;
  setCollapsed(id: PanelId, v: boolean): void;
}>((set, get) => ({
  collapsed: load(),
  toggle: (id) => get().setCollapsed(id, !get().collapsed[id]),
  setCollapsed: (id, v) => {
    const collapsed = { ...get().collapsed, [id]: v };
    set({ collapsed });
    try { localStorage.setItem(KEY, JSON.stringify(collapsed)); } catch { /* ignore */ }
  },
}));
