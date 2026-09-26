import type { FeatureType } from '@forma/core';

const P = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

export const Icon = {
  box: () => <P d="M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10" />,
  cylinder: () => <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /></svg>,
  cone: () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 15H4z" /><ellipse cx="12" cy="18" rx="8" ry="3" /></svg>,
  sphere: () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="9" ry="3.5" /></svg>,
  torus: () => <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="5" /><ellipse cx="12" cy="12" rx="3.5" ry="1.8" /></svg>,
  tube: () => <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="8" ry="3" /><ellipse cx="12" cy="6" rx="3.5" ry="1.4" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /></svg>,
  revolve: () => <P d="M9 3c-3 4 3 7 0 11-2 3-1 5 1 7h4c2-2 3-4 1-7-3-4 3-7 0-11z M12 3v18" />,
  extrude: () => <P d="M4 18l5-11 5 6 3-4 3 9z M4 18v3h16v-3" />,
  mesh: () => <P d="M5 14c-2-6 4-11 9-8s6 9 2 12-9 1-11-4z" />,
  combine: () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></svg>,
  ungroup: () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="12" r="5" /><circle cx="17" cy="12" r="5" strokeDasharray="2 2" /></svg>,
  module: () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><path d="M17 14v6M14 17h6" /></svg>,
  eye: () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  undo: () => <P d="M9 14L4 9l5-5 M4 9h10a6 6 0 010 12h-3" />,
  redo: () => <P d="M15 14l5-5-5-5 M20 9H10a6 6 0 000 12h3" />,
  download: () => <P d="M12 3v12m-5-5l5 5 5-5 M4 21h16" />,
};

export const featureIcon = (type: FeatureType) => {
  const C = Icon[type] ?? Icon.box;
  return <C />;
};
