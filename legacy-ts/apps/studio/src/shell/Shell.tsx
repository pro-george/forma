/**
 * The im-touch layout: near-zero chrome. The viewport fills the screen and
 * everything floats over it — project/menu chips (top-left), undo + menu
 * (top-right), the contextual tool dock on the left edge, the transparent
 * items tree on the right, the history timeline (bottom-left) and the
 * create "+" FAB (bottom-right), which turns into ✗ / ✓ while a sketch or an
 * interactive action is open.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { featureById, topLevel } from '@forma/core';
import { useStore } from '../state/store';
import { useSketch } from '../state/sketch';
import { useSel, selContext } from '../state/sel';
import { useOp } from '../state/op';
import { useTool } from '../state/tool';
import { useViewStore } from '../state/view';
import { useUI } from '../state/ui';
import { Icon, featureIcon } from '../components/icons';
import { railTools, SKETCH_PLANES, PRIMITIVES, type RailTool } from './catalogue';
import { dispatch, faceHit } from './actions';
import { faceAt } from '../state/hover';
import { edgesFor } from '../state/edges';
import { Inspector } from '../components/Inspector';
import { ContextMenu, useContextMenu, SketchContextMenu } from '../components/ContextMenu';
import { describeChange } from '../components/Timeline';
import { FilamentPalette } from '../components/Filaments';
import { Tour } from './Tour';
import { useLongPress } from '../state/menu';
import { EXTRAS } from '../features';

/* ---------- small widget kit (railButton / iconButton / fab / popup) ---------- */

function Tip({ text }: { text: string }) { return <span className="tt" role="tooltip">{text}</span>; }

export function IconButton({ icon, tip, onClick, on, disabled, solid, label, className = '' }: { icon: ReactNode; tip: string; onClick: () => void; on?: boolean; disabled?: boolean; solid?: boolean; label?: string; className?: string }) {
  return (
    <button className={`ib${on ? ' on' : ''}${solid ? ' solid' : ''} ${className}`} onClick={onClick} disabled={disabled} aria-label={tip} aria-pressed={on}>
      {icon}{label && <span>{label}</span>}<Tip text={tip} />
    </button>
  );
}

function usePopup<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

/* ---------- top-left: [logo][menu][project] ---------- */

function TopLeft() {
  const s = useStore();
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  const menu = usePopup<HTMLDivElement>();
  const fileInput = useRef<HTMLInputElement>(null);
  const view = useViewStore.getState();
  const ui = useUI();
  const item = (label: string, run: () => void, extra?: ReactNode, disabled?: boolean) => (
    <button disabled={disabled} onClick={() => { run(); menu.setOpen(false); }}>{label}{extra && <small>{extra}</small>}</button>
  );
  return (
    <div className="chips tl">
      <div className="chip logo">F</div>
      <div className="dd" ref={menu.ref}>
        <IconButton icon={<Icon.menu />} tip="Menu: file, edit, view, help and settings" onClick={() => menu.setOpen(!menu.open)} on={menu.open} />
        {menu.open && (
          <div className="popup menu-list big">
            <h6>File</h6>
            {item('Open Project...', () => fileInput.current?.click())}
            {item('Save Project', () => s.saveFile())}
            {item('Save Project As...', () => s.saveFile())}
            {item('New Project', () => s.newDocument())}
            {EXTRAS && item('Open sample scene', () => s.loadSample())}
            <h6>Export</h6>
            {item('STL...', () => s.exportModel('stl'))}
            {item('OBJ...', () => s.exportModel('obj'))}
            {item('3MF...', () => s.exportModel('3mf'))}
            {EXTRAS && item('3MF for Bambu Studio...', () => s.exportModel('bambu'), 'AMS slots')}
            <h6>Edit</h6>
            {item('Undo', () => s.undo(), undefined, !s.canUndo())}
            {item('Redo', () => s.redo(), undefined, !s.canRedo())}
            <h6>View</h6>
            {item('Reset Camera', () => view.setPreset('iso'))}
            {item('Frame Selection', () => view.fit())}
            {item('Measure...', () => ui.setMeasure(true))}
            {item(ui.tree || ui.timeline ? 'Hide Panels' : '✓ Hide Panels', () => { const hide = ui.tree || ui.timeline; ui.setTree(!hide); ui.setTimeline(!hide); })}
            <div className="menu-theme"><span>Theme</span><div className="seg"><button className={ui.light ? '' : 'on'} onClick={() => ui.setLight(false)}>Dark</button><button className={ui.light ? 'on' : ''} onClick={() => ui.setLight(true)}>Light</button></div></div>
            {EXTRAS && item(s.printLook ? '✓ Print look' : 'Print look', () => s.togglePrintLook())}
            {EXTRAS && item('Arrange parts on plate', () => { s.arrangeParts(); view.fit(); })}
            <h6>Help</h6>
            {item('Keyboard Shortcuts', () => ui.setShortcuts(true))}
            {item('Getting Started', () => ui.setTour(true))}
            {item('About Forma...', () => s.toast('Forma — browser CAD for 3D printing. Geometry by Manifold; interaction model after Materializr (GPLv3).'))}
            <hr />
            {item('Settings...', () => ui.setSettings(true))}
          </div>
        )}
      </div>
      <ProjectChip />
      <input ref={fileInput} type="file" accept=".forma,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) s.openFile(f); e.target.value = ''; }} />
    </div>
  );
}

/** Project chip: name, unsaved dot, the selection summary and a ▾ that opens the project list (Materializr's "Open projects"). */
function ProjectChip() {
  const s = useStore();
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  const pop = usePopup<HTMLDivElement>();
  const fileInput = useRef<HTMLInputElement>(null);
  const sel = useStore((x) => x.selection);
  const faces = useSel((x) => x.faces);
  const edges = useSel((x) => x.edges);
  const regions = useSel((x) => x.regions);
  const inSketch = useSketch((k) => !!k.active);
  const summary = edges.length ? `Edge (${edges.length})` : faces.length ? `Face (${faces.length})` : regions.length ? `Region (${regions.length})` : inSketch ? 'Sketch (1)' : sel.length ? `Body (${sel.length})` : '';
  const item = (label: string, run: () => void) => <button key={label} onClick={() => { run(); pop.setOpen(false); }}>{label}</button>;
  return (
    <div className="dd" ref={pop.ref}>
      <div className={`chip name${pop.open ? ' on' : ''}`}>
        <input aria-label="Project name" value={s.doc.name} onChange={(e) => s.setDoc({ ...s.doc, name: e.target.value }, { undoable: false })} />
        {s.canUndo() && <span className="dot" title="Unsaved changes">•</span>}
        {summary && <span className="sum">·  {summary}</span>}
        <button className="chev" aria-label="Open projects" onClick={() => pop.setOpen(!pop.open)}>▾</button>
      </div>
      {pop.open && (
        <div className="popup menu-list big">
          <h6>Open projects</h6>
          <div className="proj-row"><span>{s.doc.name || 'Untitled'} (current)</span></div>
          <hr />
          {item('Save', () => s.saveFile())}
          {item('Save As...', () => s.saveFile())}
          <hr />
          {item('New Project', () => s.newDocument())}
          {item('Open Project...', () => fileInput.current?.click())}
        </div>
      )}
      <input ref={fileInput} type="file" accept=".forma,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) s.openFile(f); e.target.value = ''; }} />
    </div>
  );
}

/* ---------- top-right: multi / undo / redo / items ---------- */

function TopRight() {
  const s = useStore();
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  const multi = useSel((x) => x.multi);
  const setMulti = useSel((x) => x.setMulti);
  const tree = useUI((u) => u.tree);
  const setTree = useUI((u) => u.setTree);
  const touch = useUI((u) => u.touch);
  const inSketch = useSketch((k) => !!k.active);
  const skTool = useSketch((k) => k.active?.tool);
  const snap = useUI((u) => u.snap);
  const gridStep = useUI((u) => u.gridStep);
  const snapPop = usePopup<HTMLDivElement>();
  const ui = useUI.getState();
  return (
    <div className="chips tr">
      {(touch || multi) && (!inSketch || skTool === 'select') && <IconButton icon={<span className="txt">Multi</span>} tip="Multi-select: add taps to the current selection (the touch equivalent of holding Ctrl)" on={multi} onClick={() => setMulti(!multi)} />}
      <div className="dd" ref={snapPop.ref}>
        <IconButton icon={<span className="txt">{snap ? `⌗ ${gridStep}` : '⌗ off'}</span>} tip="Snap & Grid: grid step and snapping" on={snap} onClick={() => snapPop.setOpen(!snapPop.open)} />
        {snapPop.open && (
          <div className="popup snap-pop" onPointerDown={(e) => e.stopPropagation()}>
            <h6>Snap & Grid</h6>
            <label className="chk"><input type="checkbox" checked={snap} onChange={(e) => ui.setSnap(e.target.checked)} /> Snap to grid</label>
            <div className="snap-step"><span>Step (mm)</span><div className="seg">{[0.1, 0.5, 1, 10].map((v) => <button key={v} className={gridStep === v ? 'on' : ''} onClick={() => ui.setGridStep(v)}>{v}</button>)}</div></div>
            <small className="dim">Settings persist across launches.</small>
          </div>
        )}
      </div>
      <IconButton icon={<Icon.list />} tip={tree ? 'Hide the items list' : 'Show bodies and sketches'} on={tree} onClick={() => setTree(!tree)} />
      <IconButton icon={<Icon.undo />} tip={inSketch ? 'Undo (in a sketch: backs out the in-progress shape first)' : 'Undo'} disabled={!s.canUndo() && !useSketch.getState().active?.draft.length} onClick={() => { if (inSketch && useSketch.getState().active?.draft.length) useSketch.getState().escape(); else s.undo(); }} />
      <IconButton icon={<Icon.redo />} tip="Redo" disabled={!s.canRedo()} onClick={s.redo} />
    </div>
  );
}

/* ---------- top-centre: selection chip ---------- */

/** One line describing the selection with its measurements (Materializr's Measure tool / SelectionInfo). */
function useSelectionText(): string {
  const sel = useStore((s) => s.selection);
  const faces = useSel((x) => x.faces);
  const edges = useSel((x) => x.edges);
  const regions = useSel((x) => x.regions);
  const results = useStore((s) => s.results);
  const doc = useStore((s) => s.doc);
  let text = '';
  if (edges.length === 1) {
    // Materializr's edge readout: length, plus the angle between the two faces
    const e = edges[0]!, r = results.get(e.partId);
    const me = r && !r.error ? edgesFor(r.mesh)[e.index] : undefined;
    const ang = me ? Math.round((Math.acos(Math.max(-1, Math.min(1, me.nA[0] * me.nB[0] + me.nA[1] * me.nB[1] + me.nA[2] * me.nB[2]))) * 180) / Math.PI) : 0;
    text = me ? `Edge · ${fmt(me.length)} mm · ${me.convex ? 'convex' : 'concave'} ${ang}°` : 'Selection: Edge (1)';
  } else if (edges.length) text = `Selection: Edge (${edges.length})`;
  else if (faces.length === 1) {
    // face readout: area, centre and normal in world space
    const fs = faces[0]!, r = results.get(fs.partId), f = featureById(doc, fs.partId);
    const pf = r && !r.error ? faceAt(r.mesh, fs.faceIndex) : null;
    if (pf && f) {
      const P = r!.mesh.positions, I = r!.mesh.indices;
      let area = 0;
      for (const t of pf.triangles) {
        const a = I[t * 3]! * 3, b = I[t * 3 + 1]! * 3, c = I[t * 3 + 2]! * 3;
        const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!, vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
        area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      }
      const h = faceHit(fs.partId, fs.faceIndex);
      const outer = pf.loops[0] ?? [];
      const n = h ? h.normal : pf.normal;
      text = `Face · ${fmt(area)} mm² · ${outer.length} corners · normal (${n.map((v) => fmt(v)).join(', ')})`;
    } else text = 'Selection: Face (1)';
  } else if (faces.length) text = `Selection: Face (${faces.length})`;
  else if (regions.length) text = `Selection: Region (${regions.length})`;
  else if (sel.length === 1) {
    const f = featureById(doc, sel[0]!); const r = results.get(sel[0]!);
    text = f ? `${f.name}${r && !r.error ? ` · ${fmt(r.bbox.max.x - r.bbox.min.x)} × ${fmt(r.bbox.max.y - r.bbox.min.y)} × ${fmt(r.bbox.max.z - r.bbox.min.z)} mm · ${fmt(r.volume / 1000)} cm³` : ''}` : '';
  } else if (sel.length > 1) text = `Selection: Body (${sel.length})`;
  return text;
}

/** View ▸ Measure...: the selection's measurements (Materializr's Measure results: length, area, bounding box). */
function MeasurePanel() {
  const open = useUI((u) => u.measure);
  const set = useUI((u) => u.setMeasure);
  const text = useSelectionText();
  const sel = useStore((x) => x.selection);
  const results = useStore((x) => x.results);
  const doc = useStore((x) => x.doc);
  if (!open) return null;
  const rows: [string, string][] = [];
  if (sel.length === 1) {
    const r = results.get(sel[0]!), f = featureById(doc, sel[0]!);
    if (r && !r.error && f) {
      const p = f.transform.position;
      rows.push(['Bounding box', `X ${fmt(r.bbox.max.x - r.bbox.min.x)} · Y ${fmt(r.bbox.max.y - r.bbox.min.y)} · Z ${fmt(r.bbox.max.z - r.bbox.min.z)} mm`]);
      rows.push(['Min', `${fmt(r.bbox.min.x + p.x)}, ${fmt(r.bbox.min.y + p.y)}, ${fmt(r.bbox.min.z + p.z)}`]);
      rows.push(['Max', `${fmt(r.bbox.max.x + p.x)}, ${fmt(r.bbox.max.y + p.y)}, ${fmt(r.bbox.max.z + p.z)}`]);
      rows.push(['Volume', `${fmt(r.volume / 1000)} cm³`]);
    }
  }
  return (
    <div className="popup measure-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pp-head"><span>Measure</span><button className="ib" onClick={() => set(false)} aria-label="Close"><Icon.close /></button></div>
      {text ? <div className="measure-line">{text}</div> : <div className="dim">Select a body, a face or an edge to measure it.</div>}
      {rows.map(([k, v]) => <div key={k} className="measure-row"><span>{k}</span><b>{v}</b></div>)}
    </div>
  );
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ''));

/* ---------- left edge: contextual tool dock ---------- */

function ToolDock() {
  const sel = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  const modules = useStore((s) => s.modules);
  const faces = useSel((x) => x.faces);
  const edges = useSel((x) => x.edges);
  const regions = useSel((x) => x.regions);
  const active = useSketch((k) => k.active);
  const tool = useTool((t) => t.tool);
  const op = useOp((o) => o.op);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const ctx = selContext(!!active);
  const first = sel[0] ? featureById(doc, sel[0]) : undefined;
  const tools = useMemo(() => railTools(ctx, { bodies: sel.length, modules, selectedIsCombine: first?.type === 'combine', selectedIsModule: first?.type === 'module', ortho: false, inSketch: !!active }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, sel.length, modules, first?.type, faces.length, edges.length, regions.length, !!active]);
  useEffect(() => setOpenGroup(null), [ctx]);
  const dockRef = useRef<HTMLElement>(null);
  const circleMode = useSketch((k) => k.circleMode);
  const rectMode = useSketch((k) => k.rectMode);
  useEffect(() => {
    if (!openGroup) return;
    const onDoc = (e: PointerEvent) => { if (!dockRef.current?.contains(e.target as Node)) setOpenGroup(null); };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [openGroup]);
  if (op) return null; // the action owns the screen; the corner ✓/✗ drive it
  const isActive = (t: RailTool) => (active ? `sk.${active.tool}` === t.id : (t.id === 'move' || t.id === 'rotate') && t.id === tool && sel.length > 0);
  return (
    <nav className="dock" aria-label="Tools" ref={dockRef}>
      {tools.map((t) => {
        // a group shows whichever member is active (ImTouchLayout: Transform reads "Move" while the move gizmo is up)
        const live = t.children?.find(isActive);
        const shown = live ?? t;
        const on = live ? true : isActive(t);
        const isPolygon = t.id === 'sk.polygon';
        return (
          <div key={t.id + (t.arg ?? '')} className="dock-item">
            <button className={`rail${on ? ' on' : ''}${openGroup === t.id ? ' open' : ''}`} onClick={() => { if (t.children || isPolygon) { if (isPolygon) dispatch(t.id); setOpenGroup(openGroup === t.id ? null : t.id); } else dispatch(t.id, t.arg); }} aria-label={t.label}>
              {iconOf(shown.icon)}<span>{shown.label}</span>
              {(t.children || isPolygon) && <i className="caret" />}
              <Tip text={t.tip} />
            </button>
            {isPolygon && openGroup === t.id && <PolygonSides onDone={() => setOpenGroup(null)} />}
            {active && t.id === 'sk.circle' && active.tool === 'circle' && <ModeToggle a="Center" b="2-Point" value={circleMode === 'center' ? 0 : 1} onChange={(i) => useSketch.getState().setCircleMode(i === 0 ? 'center' : '2pt')} />}
            {active && t.id === 'sk.rect' && active.tool === 'rect' && <ModeToggle a="Corner" b="Center" value={rectMode === 'corner' ? 0 : 1} onChange={(i) => useSketch.getState().setRectMode(i === 0 ? 'corner' : 'center')} />}
            {t.children && openGroup === t.id && (
              <div className="popup dock-pop" onPointerDown={(e) => e.stopPropagation()}>
                {t.children.length === 0 && <div className="dim">Nothing here yet</div>}
                {t.children.map((c) => (
                  <button key={c.id + (c.arg ?? '')} className={`pop-row${isActive(c) ? ' on' : ''}`} onClick={() => { dispatch(c.id, c.arg); setOpenGroup(null); }}>
                    {iconOf(c.icon)}<span>{c.label}</span><small>{c.tip}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** The two-way toggle that follows Circle (Center / 2-Point) and Rectangle (Corner / Center) while the tool is active. */
function ModeToggle({ a, b, value, onChange }: { a: string; b: string; value: 0 | 1; onChange: (i: 0 | 1) => void }) {
  return (
    <div className="dock-item sides mode">
      <button className={`rail${value === 0 ? ' on' : ''}`} onClick={() => onChange(0)}>{a}</button>
      <button className={`rail${value === 1 ? ' on' : ''}`} onClick={() => onChange(1)}>{b}</button>
    </div>
  );
}

/** Polygon side picker: named counts, then Custom... (Materializr's PolygonSidesMenu). */
function PolygonSides({ onDone }: { onDone: () => void }) {
  const n = useSketch((k) => k.polygonSides);
  const set = useSketch((k) => k.setPolygonSides);
  const [custom, setCustom] = useState(String(n));
  const named: [string, number][] = [['Triangle', 3], ['Square', 4], ['Pentagon', 5], ['Hexagon', 6], ['Heptagon', 7], ['Octagon', 8]];
  return (
    <div className="popup dock-pop sides-pop" onPointerDown={(e) => e.stopPropagation()}>
      {named.map(([name, k]) => <button key={k} className={`pop-row${n === k ? ' on' : ''}`} onClick={() => { set(k); onDone(); }}><Icon.polygon /><span>{name} ({k})</span></button>)}
      <hr />
      <div className="pop-row custom"><span>Custom...</span><input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Sides (3–128)" /><button onClick={() => { const v = Math.max(3, Math.min(128, parseInt(custom) || 9)); set(v); onDone(); }}>Draw</button></div>
    </div>
  );
}

function iconOf(name: keyof typeof Icon) { const C = Icon[name] ?? Icon.box; return <C />; }

/* ---------- right edge: transparent items tree ---------- */

function ItemsTree() {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const toggleVisible = useStore((s) => s.toggleVisible);
  const pickBody = useSel((x) => x.pickBody);
  const open = useUI((u) => u.tree);
  const [bodiesOpen, setBodiesOpen] = useState(true);
  const [sketchesOpen, setSketchesOpen] = useState(true);
  if (!open) return null;
  const roots = topLevel(doc);
  // a sketch with no closed outline is not a body yet (Materializr lists sketches apart from bodies)
  const bodies = roots.filter((f) => !(f.type === 'extrude' && f.sketch && f.parentId === null && f.role === 'solid' && (!results.get(f.id) || results.get(f.id)?.error)));
  const sketches = roots.filter((f) => f.type === 'extrude' && !!f.sketch);
  const row = (f: (typeof roots)[number]) => (
    <div key={f.id} className={`trow${selection.includes(f.id) ? ' sel' : ''}${f.visible ? '' : ' off'}`}
      onClick={(e) => { useSel.getState().setNavOnly(true); pickBody(f.id, e.ctrlKey || e.metaKey || useSel.getState().multi); }}
      onContextMenu={(e) => { e.preventDefault(); useSel.getState().setNavOnly(true); pickBody(f.id, false); useContextMenu.getState().show(e.clientX, e.clientY, [f.id]); }}
      onDoubleClick={() => { const el = document.getElementById('f-name') as HTMLInputElement | null; useUI.getState().openSheet('props'); requestAnimationFrame(() => el?.focus()); }}>
      <button className="eye" aria-label={f.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); toggleVisible(f.id); }}><Icon.eye /></button>
      {featureIcon(f.type)}
      <span className="nm">{f.name}</span>
      {EXTRAS && f.role === 'hole' && <span className="tag hole">hole</span>}
      {results.get(f.id)?.error && <span className="tag err">!</span>}
      {EXTRAS && <i className="fdot" style={{ background: doc.filaments[f.filament - 1]?.color }} />}
      <button className="more" aria-label="More" onClick={(e) => { e.stopPropagation(); useSel.getState().setNavOnly(true); pickBody(f.id, false); useContextMenu.getState().show(e.clientX, e.clientY, [f.id]); }}><Icon.more /></button>
    </div>
  );
  return (
    <aside className="tree-pane">
      <button className="tgroup" onClick={() => setBodiesOpen(!bodiesOpen)}><i className={`caret${bodiesOpen ? ' open' : ''}`} />Bodies <small>{bodies.length}</small></button>
      {bodiesOpen && (bodies.length ? [...bodies].reverse().map(row) : <div className="dim">Nothing here yet</div>)}
      <button className="tgroup" onClick={() => setSketchesOpen(!sketchesOpen)}><i className={`caret${sketchesOpen ? ' open' : ''}`} />Sketches <small>{sketches.length}</small></button>
      {sketchesOpen && (sketches.length ? [...sketches].reverse().map(row) : <div className="dim">No sketches yet</div>)}
      {EXTRAS && <div className="tree-filaments"><FilamentPalette /></div>}
    </aside>
  );
}

/* ---------- bottom-left: history toggle + timeline strip + step popup ---------- */

function HistoryStrip() {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const rollback = useStore((s) => s.rollback);
  const setRollback = useStore((s) => s.setRollback);
  const tick = useStore((s) => s.historyTick);
  const timeline = useStore((s) => s.timeline);
  const open = useUI((u) => u.timeline);
  const setOpen = useUI((u) => u.setTimeline);
  const inSketch = useSketch((k) => !!k.active);
  const [edit, setEdit] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const n = doc.features.length;
  const cursor = rollback ?? n;
  const lastLabel = useMemo(() => { const { past, current } = timeline(); const prev = past[past.length - 1]; return prev ? describeChange(prev, current) : 'Start'; }, [tick, timeline]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stripRef.current?.querySelector('.step.cur')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [cursor, n]);
  useEffect(() => { if (edit && !featureById(doc, edit)) setEdit(null); }, [doc, edit]);
  if (inSketch) return null; // rolling the host body back under a live sketch is forbidden
  const editIdx = edit ? doc.features.findIndex((f) => f.id === edit) : -1;
  return (
    <div className="hist">
      <IconButton className="hist-toggle" solid icon={open ? <Icon.prev /> : <Icon.history />} tip={open ? 'Hide the history timeline' : 'Show the history timeline'} on={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="strip" ref={stripRef}>
          {n === 0 && <span className="dim">History: no steps yet</span>}
          {doc.features.map((f, i) => {
            const r = results.get(f.id);
            const cls = ['step'];
            if (i === cursor - 1) cls.push('cur');
            if (i >= cursor) cls.push('undone');
            if (!f.visible) cls.push('disabled');
            if (r?.error) cls.push('failed');
            if (f.parentId) cls.push('child');
            if (selection.includes(f.id)) cls.push('sel');
            if (edit === f.id) cls.push('editing');
            return (
              <button key={f.id} className={cls.join(' ')} title={`${i + 1}. ${f.name}`} onClick={() => setEdit(edit === f.id ? null : f.id)}>
                {featureIcon(f.type)}<span>{f.name}</span>
              </button>
            );
          })}
          <span className="dim count">{rollback !== null ? `${rollback} / ${n}` : `${n} step${n === 1 ? '' : 's'}`}</span>
          <span className="dim last">{lastLabel}</span>
        </div>
      )}
      {open && edit && editIdx >= 0 && <StepPopup id={edit} index={editIdx} cursor={cursor} onClose={() => setEdit(null)} setRollback={setRollback} />}
    </div>
  );
}

function StepPopup({ id, index, cursor, onClose, setRollback }: { id: string; index: number; cursor: number; onClose: () => void; setRollback: (i: number | null) => void }) {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const s = useStore.getState();
  const f = featureById(doc, id);
  const pop = usePopup<HTMLDivElement>();
  useEffect(() => { pop.setOpen(true); s.select([id]); /* the step's own editor */ }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!pop.open) onClose(); }, [pop.open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f || !pop.open) return null;
  const err = results.get(id)?.error;
  const n = doc.features.length;
  return (
    <div className="popup step-pop" ref={pop.ref}>
      <div className="sp-head">{index + 1}. {f.name}{!f.visible && <small> · Disabled</small>}{index >= cursor && <small> · Undone — Go Here replays it.</small>}</div>
      {err && <div className="sp-err">Couldn't build this step: {err}. Edit its parameters, fix the step before it, or delete it.</div>}
      <div className="sp-body"><Inspector /></div>
      {!err && <button className="primary sp-apply" onClick={onClose}>Apply Changes</button>}
      <div className="sp-foot">
        <button disabled={index + 1 === cursor} onClick={() => setRollback(index + 1 >= n ? null : index + 1)}>Go Here</button>
        <button onClick={() => s.toggleVisible(id)}>{f.visible ? 'Disable' : 'Enable'}</button>
        <button className="danger" onClick={() => {
          const c = f.type === 'combine' ? f : null;
          if (c && c.childIds.length) { s.toast("Can't delete: a later operation depends on it. Separate the body first."); return; }
          s.select([id]); s.deleteSelected(); onClose();
        }}>Delete</button>
      </div>
    </div>
  );
}

/* ---------- bottom-right: + FAB / ✗ ✓ ---------- */

function CornerFab() {
  const active = useSketch((k) => k.active);
  const op = useOp((o) => o.op);
  const sel = useStore((s) => s.selection);
  const faces = useSel((x) => x.faces);
  const modules = useStore((s) => s.modules);
  const pop = usePopup<HTMLDivElement>();
  const [sub, setSub] = useState<'sketch' | 'prim' | 'parts' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  if (active) {
    const placing = active.draft.length > 0;
    const sk = useSketch.getState();
    return (
      <div className="corner">
        {placing && active.tool === 'line' && active.draft.length > 1 && <IconButton icon={<Icon.undo />} tip="Remove the last segment and keep drawing" onClick={() => sk.backspace()} />}
        <IconButton className="discard" icon={<Icon.close />} tip={placing ? 'Cancel the in-progress shape' : 'Throw the sketch away and leave (asks to confirm)'} onClick={() => (placing ? sk.escape() : setConfirmDiscard(true))} />
        <button className="fab" aria-label={placing ? 'Finish the current shape' : 'Finish the sketch and leave sketch mode'} onClick={() => (placing ? sk.enter() : sk.finish())}><Icon.check /><Tip text={placing ? 'Finish the current shape, keeping the points placed' : 'Finish the sketch and leave sketch mode'} /></button>
        {confirmDiscard && (
          <div className="modal-back" onClick={() => setConfirmDiscard(false)}>
            <div className="modal small" onClick={(e) => e.stopPropagation()}>
              <p>Leave the sketch and throw away its changes?</p>
              <div className="foot"><button className="danger" onClick={() => { setConfirmDiscard(false); sk.cancel(); }}>Discard Sketch</button><button onClick={() => setConfirmDiscard(false)}>Keep Editing</button></div>
            </div>
          </div>
        )}
      </div>
    );
  }
  if (op) {
    const o = useOp.getState();
    return (
      <div className="corner">
        <IconButton className="discard" icon={<Icon.close />} tip="Cancel the action and discard its preview" onClick={o.cancel} />
        <button className="fab" aria-label="Apply the action" onClick={o.confirm}><Icon.check /><Tip text="Apply the action" /></button>
      </div>
    );
  }
  const face = faces[0];
  return (
    <div className="corner" ref={pop.ref}>
      {pop.open && (
        <div className="popup fab-menu">
          {face && <button onClick={() => { dispatch('sketch.face'); pop.setOpen(false); }}><Icon.sketch /><span>Sketch on selection</span></button>}
          {!face && <button className={sub === 'sketch' ? 'on' : ''} onClick={() => setSub(sub === 'sketch' ? null : 'sketch')}><Icon.sketch /><span>New Sketch</span><i className="caret" /></button>}
          {sub === 'sketch' && SKETCH_PLANES.map((p) => <button key={p.id} className="subrow" onClick={() => { dispatch(p.id); pop.setOpen(false); }}>{p.label}</button>)}
          <button className={sub === 'prim' ? 'on' : ''} onClick={() => setSub(sub === 'prim' ? null : 'prim')}><Icon.box /><span>Primitive</span><i className="caret" /></button>
          {sub === 'prim' && PRIMITIVES.map((p) => <button key={p.id} className="subrow" onClick={() => { dispatch(p.id); pop.setOpen(false); }}>{p.label}</button>)}
          {EXTRAS && <button className={sub === 'parts' ? 'on' : ''} onClick={() => setSub(sub === 'parts' ? null : 'parts')}><Icon.module /><span>Ready-made part</span><i className="caret" /></button>}
          {EXTRAS && sub === 'parts' && modules.map((m) => <button key={m.id} className="subrow" title={m.description} onClick={() => { dispatch('module', m.id); pop.setOpen(false); }}>{m.name}</button>)}
        </div>
      )}
      <button className={`fab${pop.open ? ' on' : ''}`} aria-label="Create: a sketch or a primitive solid" onClick={() => { setSub(null); pop.setOpen(!pop.open); }}><Icon.plus /><Tip text="Create: a sketch or a primitive solid" /></button>
    </div>
  );
}

/* ---------- viewport banner + value well for the active op ---------- */

function OpOverlay() {
  const op = useOp((o) => o.op);
  const dragging = useOp((o) => o.dragging);
  const active = useSketch((k) => k.active);
  const tool = useTool((t) => t.tool);
  const sel = useStore((s) => s.selection);
  const inputRef = useRef<HTMLInputElement>(null);
  const [buf, setBuf] = useState('');
  const valueOf = (o: NonNullable<typeof op>) => (o.kind === 'pushpull' ? o.distance : o.value);
  useEffect(() => { if (op && !dragging) setBuf(fmtVal(valueOf(op))); }, [op && valueOf(op), dragging]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (op && !useUI.getState().touch) requestAnimationFrame(() => inputRef.current?.focus()); }, [op?.kind, op && 'partId' in op ? op.partId : null]); // eslint-disable-line react-hooks/exhaustive-deps
  let banner: ReactNode = null;
  if (active) banner = <>SKETCH MODE - Finish Sketch applies, Exit Sketch discards<SketchDof /></>;
  else if (!op && (tool === 'move' || tool === 'rotate') && sel.length) banner = <>Arrows: Move | Rings: Rotate</>;
  return (
    <>
      {banner && <div className={`banner${op ? ' op' : ''}`}>{banner}</div>}
      {op && (
        <form className="well" onSubmit={(e) => { e.preventDefault(); const v = parseFloat(buf); if (Number.isFinite(v)) useOp.getState().setValue(v, true); useOp.getState().confirm(); }} onPointerDown={(e) => e.stopPropagation()}>
          <label>{op.kind === 'pushpull' ? (op.symmetric ? 'Distance per side (mm)' : 'Distance (mm) — signed') : op.tool === 'round' ? 'Radius (mm)' : 'Size (mm)'}</label>
          <div className="well-row">
            <button type="button" onClick={() => useOp.getState().setValue(valueOf(op) - 1, true)} aria-label="Minus 1">−</button>
            <input ref={inputRef} value={buf} inputMode="decimal" onChange={(e) => { setBuf(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) useOp.getState().setValue(v, true); }} onKeyDown={(e) => { if (e.key === 'Escape') { useOp.getState().cancel(); } e.stopPropagation(); }} />
            <button type="button" onClick={() => useOp.getState().setValue(valueOf(op) + 1, true)} aria-label="Plus 1">+</button>
          </div>
          {op.kind === 'pushpull' && <label className="chk"><input type="checkbox" checked={op.symmetric} onChange={(e) => useOp.getState().setSymmetric(e.target.checked)} /> Symmetric (both sides)</label>}
          {op.kind === 'edgeop' && (
            <div className="seg"><button type="button" className={op.tool === 'round' ? 'on' : ''} onClick={() => useOp.getState().setTool('round')}>Fillet</button><button type="button" className={op.tool === 'chamfer' ? 'on' : ''} onClick={() => useOp.getState().setTool('chamfer')}>Chamfer</button></div>
          )}
          <div className="well-foot"><button type="submit" className="primary">Confirm (Enter)</button><button type="button" onClick={() => useOp.getState().cancel()}>Cancel (Esc)</button></div>
        </form>
      )}
    </>
  );
}
const fmtVal = (v: number) => (Math.round(v * 100) / 100).toString();

/* ---------- properties sheet (the step editor / selection properties) ---------- */

function PropsSheet() {
  const sheet = useUI((u) => u.sheet);
  const close = useUI((u) => u.openSheet);
  const sel = useStore((s) => s.selection);
  useEffect(() => { if (sheet === 'props' && sel.length === 0) close(null); }, [sel.length, sheet, close]);
  if (sheet !== 'props') return null;
  return (
    <aside className="props-pane">
      <div className="pp-head"><span>Properties</span><button className="ib" onClick={() => close(null)} aria-label="Close"><Icon.close /></button></div>
      <div className="pp-body"><Inspector /></div>
    </aside>
  );
}

/** Degrees of freedom of the active sketch, next to the banner (SolidCraft shows the solver state the same way). */
function SketchDof() {
  const active = useSketch((k) => k.active);
  const doc = useStore((s) => s.doc);
  const r = useMemo(() => (active ? useSketch.getState().solved() : null), [active?.featureId, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r || r.rows === 0) return null;
  return <span className="sk-dof"> · {r.status === 'failed' ? 'constraints conflict' : r.dof === 0 ? 'fully constrained' : `${r.dof} degree${r.dof === 1 ? '' : 's'} of freedom`}</span>;
}

/** Settings...: the Materializr settings Forma can honour. Applied live; Close returns to the model. */
function SettingsDialog() {
  const open = useUI((u) => u.settings);
  const ui = useUI();
  const s = useStore();
  if (!open) return null;
  const Row = ({ label, children }: { label: string; children: ReactNode }) => <div className="set-row"><span>{label}</span>{children}</div>;
  return (
    <div className="modal-back" onClick={() => ui.setSettings(false)}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <h6>Appearance</h6>
        <Row label="Display unit"><span className="dim">Millimetres</span></Row>
        <Row label="Interface"><span className="dim">im-touch</span></Row>
        <Row label="Touch mode (large UI + touch gestures)"><input type="checkbox" checked={ui.touch} onChange={(e) => ui.setTouch(e.target.checked)} /></Row>
        <Row label="Theme"><div className="seg"><button className={ui.light ? '' : 'on'} onClick={() => ui.setLight(false)}>Dark</button><button className={ui.light ? 'on' : ''} onClick={() => ui.setLight(true)}>Light</button></div></Row>
        <Row label="Show toolbar tooltips"><input type="checkbox" checked={ui.tooltips} onChange={(e) => ui.setTooltips(e.target.checked)} /></Row>
        <h6>Sketch</h6>
        <Row label="Angle snap"><div className="seg">{[0, 5, 15, 30, 45, 90].map((a) => <button key={a} className={ui.angleSnap === a ? 'on' : ''} onClick={() => ui.setAngleSnap(a)}>{a === 0 ? 'Off' : `${a}°`}</button>)}</div></Row>
        <Row label="Snap to grid"><input type="checkbox" checked={ui.snap} onChange={(e) => ui.setSnap(e.target.checked)} /></Row>
        <Row label="Grid step (mm)"><div className="seg">{[0.1, 0.5, 1, 10].map((v) => <button key={v} className={ui.gridStep === v ? 'on' : ''} onClick={() => ui.setGridStep(v)}>{v}</button>)}</div></Row>
        <h6>Rendering</h6>
        <Row label="Grid rendering"><input type="checkbox" checked={s.showGrid} onChange={() => s.toggleGrid()} /></Row>
        <Row label="Show mesh wireframe"><input type="checkbox" checked={s.wireframe} onChange={() => s.toggleWireframe()} /></Row>
        <div className="foot"><span className="spacer" /><button className="primary" onClick={() => ui.setSettings(false)}>Close</button></div>
      </div>
    </div>
  );
}

function ShortcutsPanel() {
  const open = useUI((u) => u.shortcuts);
  const set = useUI((u) => u.setShortcuts);
  if (!open) return null;
  const rows: [string, string][] = [
    ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+S', 'Save project'], ['Ctrl+D', 'Duplicate the selection in place'], ['Ctrl+A', 'Select all visible bodies'], ['Delete', 'Delete selected'],
    ['Escape', 'Cancel / revert in-progress action / exit sketch'], ['Enter', 'Confirm Push/Pull / Fillet / Chamfer'], ['Home', 'Reset camera'], ['F', 'Frame the selection (or everything)'],
    ['W / E', 'Gizmo: Translate / Rotate'], ['P', 'Push/Pull the selected face'], ['Q', 'Fillet the selected edges'], ['K', 'Sketch on the selected face, or on the plate'],
    ['In a sketch: L R C A', 'Line / Rectangle / Circle / Arc'], ['Type a number', 'Exact length / radius while placing'], ['Two-finger tap / three-finger tap', 'Undo / Redo on a tablet'],
  ];
  return (
    <div className="modal-back" onClick={() => set(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard Shortcuts</h2>
        <table className="keys-table"><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
        <div className="foot"><button onClick={() => set(false)}>Close</button></div>
      </div>
    </div>
  );
}

/* ---------- the shell ---------- */

/** The ring that fills under a finger while a long-press charges (touch only). */
function LongPressRing() {
  const pressing = useLongPress((s) => s.pressing);
  if (!pressing) return null;
  return (
    <svg className="lp-ring" style={{ left: pressing.x, top: pressing.y, animationDuration: `${pressing.ms}ms` }} viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="20" />
      <circle cx="24" cy="24" r="20" className="arc" style={{ animationDuration: `${pressing.ms}ms` }} />
    </svg>
  );
}

export function Shell() {
  const light = useUI((u) => u.light);
  const touch = useUI((u) => u.touch);
  const tooltips = useUI((u) => u.tooltips);
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; document.documentElement.dataset.touch = touch ? '1' : '0'; document.documentElement.dataset.tips = tooltips ? '1' : '0'; }, [light, touch, tooltips]);
  return (
    <>
      <TopLeft />
      <TopRight />
      <MeasurePanel />
      <SettingsDialog />
      <OpOverlay />
      <ToolDock />
      <ItemsTree />
      <PropsSheet />
      <HistoryStrip />
      <CornerFab />
      <ContextMenu />
      <SketchContextMenu />
      <ShortcutsPanel />
      <Tour />
      <LongPressRing />
    </>
  );
}
