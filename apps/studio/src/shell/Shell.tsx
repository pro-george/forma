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
import { ContextMenu, useContextMenu } from '../components/ContextMenu';
import { describeChange } from '../components/Timeline';
import { FilamentPalette } from '../components/Filaments';
import { Tour } from './Tour';
import { useLongPress } from '../state/menu';

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

/** The ☰ menu's rows (shared by the floating shell and the phone sheet). */
export function MenuItems({ close }: { close: () => void }) {
  const s = useStore();
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const view = useViewStore.getState();
  const ui = useUI();
  const item = (label: string, run: () => void, extra?: ReactNode, disabled?: boolean) => (
    <button key={label} disabled={disabled} onClick={() => { run(); close(); }}>{label}{extra && <small>{extra}</small>}</button>
  );
  return (
    <>
            <h6>File</h6>
            {item('New Project', () => s.newDocument())}
            {item('Open Project…', () => fileInput.current?.click())}
            {item('Open sample scene', () => s.loadSample())}
            {item('Save Project', () => s.saveFile(), '⌘S')}
            <h6>Export</h6>
            {item('3MF for Bambu Studio', () => s.exportModel('bambu'), 'AMS slots')}
            {item('3MF with colours', () => s.exportModel('3mf'), 'Prusa, Cura')}
            {item('STL', () => s.exportModel('stl'))}
            {item('OBJ', () => s.exportModel('obj'))}
            <h6>Edit</h6>
            {item('Undo', () => s.undo(), '⌘Z', !s.canUndo())}
            {item('Redo', () => s.redo(), '⌘Y', !s.canRedo())}
            {item('Select all', () => s.select(topLevel(s.doc).filter((f) => f.visible).map((f) => f.id)), '⌘A')}
            <h6>View</h6>
            {item('Reset Camera', () => view.setPreset('iso'), 'Home')}
            {item('Frame Selection', () => view.fit(), 'F')}
            {item('Top / Front / Right', () => view.setPreset(['top', 'front', 'right'][Date.now() % 3] as 'top'))}
            {item(s.showGrid ? '✓ Grid' : 'Grid', () => s.toggleGrid())}
            {item(s.wireframe ? '✓ Wireframe' : 'Wireframe', () => s.toggleWireframe())}
            {item(s.printLook ? '✓ Print look' : 'Print look', () => s.togglePrintLook())}
            {item('Arrange parts on plate', () => { s.arrangeParts(); view.fit(); })}
            <h6>Settings</h6>
            {item(ui.light ? '✓ Light theme' : 'Light theme', () => ui.setLight(!ui.light))}
            {item(ui.touch ? '✓ Touch mode' : 'Touch mode', () => ui.setTouch(!ui.touch), 'bigger targets, long-press')}
            {item(`Grid step: ${ui.gridStep} mm`, () => ui.setGridStep(ui.gridStep === 0.1 ? 0.5 : ui.gridStep === 0.5 ? 1 : ui.gridStep === 1 ? 10 : 0.1), 'tap to cycle')}
            <h6>Help</h6>
            {item('Getting Started', () => ui.setTour(true))}
            {item('Keyboard Shortcuts', () => ui.setShortcuts(true))}
            {item('About Forma', () => s.toast('Forma — browser CAD for 3D printing. Geometry by Manifold; interaction model after Materializr (GPLv3).'))}
      <input ref={fileInput} type="file" accept=".forma,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) s.openFile(f); e.target.value = ''; }} />
    </>
  );
}

function TopLeft() {
  const s = useStore();
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  const menu = usePopup<HTMLDivElement>();
  return (
    <div className="chips tl">
      <div className="chip logo">F</div>
      <div className="dd" ref={menu.ref}>
        <IconButton icon={<Icon.menu />} tip="Menu: file, edit, view, help and settings" onClick={() => menu.setOpen(!menu.open)} on={menu.open} />
        {menu.open && <div className="popup menu-list big"><MenuItems close={() => menu.setOpen(false)} /></div>}
      </div>
      <input className="chip name" aria-label="Project name" value={s.doc.name} onChange={(e) => s.setDoc({ ...s.doc, name: e.target.value }, { undoable: false })} />
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
  return (
    <div className="chips tr">
      {(touch || multi) && <IconButton icon={<span className="txt">Multi</span>} tip="Multi-select: add taps to the current selection (the touch equivalent of holding Ctrl)" on={multi} onClick={() => setMulti(!multi)} />}
      <IconButton icon={<Icon.undo />} tip={inSketch ? 'Undo (in a sketch: backs out the in-progress shape first)' : 'Undo'} disabled={!s.canUndo()} onClick={() => { if (inSketch && useSketch.getState().active?.draft.length) useSketch.getState().escape(); else s.undo(); }} />
      <IconButton icon={<Icon.redo />} tip="Redo" disabled={!s.canRedo()} onClick={s.redo} />
      <IconButton icon={<Icon.list />} tip={tree ? 'Hide the items list' : 'Show bodies and sketches'} on={tree} onClick={() => setTree(!tree)} />
    </div>
  );
}

/* ---------- top-centre: selection chip ---------- */

/** One line describing the selection with its measurements (Materializr's SelectionInfo). */
export function useSelectionText(): string {
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

function SelectionChip() {
  const op = useOp((o) => o.op);
  const inSketch = useSketch((k) => !!k.active);
  const text = useSelectionText();
  if (op || inSketch || !text) return null;
  return <div className="chip sel-chip">{text}</div>;
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
  if (op) return null; // the action owns the screen; the corner ✓/✗ drive it
  const isActive = (t: RailTool) => (active ? `sk.${active.tool}` === t.id : t.id === tool);
  return (
    <nav className="dock" aria-label="Tools">
      {tools.map((t) => (
        <div key={t.id + (t.arg ?? '')} className="dock-item">
          <button className={`rail${isActive(t) ? ' on' : ''}${openGroup === t.id ? ' open' : ''}`} onClick={() => { if (t.children) setOpenGroup(openGroup === t.id ? null : t.id); else { dispatch(t.id, t.arg); } }} aria-label={t.label}>
            {iconOf(t.icon)}<span>{t.label}</span>
            {t.children && <i className="caret" />}
            <Tip text={t.tip} />
          </button>
          {t.children && openGroup === t.id && (
            <div className="popup dock-pop" onPointerDown={(e) => e.stopPropagation()}>
              {t.children.length === 0 && <div className="dim">Nothing here yet</div>}
              {t.children.map((c) => (
                <button key={c.id + (c.arg ?? '')} className="pop-row" onClick={() => { dispatch(c.id, c.arg); setOpenGroup(null); }}>
                  {iconOf(c.icon)}<span>{c.label}</span><small>{c.tip}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {active && active.tool === 'polygon' && <PolygonSides />}
    </nav>
  );
}

function PolygonSides() {
  const n = useSketch((k) => k.polygonSides);
  const set = useSketch((k) => k.setPolygonSides);
  return (
    <div className="dock-item sides">
      <button className="rail" onClick={() => set(n - 1)} aria-label="Fewer sides">−</button>
      <div className="rail static">{n}<span>sides</span></div>
      <button className="rail" onClick={() => set(n + 1)} aria-label="More sides">+</button>
    </div>
  );
}

export function iconOf(name: keyof typeof Icon) { const C = Icon[name] ?? Icon.box; return <C />; }

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
  const bodies = roots.filter((f) => !(f.type === 'extrude' && f.sketch && f.parentId === null && f.role === 'solid' && !results.get(f.id)));
  const sketches = roots.filter((f) => f.type === 'extrude' && !!f.sketch);
  const row = (f: (typeof roots)[number]) => (
    <div key={f.id} className={`trow${selection.includes(f.id) ? ' sel' : ''}${f.visible ? '' : ' off'}`}
      onClick={(e) => { useSel.getState().setNavOnly(true); pickBody(f.id, e.ctrlKey || e.metaKey || useSel.getState().multi); }}
      onContextMenu={(e) => { e.preventDefault(); useSel.getState().setNavOnly(true); pickBody(f.id, false); useContextMenu.getState().show(e.clientX, e.clientY, [f.id]); }}
      onDoubleClick={() => { const el = document.getElementById('f-name') as HTMLInputElement | null; useUI.getState().openSheet('props'); requestAnimationFrame(() => el?.focus()); }}>
      <button className="eye" aria-label={f.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); toggleVisible(f.id); }}><Icon.eye /></button>
      {featureIcon(f.type)}
      <span className="nm">{f.name}</span>
      {f.role === 'hole' && <span className="tag hole">hole</span>}
      {results.get(f.id)?.error && <span className="tag err">!</span>}
      <i className="fdot" style={{ background: doc.filaments[f.filament - 1]?.color }} />
      <button className="more" aria-label="More" onClick={(e) => { e.stopPropagation(); useSel.getState().setNavOnly(true); pickBody(f.id, false); useContextMenu.getState().show(e.clientX, e.clientY, [f.id]); }}><Icon.more /></button>
    </div>
  );
  return (
    <aside className="tree-pane">
      <button className="tgroup" onClick={() => setBodiesOpen(!bodiesOpen)}><i className={`caret${bodiesOpen ? ' open' : ''}`} />Bodies <small>{bodies.length}</small></button>
      {bodiesOpen && (bodies.length ? [...bodies].reverse().map(row) : <div className="dim">Nothing here yet</div>)}
      <button className="tgroup" onClick={() => setSketchesOpen(!sketchesOpen)}><i className={`caret${sketchesOpen ? ' open' : ''}`} />Sketches <small>{sketches.length}</small></button>
      {sketchesOpen && (sketches.length ? [...sketches].reverse().map(row) : <div className="dim">No sketches yet</div>)}
      <div className="tree-filaments"><FilamentPalette /></div>
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
  const s = useStore.getState();
  const pop = usePopup<HTMLDivElement>();
  useEffect(() => { pop.setOpen(true); s.select([id]); /* the step's own editor */ }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!pop.open) onClose(); }, [pop.open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pop.open) return null;
  return <div className="popup step-pop" ref={pop.ref}><StepEditor id={id} index={index} cursor={cursor} onClose={onClose} setRollback={setRollback} /></div>;
}

/** A history step's editor: parameters, Go Here, Disable, Delete (shared by the popup and the phone history sheet). */
export function StepEditor({ id, index, cursor, onClose, setRollback }: { id: string; index: number; cursor: number; onClose: () => void; setRollback: (i: number | null) => void }) {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const s = useStore.getState();
  const f = featureById(doc, id);
  if (!f) return null;
  const err = results.get(id)?.error;
  const n = doc.features.length;
  return (
    <>
      <div className="sp-head">{index + 1}. {f.name}{!f.visible && <small> · Disabled</small>}{index >= cursor && <small> · Undone — Go Here replays it.</small>}</div>
      {err && <div className="sp-err">Couldn't build this step: {err}. Edit its parameters, fix the step before it, or delete it.</div>}
      <div className="sp-body"><Inspector /></div>
      <div className="sp-foot">
        <button disabled={index + 1 === cursor} onClick={() => setRollback(index + 1 >= n ? null : index + 1)}>Go Here</button>
        <button onClick={() => s.toggleVisible(id)}>{f.visible ? 'Disable' : 'Enable'}</button>
        <button className="danger" onClick={() => {
          const c = f.type === 'combine' ? f : null;
          if (c && c.childIds.length) { s.toast("Can't delete: a later operation depends on it. Separate the body first."); return; }
          s.select([id]); s.deleteSelected(); onClose();
        }}>Delete</button>
      </div>
    </>
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
          {sel.length === 1 && !face && <button onClick={() => { dispatch('sketch.edit'); pop.setOpen(false); }}><Icon.sketch /><span>Edit selection</span></button>}
          <button className={sub === 'sketch' ? 'on' : ''} onClick={() => setSub(sub === 'sketch' ? null : 'sketch')}><Icon.sketch /><span>New Sketch</span><i className="caret" /></button>
          {sub === 'sketch' && SKETCH_PLANES.map((p) => <button key={p.id} className="subrow" onClick={() => { dispatch(p.id); pop.setOpen(false); }}>{p.label}</button>)}
          <button className={sub === 'prim' ? 'on' : ''} onClick={() => setSub(sub === 'prim' ? null : 'prim')}><Icon.box /><span>Primitive</span><i className="caret" /></button>
          {sub === 'prim' && PRIMITIVES.map((p) => <button key={p.id} className="subrow" onClick={() => { dispatch(p.id); pop.setOpen(false); }}>{p.label}</button>)}
          <button className={sub === 'parts' ? 'on' : ''} onClick={() => setSub(sub === 'parts' ? null : 'parts')}><Icon.module /><span>Ready-made part</span><i className="caret" /></button>
          {sub === 'parts' && modules.map((m) => <button key={m.id} className="subrow" title={m.description} onClick={() => { dispatch('module', m.id); pop.setOpen(false); }}>{m.name}</button>)}
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
  if (active) banner = <>SKETCH MODE — Draw shapes. <b>✓</b> finishes the sketch, <b>✗</b> discards.</>;
  else if (op?.kind === 'pushpull') banner = <>PUSH/PULL — Positive = extrude, Negative = cut. Drag the arrow, then <b>✓</b> / <b>✗</b> (Enter / Esc).</>;
  else if (op?.kind === 'edgeop') banner = <>{op.tool === 'round' ? 'FILLET' : 'CHAMFER'} — Drag the handle away from the edge or type a size, then <b>✓</b> / <b>✗</b>.</>;
  else if ((tool === 'move' || tool === 'rotate') && sel.length) banner = <>Arrows: Move | Rings: Rotate — drag a handle; <b>Esc</b> for Select</>;
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

export function ShortcutsPanel() {
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
export function LongPressRing() {
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
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; document.documentElement.dataset.touch = touch ? '1' : '0'; }, [light, touch]);
  return (
    <>
      <TopLeft />
      <TopRight />
      <SelectionChip />
      <OpOverlay />
      <ToolDock />
      <ItemsTree />
      <PropsSheet />
      <HistoryStrip />
      <CornerFab />
      <ContextMenu />
      <ShortcutsPanel />
      <Tour />
      <LongPressRing />
    </>
  );
}
