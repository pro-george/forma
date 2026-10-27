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
  // toolbar
  select: () => <P d="M5 3l14 9-6 1.5L16 20l-3 1.5-3-6.5L5 19z" />,
  plus: () => <P d="M12 5v14M5 12h14" />,
  sketch: () => <P d="M4 20l4-1 11-11-3-3L5 16z M14 7l3 3 M4 20l1-4" />,
  sketchFace: () => <P d="M3 8l9-5 9 5-9 5z M3 8v8l9 5 9-5V8 M13 16l5-5" />,
  pushpull: () => <P d="M3 14l9 5 9-5 M3 10l9 5 9-5-9-5z M12 15V3 M9 6l3-3 3 3" />,
  edges: () => <P d="M4 20V10a6 6 0 016-6h10 M4 14h5a5 5 0 005-5V4" />,
  move: () => <P d="M12 3v18M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3" />,
  rotate: () => <P d="M20 12a8 8 0 11-3-6.2 M20 4v5h-5" />,
  grid: () => <P d="M3 3h18v18H3z M3 9h18M3 15h18M9 3v18M15 3v18" />,
  wire: () => <P d="M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10 M3 17l9-6 9 6" />,
  light: () => <P d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4 M12 8a4 4 0 100 8 4 4 0 000-8z" />,
  fit: () => <P d="M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5 M9 9h6v6H9z" />,
  camera: () => <P d="M3 7l9-5 9 5v10l-9 5-9-5z M12 12l9-5 M12 12v10 M12 12L3 7" />,
  trash: () => <P d="M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6M14 11v6" />,
  copy: () => <P d="M8 8h12v12H8z M16 8V4H4v12h4" />,
  layers: () => <P d="M12 3l9 5-9 5-9-5z M3 13l9 5 9-5 M3 17l9 5 9-5" />,
  dots: () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>,
  split: () => <P d="M12 3v18 M4 6h5v12H4z M15 6h5v12h-5z" />,
  first: () => <P d="M6 5v14 M18 5l-9 7 9 7z" />,
  last: () => <P d="M18 5v14 M6 5l9 7-9 7z" />,
  prev: () => <P d="M15 5l-7 7 7 7" />,
  next: () => <P d="M9 5l7 7-7 7" />,
  file: () => <P d="M6 3h8l4 4v14H6z M14 3v4h4" />,
  check: () => <P d="M5 12l5 5 9-10" />,
  chevron: () => <P d="M6 9l6 6 6-6" />,
  hole: () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="12" cy="12" r="4" /></svg>,
};

export const featureIcon = (type: FeatureType) => {
  const C = Icon[type] ?? Icon.box;
  return <C />;
};
