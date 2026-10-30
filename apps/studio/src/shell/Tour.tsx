import { useState } from 'react';
import { useUI } from '../state/ui';

/**
 * Getting Started: a short, skippable, step-by-step tour of the workflow.
 * Each step explains both the mouse and the touch way, highlighting the one
 * this run is using. Auto-shows once; reopen from Menu → Help.
 */
interface Step { title: string; body: string; mouse?: string; touch?: string; where?: string; phone?: string }

const STEPS: Step[] = [
  { title: 'Welcome to Forma', body: 'Forma is a parametric 3D modeler for printing: sketch a 2D shape, turn it into a solid, then keep refining it. This quick tour covers the essentials — it takes a minute. Reopen it anytime from Menu → Help → Getting Started.' },
  { title: 'Moving the view', body: 'Orbit, pan and zoom to look at your model from any angle. The axes in the bottom-right corner show where you are; Frame Selection (F) zooms onto whatever is selected.', mouse: 'Left-drag to orbit, right-drag to pan, wheel to zoom.', touch: 'Drag one finger to orbit; use two fingers to pan and pinch-zoom.', where: 'View actions live behind the ☰ menu in the top-left chip.', phone: 'View actions are in the ☰ menu, top-left.' },
  { title: 'Selecting things', body: 'Click a face or an edge to select it — most tools act on the current selection. Double-click selects the whole body and shows the move handles. A small context menu gives quick actions on whatever you are pointing at.', mouse: 'Click to select, Ctrl/⌘-click to add more. Right-click for the context menu.', touch: 'Tap to select; use the on-screen Multi toggle to add more. Press and hold for the context menu.', phone: 'Choose what a tap picks with the Body / Face / Edge switch at the bottom, then tap the model. Press and hold for the menu.' },
  { title: 'Sketching a shape', body: 'Solids start as 2D sketches: pick a plane or a flat face to draw on, then lay down lines, rectangles and circles on the grid. Type a number while drawing to set an exact size, then finish the sketch with ✓.', mouse: 'Click to place points; Enter finishes a shape, Esc cancels it.', touch: 'Tap to place points, or press-drag-release to draw a segment. Use the ✓ / ✗ buttons in the corner.', where: 'Tap the + button (bottom-right) and choose New Sketch, or select a flat face and choose Sketch.', phone: 'Tap Create (bottom-right) → a plane, or pick a face and tap Sketch. Type exact sizes in the field above the buttons.' },
  { title: 'From sketch to solid', body: 'Select a flat face or a sketch and use Push/Pull to give it depth: drag the arrow or type a distance, positive adds, negative cuts, then ✓ applies it. Pick an edge for Fillet / Chamfer. Nothing changes until you confirm.', where: 'Select something and the floating tool dock on the left fills with the tools that apply.', phone: 'Select something and the row above the switch fills with the tools that apply; the line under the top bar always says what to do next.' },
  { title: 'History and undo', body: 'Every part is a step in the timeline at the bottom. Forma is parametric: tap a step to change its numbers and everything rebuilds; Go Here rolls the model back to that step.', mouse: 'Undo / redo with ⌘Z / ⌘Y, or from the arrows in the top-right corner.', touch: 'Undo / redo with the arrows in the top-right corner — or a two-finger tap (undo) and three-finger tap (redo).', phone: 'The list button (top-right) opens Items and History; tap a step to edit it or Go Here.' },
  { title: 'Filaments and export', body: 'Each body has a filament slot — the tray of your AMS. Set it in the items list on the right. Export → 3MF for Bambu Studio writes the slot of every part, so the print lands in the right trays. STL and OBJ are there too.', where: 'Export lives behind the ☰ menu.', phone: 'Filaments are at the bottom of the Items sheet; Export is in the ☰ menu.' },
  { title: "You're ready", body: 'Start with + → Primitive → Box, double-click it, pull a face, round an edge. Everything is undoable, and your project autosaves in this browser; Save Project downloads a .forma file you can reopen anywhere.' },
];

export function Tour() {
  const open = useUI((u) => u.tour);
  const touch = useUI((u) => u.touch || u.phone);
  const phone = useUI((u) => u.phone);
  const done = useUI((u) => u.markTourSeen);
  const [i, setI] = useState(0);
  if (!open) return null;
  const s = STEPS[i]!;
  const last = i === STEPS.length - 1;
  return (
    <div className="modal-back" onClick={done}>
      <div className="modal tour" onClick={(e) => e.stopPropagation()}>
        <small className="dim">Step {i + 1} of {STEPS.length}</small>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        {(s.mouse || s.touch) && (
          <ul className="tour-io">
            {touch ? <><li className="hi"><b>Touch:</b> {s.touch}</li>{s.mouse && <li><b>Mouse:</b> {s.mouse}</li>}</> : <><li className="hi"><b>Mouse:</b> {s.mouse}</li>{s.touch && <li><b>Touch:</b> {s.touch}</li>}</>}
          </ul>
        )}
        {(phone ? s.phone : s.where) && <p className="tour-where">In this layout: {phone ? s.phone : s.where}</p>}
        <div className="foot">
          <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>Back</button>
          <span className="spacer" />
          <button onClick={done}>{last ? 'Close' : 'Skip'}</button>
          {!last ? <button className="primary" onClick={() => setI(i + 1)}>Next</button> : <button className="primary" onClick={done}>Finish</button>}
        </div>
      </div>
    </div>
  );
}
