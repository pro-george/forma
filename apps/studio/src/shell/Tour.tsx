import { useState } from 'react';
import { useUI } from '../state/ui';

/**
 * Getting Started: a short, skippable, step-by-step tour of the workflow.
 * Each step explains both the mouse and the touch way, highlighting the one
 * this run is using. Auto-shows once; reopen from Menu → Help.
 */
interface Step { title: string; body: string; mouse?: string; touch?: string; where?: string }

const STEPS: Step[] = [
  { title: 'Welcome to Forma', body: 'Forma is a parametric modeler: sketch a 2D shape, turn it into a solid, then keep refining it. This quick tour covers the essentials — it takes a minute. Reopen it anytime from ☰ → Help → Getting Started.' },
  { title: 'Moving the view', body: 'Orbit, pan and zoom to look at your model from any angle. The axes in the corner show where you are; Frame Selection zooms onto whatever is selected.', mouse: 'Left-drag to orbit, right-drag to pan, wheel to zoom.', touch: 'Drag one finger to orbit; use two fingers to pan and pinch-zoom.', where: 'View actions live behind the ☰ menu in the top-left chip.' },
  { title: 'Selecting things', body: 'Tap a face, an edge or a body to select it — most tools act on the current selection. Double-tap selects the whole body and shows the move handles.', mouse: 'Click to select, Ctrl/⌘-click to add more. Right-click for the context menu.', touch: 'Tap to select; use the on-screen Multi toggle to add more. Press and hold for the context menu.' },
  { title: 'Sketching a shape', body: 'Solids start as 2D sketches: pick a plane or a flat face to draw on, then lay down lines, rectangles and circles. Type a number while drawing to set an exact size, then finish the sketch with ✓.', mouse: 'Click to place points; Enter finishes a shape, Esc cancels it.', touch: 'Tap to place points, or press-drag-release to draw a segment. Use the ✓ / ✗ buttons in the corner.', where: 'Tap the + button (bottom-right) and choose New Sketch, or select a flat face and choose Sketch.' },
  { title: 'From sketch to solid', body: 'Select a face or a sketch region and use Push to give it depth: drag the arrow or type a distance, positive adds, negative cuts, then ✓ applies it. Pick an edge for Fillet / Chamfer. Nothing changes until you confirm.', where: 'Select something and the tool dock on the left edge fills with the tools that apply.' },
  { title: 'History and undo', body: 'Every step is a box in the timeline at the bottom. Tap a step to change its numbers and everything rebuilds; Go Here rolls the model back to that step; Disable skips it.', mouse: 'Undo / redo with ⌘Z / ⌘Y, or from the arrows in the top-right corner.', touch: 'Undo / redo with the arrows in the top-right corner — or a two-finger tap (undo) and three-finger tap (redo).', where: 'Tap the History button at the bottom-left to show or hide the timeline.' },
  { title: 'Organize, save and export', body: 'The items list on the right holds your bodies and sketches: the eye hides one, press and hold to rename or delete. Save Project keeps a .forma file you can reopen anywhere. Export writes STL, 3MF or OBJ — only visible bodies are exported.', where: 'The list button in the top-right shows the items; Export lives behind the ☰ menu.' },
  { title: 'Several projects at once', body: 'The project chip at the top shows the name, a dot when there are unsaved changes, and what is selected. Tap it to save, save as, or open another project.', where: 'Tap the project name in the top-left chip.' },
  { title: 'Need more room?', body: 'im-touch is already minimal: everything floats over a full-screen model. Hide Panels in the View menu clears the items list and the timeline; tooltips and touch mode are in Settings.' },
  { title: "You're ready", body: 'Start with + → Primitive → Box, double-tap it, push a face, round an edge. Everything is undoable, and your project autosaves in this browser.' },
];

export function Tour() {
  const open = useUI((u) => u.tour);
  const touch = useUI((u) => u.touch);
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
        {s.where && <p className="tour-where">In this layout: {s.where}</p>}
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
