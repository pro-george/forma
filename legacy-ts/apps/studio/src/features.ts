/**
 * Feature flags for everything in the studio that is Forma's own and not part
 * of the Materializr interaction model. The shell is a strict replica of
 * Materializr's im-touch layout; the extras stay in the code, off by default,
 * and come back with `?extras=1` in the URL (or `localStorage.forma.extras = 1`).
 *
 * Covered: the ready-made parametric parts (vases, name tags…), the filament
 * palette and per-part AMS slots, the Bambu 3MF export, the sample scene, the
 * print look, the ground radial "add here" menu, arrange-on-plate.
 */
function read(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('extras');
    if (q === '1') { localStorage.setItem('forma.extras', '1'); return true; }
    if (q === '0') { localStorage.removeItem('forma.extras'); return false; }
    return localStorage.getItem('forma.extras') === '1';
  } catch { return false; }
}

export const EXTRAS = read();
