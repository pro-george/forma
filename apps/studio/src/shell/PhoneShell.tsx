/**
 * The phone layout (screens under 600 px). Same stores, same catalogue, a
 * different frame built for one thumb:
 *
 *   top bar      ☰ · project · undo · redo · items
 *   hint line    one sentence: what to do next
 *   selection    "Face · 800 mm²" with ✕, sitting on the bar
 *   bottom bar   row 1: selection filter [Body | Face | Edge] + Create
 *                row 2: the tools that apply to the selection (scrolls sideways)
 *                during an action: value with − / + and Cancel / Apply
 *                in a sketch: the sketch tools, their modes, typed value, ✗ ✓
 *   sheets       items · history · create · properties · menu, pulled over the
 *                scene one at a time; the scene itself stays uncovered.
 *
 * Selection is explicit (the filter says what a tap picks) because on a
 * phone nothing is precise enough to tell an edge from a face by distance.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { featureById, topLevel } from '@forma/core';
import { useStore } from '../state/store';
import { useSketch } from '../state/sketch';
import { useSel, selContext } from '../state/sel';
import { useOp } from '../state/op';
import { useTool } from '../state/tool';
import { useUI, type PhoneSheet } from '../state/ui';
import { Icon, featureIcon } from '../components/icons';
import { railTools, SKETCH_PLANES, PRIMITIVES, type RailTool } from './catalogue';
import { dispatch } from './actions';
import { Inspector } from '../components/Inspector';
import { ContextMenu, useContextMenu } from '../components/ContextMenu';
import { FilamentPalette } from '../components/Filaments';
import { describeChange } from '../components/Timeline';
import { sketchHint } from '../components/SketchHUD';
import { NumberField } from '../components/fields';
import { Tour } from './Tour';
import { MenuItems, StepEditor, useSelectionText, LongPressRing, ShortcutsPanel, iconOf } from './Shell';

/* ---------- top bar ---------- */

function PhoneTop() {
  const s = useStore();
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  const open = useUI((u) => u.openPhoneSheet);
  const sheet = useUI((u) => u.phoneSheet);
  const active = useSketch((k) => k.active);
  const sk = useSketch.getState();
  return (
    <div className="ph-top">
      <button className="ph-ib" aria-label="Menu" onClick={() => open(sheet === 'menu' ? null : 'menu')}><Icon.menu /></button>
      <input className="ph-name" aria-label="Project name" value={s.doc.name} onChange={(e) => s.setDoc({ ...s.doc, name: e.target.value }, { undoable: false })} />
      <button className="ph-ib" aria-label="Undo" disabled={!s.canUndo() && !active?.draft.length} onClick={() => { if (active?.draft.length) sk.escape(); else s.undo(); }}><Icon.undo /></button>
      <button className="ph-ib" aria-label="Redo" disabled={!s.canRedo()} onClick={s.redo}><Icon.redo /></button>
      <button className={`ph-ib${sheet === 'items' ? ' on' : ''}`} aria-label="Items and history" onClick={() => open(sheet === 'items' ? null : 'items')}><Icon.list /></button>
    </div>
  );
}

/* ---------- hint line: the next step, always ---------- */

function PhoneHint() {
  const active = useSketch((k) => k.active);
  const rectMode = useSketch((k) => k.rectMode);
  const circleMode = useSketch((k) => k.circleMode);
  const op = useOp((o) => o.op);
  const filter = useSel((x) => x.filter);
  const faces = useSel((x) => x.faces);
  const edges = useSel((x) => x.edges);
  const regions = useSel((x) => x.regions);
  const sel = useStore((s) => s.selection);
  const tool = useTool((t) => t.tool);
  const picking = useSketch((k) => k.pickingFace);
  let text: ReactNode;
  if (op?.kind === 'pushpull') text = <>Drag <b>up / down</b> on the model or set the distance below. Positive adds, negative cuts. Then <b>Apply</b>.</>;
  else if (op?.kind === 'edgeop') text = <>Set the {op.tool === 'round' ? 'radius' : 'size'} below (or drag the handle), then <b>Apply</b>.</>;
  else if (active) text = <><b>{active.tool[0]!.toUpperCase() + active.tool.slice(1)}</b> · {sketchHint(active, rectMode, circleMode, regions.length > 0).replace(/Click/g, 'Tap').replace(/click/g, 'tap')}</>;
  else if (picking) text = <>Tap a <b>flat face</b> to sketch on it.</>;
  else if (edges.length) text = <>Edge selected · <b>Fillet</b> or <b>Chamfer</b> below. Tap another edge to switch, ✕ to clear.</>;
  else if (faces.length) text = <>Face selected · <b>Push</b> gives it depth, <b>Sketch</b> draws on it.</>;
  else if (sel.length) text = tool === 'rotate' ? <>Drag a <b>ring</b> to rotate. Tools for this body are below.</> : <>Drag an <b>arrow</b> to move. Tools for this body are below.</>;
  else if (filter === 'face') text = <>Tap a <b>flat face</b> of a body.</>;
  else if (filter === 'edge') text = <>Tap right on an <b>edge line</b>.</>;
  else text = <>Tap a <b>body</b> to select it · <b>+</b> adds a sketch or a shape · one finger orbits, two pan and zoom.</>;
  return <div className="ph-hint">{text}</div>;
}

/* ---------- bottom bar ---------- */

function PhoneBar() {
  const active = useSketch((k) => k.active);
  const op = useOp((o) => o.op);
  if (active) return <SketchBar />;
  if (op) return <OpBar />;
  return <ToolsBar />;
}

function ToolsBar() {
  const sel = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  const modules = useStore((s) => s.modules);
  const faces = useSel((x) => x.faces);
  const edges = useSel((x) => x.edges);
  const regions = useSel((x) => x.regions);
  const filter = useSel((x) => x.filter);
  const setFilter = useSel((x) => x.setFilter);
  const tool = useTool((t) => t.tool);
  const open = useUI((u) => u.openPhoneSheet);
  const text = useSelectionText();
  const ctx = selContext(false);
  const first = sel[0] ? featureById(doc, sel[0]) : undefined;
  const tools = useMemo(() => railTools(ctx, { bodies: sel.length, modules, selectedIsCombine: first?.type === 'combine', selectedIsModule: first?.type === 'module', ortho: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, sel.length, modules, first?.type, faces.length, edges.length, regions.length]);
  const run = (t: RailTool) => {
    if (t.children) { open('create'); return; }
    dispatch(t.id, t.arg);
    if (t.id === 'split' || t.id === 'mirror' || t.id.startsWith('pattern')) open('props');
  };
  const pick = (f: 'body' | 'face' | 'edge') => { setFilter(f); useSel.getState().clear(); };
  return (
    <div className="ph-bar">
      {text && (
        <div className="ph-selcard">
          <span>{text}</span>
          <button className="ph-x" aria-label="Clear selection" onClick={() => useSel.getState().clear()}><Icon.close /></button>
        </div>
      )}
      <div className="ph-row">
        <div className="ph-seg" role="radiogroup" aria-label="What a tap selects">
          <button className={filter === 'body' ? 'on' : ''} onClick={() => pick('body')}>Body</button>
          <button className={filter === 'face' ? 'on' : ''} onClick={() => pick('face')}>Face</button>
          <button className={filter === 'edge' ? 'on' : ''} onClick={() => pick('edge')}>Edge</button>
        </div>
        <button className="ph-create" onClick={() => open('create')}><Icon.plus /><span>Create</span></button>
      </div>
      {ctx !== 'none' && (
        <div className="ph-tools">
          {tools.map((t) => (
            <button key={t.id + (t.arg ?? '')} className={`ph-tool${(t.id === 'move' || t.id === 'rotate') && t.id === tool && sel.length ? ' on' : ''}`} onClick={() => run(t)} title={t.tip}>
              {iconOf(t.icon)}<span>{t.label}</span>
            </button>
          ))}
          {sel.length === 1 && <button className="ph-tool" onClick={() => open('props')} title="Edit the numbers of this step"><Icon.settings /><span>Edit</span></button>}
        </div>
      )}
    </div>
  );
}

function OpBar() {
  const op = useOp((o) => o.op)!;
  const dragging = useOp((o) => o.dragging);
  const [buf, setBuf] = useState('');
  const value = op.kind === 'pushpull' ? op.distance : op.value;
  useEffect(() => { if (!dragging) setBuf((Math.round(value * 100) / 100).toString()); }, [value, dragging]);
  const o = useOp.getState();
  const title = op.kind === 'pushpull' ? (op.region ? 'Push region' : 'Push / Pull') : op.tool === 'round' ? 'Fillet' : 'Chamfer';
  const label = op.kind === 'pushpull' ? (op.symmetric ? 'per side' : 'distance') : op.tool === 'round' ? 'radius' : 'size';
  return (
    <div className="ph-bar op">
      <div className="ph-row">
        <b className="ph-optitle">{title}</b>
        {op.kind === 'pushpull' && <label className="ph-chk"><input type="checkbox" checked={op.symmetric} onChange={(e) => o.setSymmetric(e.target.checked)} /> Symmetric</label>}
        {op.kind === 'edgeop' && (
          <div className="ph-seg small"><button className={op.tool === 'round' ? 'on' : ''} onClick={() => o.setTool('round')}>Fillet</button><button className={op.tool === 'chamfer' ? 'on' : ''} onClick={() => o.setTool('chamfer')}>Chamfer</button></div>
        )}
      </div>
      <div className="ph-row">
        <div className="ph-value">
          <button aria-label="Minus 1" onClick={() => o.setValue(value - 1, true)}>−</button>
          <input value={buf} inputMode="decimal" aria-label={label} onChange={(e) => { setBuf(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) o.setValue(v, true); }} onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); o.confirm(); } e.stopPropagation(); }} />
          <span className="ph-unit">mm {label}</span>
          <button aria-label="Plus 1" onClick={() => o.setValue(value + 1, true)}>+</button>
        </div>
      </div>
      <div className="ph-row">
        <button className="ph-btn cancel" onClick={o.cancel}><Icon.close /><span>Cancel</span></button>
        <button className="ph-btn apply" onClick={o.confirm}><Icon.check /><span>Apply</span></button>
      </div>
    </div>
  );
}

const SKETCH_TOOLS: { id: 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'polygon' | 'trim'; label: string; icon: keyof typeof Icon }[] = [
  { id: 'select', label: 'Select', icon: 'select' }, { id: 'line', label: 'Line', icon: 'line' }, { id: 'rect', label: 'Rect', icon: 'rect' }, { id: 'circle', label: 'Circle', icon: 'circle' },
  { id: 'arc', label: 'Arc', icon: 'arc' }, { id: 'polygon', label: 'Polygon', icon: 'polygon' }, { id: 'trim', label: 'Trim', icon: 'trim' },
];

function SketchBar() {
  const active = useSketch((k) => k.active)!;
  const host = useSketch((k) => k.host);
  const rectMode = useSketch((k) => k.rectMode);
  const circleMode = useSketch((k) => k.circleMode);
  const sides = useSketch((k) => k.polygonSides);
  const regions = useSel((x) => x.regions);
  const doc = useStore((s) => s.doc);
  const sk = useSketch.getState();
  const f0 = featureById(doc, active.featureId);
  const f = f0 && f0.type === 'extrude' ? f0 : undefined;
  const mode = f?.role === 'hole' ? 'cut' : 'join';
  const [confirm, setConfirm] = useState(false);
  const placing = active.draft.length > 0;
  const typedLabel = active.tool === 'circle' ? 'diameter' : active.tool === 'rect' ? (active.typedW !== null ? 'height' : 'width') : active.tool === 'polygon' ? 'radius' : 'length';
  return (
    <div className="ph-bar sketch">
      <div className="ph-tools">
        {SKETCH_TOOLS.map((t) => (
          <button key={t.id} className={`ph-tool${active.tool === t.id ? ' on' : ''}`} onClick={() => sk.setTool(t.id)}>{iconOf(t.icon)}<span>{t.label}</span></button>
        ))}
        <button className="ph-tool" onClick={() => sk.lookAt()}><Icon.camera /><span>Look at</span></button>
      </div>
      <div className="ph-row">
        {active.tool === 'rect' && <div className="ph-seg small"><button className={rectMode === 'corner' ? 'on' : ''} onClick={() => sk.setRectMode('corner')}>Corner</button><button className={rectMode === 'center' ? 'on' : ''} onClick={() => sk.setRectMode('center')}>Center</button></div>}
        {active.tool === 'circle' && <div className="ph-seg small"><button className={circleMode === 'center' ? 'on' : ''} onClick={() => sk.setCircleMode('center')}>Center</button><button className={circleMode === '2pt' ? 'on' : ''} onClick={() => sk.setCircleMode('2pt')}>2-Point</button></div>}
        {active.tool === 'polygon' && <div className="ph-seg small"><button onClick={() => sk.setPolygonSides(sides - 1)}>−</button><span className="ph-sides">{sides} sides</span><button onClick={() => sk.setPolygonSides(sides + 1)}>+</button></div>}
        {host && active.tool === 'select' && <div className="ph-seg small"><button className={mode === 'join' ? 'on' : ''} onClick={() => sk.setMode('join')}>Join</button><button className={mode === 'cut' ? 'on hole' : ''} onClick={() => sk.setMode('cut')}>Cut</button></div>}
        {placing && active.tool !== 'arc' && active.tool !== 'trim' && (
          <div className="ph-typed">
            <input inputMode="decimal" placeholder={`exact ${typedLabel} (mm)`} aria-label={`Exact ${typedLabel}`} value={active.typed} onChange={(e) => sk.setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { sk.enter(); } e.stopPropagation(); }} />
            <button className="ph-x" aria-label="Apply the typed value" disabled={!active.typed} onClick={() => sk.enter()}><Icon.check /></button>
          </div>
        )}
        {!placing && active.tool === 'select' && regions.length > 0 && <button className="ph-btn apply grow" onClick={() => dispatch('pushpull')}><Icon.pushpull /><span>Push region</span></button>}
        {!placing && active.tool === 'select' && regions.length === 0 && f && (
          <label className="ph-height">{mode === 'cut' ? 'Depth' : 'Height'}<NumberField value={f.height} min={0.1} step={1} unit="mm" onChange={(v) => useStore.getState().patchFeature(f.id, { height: v }, { undoable: false })} /></label>
        )}
      </div>
      <div className="ph-row">
        {placing && active.tool === 'line' && active.draft.length > 1 && <button className="ph-btn cancel" onClick={() => sk.backspace()}><Icon.undo /><span>Point</span></button>}
        {placing && <button className="ph-btn cancel" onClick={() => sk.escape()}><Icon.close /><span>Cancel shape</span></button>}
        {!placing && <button className="ph-btn cancel" onClick={() => setConfirm(true)}><Icon.close /><span>Discard</span></button>}
        <button className="ph-btn apply" onClick={() => (placing ? sk.enter() : sk.finish())}><Icon.check /><span>{placing ? 'Finish shape' : 'Done'}</span></button>
      </div>
      {confirm && (
        <div className="modal-back" onClick={() => setConfirm(false)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <p>Leave the sketch and throw away its changes?</p>
            <div className="foot"><button className="danger" onClick={() => { setConfirm(false); sk.cancel(); }}>Discard Sketch</button><button onClick={() => setConfirm(false)}>Keep Editing</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- sheets ---------- */

function Sheet({ id, title, children }: { id: PhoneSheet; title: string; children: ReactNode }) {
  const sheet = useUI((u) => u.phoneSheet);
  const open = useUI((u) => u.openPhoneSheet);
  if (sheet !== id) return null;
  return (
    <>
      <div className="ph-scrim" onClick={() => open(null)} />
      <section className="ph-sheet" role="dialog" aria-label={title}>
        <div className="ph-sheet-head"><i className="ph-grab" /><span>{title}</span><button className="ph-ib" aria-label="Close" onClick={() => open(null)}><Icon.close /></button></div>
        <div className="ph-sheet-body">{children}</div>
      </section>
    </>
  );
}

function ItemsSheet() {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const toggleVisible = useStore((s) => s.toggleVisible);
  const open = useUI((u) => u.openPhoneSheet);
  const [tab, setTab] = useState<'items' | 'history'>('items');
  const roots = topLevel(doc);
  const row = (f: (typeof roots)[number]) => (
    <div key={f.id} className={`trow${selection.includes(f.id) ? ' sel' : ''}${f.visible ? '' : ' off'}`}
      onClick={() => { useSel.getState().setNavOnly(true); useSel.getState().pickBody(f.id, false); open(null); }}>
      <button className="eye" aria-label={f.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); toggleVisible(f.id); }}><Icon.eye /></button>
      {featureIcon(f.type)}
      <span className="nm">{f.name}</span>
      {f.role === 'hole' && <span className="tag hole">hole</span>}
      {results.get(f.id)?.error && <span className="tag err">!</span>}
      <i className="fdot" style={{ background: doc.filaments[f.filament - 1]?.color }} />
      <button className="more" aria-label="More" onClick={(e) => { e.stopPropagation(); useSel.getState().setNavOnly(true); useSel.getState().pickBody(f.id, false); useContextMenu.getState().show(Math.min(e.clientX, window.innerWidth - 240), Math.max(80, e.clientY - 200), [f.id]); }}><Icon.more /></button>
    </div>
  );
  return (
    <Sheet id="items" title={tab === 'items' ? 'Items' : 'History'}>
      <div className="ph-seg wide"><button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>Items</button><button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button></div>
      {tab === 'items' ? (
        <>
          <h6>Bodies <small>{roots.length}</small></h6>
          {roots.length ? [...roots].reverse().map(row) : <div className="dim">Nothing here yet — tap Create.</div>}
          <div className="tree-filaments"><FilamentPalette /></div>
        </>
      ) : <HistoryList />}
    </Sheet>
  );
}

function HistoryList() {
  const doc = useStore((s) => s.doc);
  const results = useStore((s) => s.results);
  const rollback = useStore((s) => s.rollback);
  const setRollback = useStore((s) => s.setRollback);
  const timeline = useStore((s) => s.timeline);
  const tick = useStore((s) => s.historyTick);
  const [edit, setEdit] = useState<string | null>(null);
  const n = doc.features.length;
  const cursor = rollback ?? n;
  const lastLabel = useMemo(() => { const { past, current } = timeline(); const prev = past[past.length - 1]; return prev ? describeChange(prev, current) : 'Start'; }, [tick, timeline]); // eslint-disable-line react-hooks/exhaustive-deps
  if (n === 0) return <div className="dim">No steps yet.</div>;
  return (
    <div className="ph-hist">
      <div className="dim">{rollback !== null ? `Rolled back to ${rollback} / ${n}` : `${n} step${n === 1 ? '' : 's'}`} · last: {lastLabel}</div>
      {doc.features.map((f, i) => {
        const r = results.get(f.id);
        const cls = ['ph-step'];
        if (i === cursor - 1) cls.push('cur'); if (i >= cursor) cls.push('undone'); if (!f.visible) cls.push('disabled'); if (r?.error) cls.push('failed'); if (f.parentId) cls.push('child');
        return (
          <div key={f.id}>
            <button className={cls.join(' ')} onClick={() => { setEdit(edit === f.id ? null : f.id); if (edit !== f.id) useStore.getState().select([f.id]); }}>
              <small>{i + 1}</small>{featureIcon(f.type)}<span>{f.name}</span>{r?.error && <span className="tag err">!</span>}{i >= cursor && <small className="dim">undone</small>}
            </button>
            {edit === f.id && <div className="ph-stepedit"><StepEditor id={f.id} index={i} cursor={cursor} onClose={() => setEdit(null)} setRollback={setRollback} /></div>}
          </div>
        );
      })}
    </div>
  );
}

function CreateSheet() {
  const modules = useStore((s) => s.modules);
  const faces = useSel((x) => x.faces);
  const sel = useStore((s) => s.selection);
  const open = useUI((u) => u.openPhoneSheet);
  const go = (id: Parameters<typeof dispatch>[0], arg?: string) => { dispatch(id, arg); open(null); };
  const Row = ({ icon, label, tip, onClick }: { icon: ReactNode; label: string; tip?: string; onClick: () => void }) => (
    <button className="ph-crow" onClick={onClick}>{icon}<span><b>{label}</b>{tip && <small>{tip}</small>}</span></button>
  );
  return (
    <Sheet id="create" title="Create">
      {faces[0] && <Row icon={<Icon.sketch />} label="Sketch on the selected face" tip="Draw on that face, then push the region in or out" onClick={() => go('sketch.face')} />}
      {sel.length === 1 && !faces[0] && <Row icon={<Icon.sketch />} label="Edit the selected part" tip="Reopen its sketch or parameters" onClick={() => go('sketch.edit')} />}
      <h6>New sketch</h6>
      {SKETCH_PLANES.map((p) => <Row key={p.id} icon={<Icon.grid />} label={p.label} tip={p.tip} onClick={() => go(p.id)} />)}
      <h6>Primitive</h6>
      <div className="ph-grid">{PRIMITIVES.map((p) => <button key={p.id} className="ph-tool" onClick={() => go(p.id)} title={p.tip}>{iconOf(p.icon)}<span>{p.label}</span></button>)}</div>
      <h6>Ready-made parts</h6>
      {modules.map((m) => <Row key={m.id} icon={<Icon.module />} label={m.name} tip={m.description} onClick={() => go('module', m.id)} />)}
    </Sheet>
  );
}

function PropsSheet() {
  const sel = useStore((s) => s.selection);
  const open = useUI((u) => u.openPhoneSheet);
  const sheet = useUI((u) => u.phoneSheet);
  useEffect(() => { if (sheet === 'props' && sel.length === 0) open(null); }, [sel.length, sheet, open]);
  return <Sheet id="props" title="Properties"><Inspector /></Sheet>;
}

function MenuSheet() {
  const open = useUI((u) => u.openPhoneSheet);
  return <Sheet id="menu" title="Menu"><div className="menu-list ph-menu"><MenuItems close={() => open(null)} /></div></Sheet>;
}

/* ---------- the shell ---------- */

export function PhoneShell() {
  const light = useUI((u) => u.light);
  const sheet = useUI((u) => u.phoneSheet);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; document.documentElement.dataset.touch = '1'; document.documentElement.dataset.phone = '1'; return () => { delete document.documentElement.dataset.phone; }; }, [light]);
  // close any sheet when an action or a sketch starts
  const op = useOp((o) => o.op);
  const active = useSketch((k) => !!k.active);
  useEffect(() => { if ((op || active) && sheet && sheet !== 'props') useUI.getState().openPhoneSheet(null); }, [op, active]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PhoneTop />
      <PhoneHint />
      <div className="ph-bottom" ref={barRef}><PhoneBar /></div>
      <ItemsSheet />
      <CreateSheet />
      <PropsSheet />
      <MenuSheet />
      <ContextMenu />
      <ShortcutsPanel />
      <Tour />
      <LongPressRing />
    </>
  );
}
