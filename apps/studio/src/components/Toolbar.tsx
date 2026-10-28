import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { useViewStore } from '../state/view';
import { useSketch } from '../state/sketch';
import { usePushPull } from '../state/pushpull';
import { useEdges } from '../state/edges';
import { useTool, TOOL_INFO, type Tool as ToolId } from '../state/tool';
import { useHover } from '../state/hover';
import { Icon } from './icons';
import { AddMenu } from './AddMenu';

/** A button that opens a popover under itself; closes on outside click or Escape. */
export function Dropdown({ label, title, tip, children, className = '', align = 'left', open: controlled, onOpenChange }: {
  label: ReactNode; title?: string; tip?: string; children: (close: () => void) => ReactNode; className?: string; align?: 'left' | 'right' | 'center'; open?: boolean; onOpenChange?: (v: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (v: boolean) => { setOwn(v); onOpenChange?.(v); };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <div className={`dd ${className}`} ref={ref}>
      <button className={`tool${open ? ' open' : ''}`} data-tip={tip} title={title} onClick={() => setOpen(!open)} aria-expanded={open}>{label}</button>
      {open && <div className={`popover ${align}`} role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** Toolbar button: icon + label, a key badge, and a tooltip that says what it does. */
function ToolButton({ icon, label, tip, keyHint, on, disabled, onClick }: { icon: ReactNode; label: string; tip: string; keyHint?: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`tool${on ? ' on' : ''}`} data-tip={keyHint ? `${tip} — ${keyHint}` : tip} disabled={disabled} onClick={onClick} aria-pressed={on} aria-label={label}>
      {icon}<span>{label}</span>
      {keyHint && <kbd>{keyHint}</kbd>}
    </button>
  );
}

const Sep = () => <i className="tsep" />;

/**
 * The top bar: project on the left, tools in the middle, undo/export on the
 * right. Tools are modes you can see — the active one is lit — and the hint
 * bar under them says what a press will do right now.
 */
export function Toolbar() {
  const s = useStore();
  const view = useViewStore();
  const tool = useTool((st) => st.tool);
  const setTool = useTool((st) => st.set);
  const sketching = useSketch((st) => !!st.active);
  const pickingFace = useSketch((st) => st.pickingFace);
  const fileInput = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  useEffect(() => useStore.subscribe(() => force((n) => n + 1)), []);
  const pick = (t: ToolId) => {
    useSketch.getState().disarmFacePick();
    if ((t === 'move' || t === 'rotate' || t === 'edges') && s.selection.length === 0) s.toast(`${TOOL_INFO[t].name}: click a part first, then use the handles`);
    setTool(t);
  };
  const toolBtn = (t: ToolId, icon: ReactNode) => (
    <ToolButton icon={icon} label={TOOL_INFO[t].name} tip={TOOL_INFO[t].what} keyHint={TOOL_INFO[t].key} on={tool === t && !sketching && !pickingFace} onClick={() => pick(t)} />
  );

  return (
    <>
      <header className="bar bar-left glass-dark">
        <span className="logo">F</span>
        <input aria-label="Project name" value={s.doc.name} onChange={(e) => s.setDoc({ ...s.doc, name: e.target.value }, { undoable: false })} />
        <Dropdown label={<><Icon.file /><span>File</span></>} tip="New, open and save projects (.forma files)">{(close) => (
          <div className="menu-list">
            <button onClick={() => { s.newDocument(); close(); }}>New <small>empty scene</small></button>
            <button onClick={() => { s.loadSample(); close(); }}>Open sample scene</button>
            <hr />
            <button onClick={() => { fileInput.current?.click(); close(); }}>Open .forma…</button>
            <button onClick={() => { s.saveFile(); close(); }}>Save .forma <small>⌘S</small></button>
          </div>
        )}</Dropdown>
        <input ref={fileInput} type="file" accept=".forma,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) s.openFile(f); e.target.value = ''; }} />
      </header>

      <nav className="bar bar-tools glass-dark" aria-label="Tools">
        {toolBtn('select', <Icon.select />)}
        {toolBtn('move', <Icon.move />)}
        {toolBtn('rotate', <Icon.rotate />)}
        <Sep />
        <Dropdown label={<><Icon.plus /><span>Add</span></>} tip="Add a shape or a ready-made part; it lands where the pointer last touched the plate">{(close) => <AddMenu close={close} />}</Dropdown>
        <ToolButton icon={<Icon.sketch />} label="Sketch" tip="Draw a 2D outline and extrude it. First click where it goes: the plate, or a flat face of a part" keyHint="K" on={sketching || pickingFace}
          onClick={() => { if (sketching) return; if (pickingFace) useSketch.getState().disarmFacePick(); else { setTool('select'); useSketch.getState().armFacePick(); } }} />
        {toolBtn('pushpull', <Icon.pushpull />)}
        {toolBtn('edges', <Icon.edges />)}
        <ToolButton icon={<Icon.combine />} label="Combine" tip="Merge the selected parts into one: solids add, holes cut, keep intersects" keyHint="⌘G" disabled={s.selection.length < 2} onClick={s.combineSelected} />
        <Sep />
        <ToolButton icon={<Icon.grid />} label="Grid" tip="Show the build plate grid (1 mm lines, 10 mm bold)" keyHint="G" on={s.showGrid} onClick={s.toggleGrid} />
        <ToolButton icon={<Icon.wire />} label="Wire" tip="Wireframe: see the triangles the printer will get" on={s.wireframe} onClick={s.toggleWireframe} />
        <ToolButton icon={<Icon.light />} label="Print" tip="Matte PLA shading with a hard light: judge relief the way the print will show it" on={s.printLook} onClick={s.togglePrintLook} />
        <Dropdown label={<><Icon.camera /><span>View</span></>} tip="Camera presets, fit and arrange" align="right">{(close) => (
          <div className="menu-list">
            {(['iso', 'top', 'front', 'right'] as const).map((p) => <button key={p} onClick={() => { view.setPreset(p); close(); }}>{p[0]!.toUpperCase() + p.slice(1)}</button>)}
            <hr />
            <button onClick={() => { view.fit(); close(); }}>Fit selection / all <small>Z</small></button>
            <button onClick={() => { s.arrangeParts(); view.fit(); close(); }}>Arrange parts on plate <small>256 mm, no overlaps</small></button>
          </div>
        )}</Dropdown>
      </nav>

      <div className="bar bar-right glass-dark">
        <button className="tool" data-tip="Undo — ⌘Z" disabled={!s.canUndo()} onClick={s.undo} aria-label="Undo"><Icon.undo /></button>
        <button className="tool" data-tip="Redo — ⇧⌘Z" disabled={!s.canRedo()} onClick={s.redo} aria-label="Redo"><Icon.redo /></button>
        <Dropdown className="primary" align="right" label={<><Icon.download /><span>Export</span></>} tip="Download for your slicer">{(close) => (
          <div className="menu-list export">
            <button onClick={() => { s.exportModel('bambu'); close(); }}><b>3MF for Bambu Studio</b><small>parts land in AMS slots · also Orca</small></button>
            <button onClick={() => { s.exportModel('3mf'); close(); }}><b>3MF with colours</b><small>PrusaSlicer, Cura</small></button>
            <button onClick={() => { s.exportModel('stl'); close(); }}><b>STL</b><small>one unioned shell</small></button>
            <button onClick={() => { s.exportModel('obj'); close(); }}><b>OBJ</b><small>for other 3D apps</small></button>
            {s.selection.length > 0 && <>
              <hr />
              <button onClick={() => { s.exportModel('bambu', true); close(); }}>Selection as 3MF <small>{s.selection.length} part{s.selection.length > 1 ? 's' : ''}</small></button>
              <button onClick={() => { s.exportModel('stl', true); close(); }}>Selection as STL</button>
            </>}
          </div>
        )}</Dropdown>
      </div>

      <ToolHint />
    </>
  );
}

/**
 * One line under the toolbar that always says what to do next with the
 * current tool — the way Blender's status bar and Fusion's command dialog
 * do — so no tool ever looks "broken" for lack of a selection.
 */
function ToolHint() {
  const tool = useTool((st) => st.tool);
  const sel = useStore((st) => st.selection);
  const doc = useStore((st) => st.doc);
  const sketching = useSketch((st) => !!st.active);
  const pickingFace = useSketch((st) => st.pickingFace);
  const pending = usePushPull((st) => !!st.pending);
  const dragging = usePushPull((st) => st.drag);
  const hoverFace = useHover((h) => !!h.hover?.face);
  const edgeSel = useEdges((e) => e.selected?.indices.length ?? 0);
  if (sketching) return null; // the sketch HUD has its own hint
  const one = sel.length === 1 ? doc.features.find((f) => f.id === sel[0]) : undefined;
  const name = one ? one.name : sel.length > 1 ? `${sel.length} parts` : '';
  let title = TOOL_INFO[tool].name, text: ReactNode, keys: ReactNode = null;
  if (pickingFace) {
    title = 'Sketch';
    text = 'Click the plate where the sketch should go, or click a flat face of a part to draw on it';
    keys = <><kbd>Esc</kbd> cancel</>;
  } else if (dragging) {
    title = 'Push / Pull';
    text = <>{dragging.distance >= 0 ? 'Pulling adds material' : 'Pushing cuts into the part'} · <b>{dragging.distance >= 0 ? '+' : '−'}{Math.abs(dragging.distance).toFixed(1)} mm</b> · release to keep it</>;
  } else switch (tool) {
    case 'select':
      text = sel.length ? <><b>{name}</b> selected · drag it to slide it on the plate · edit its numbers on the right</> : 'Click a part to select it · drag empty space to orbit, right-drag to pan, wheel to zoom';
      keys = sel.length ? <><kbd>M</kbd> move <kbd>R</kbd> rotate <kbd>P</kbd> push/pull <kbd>⌘D</kbd> duplicate <kbd>⌫</kbd> delete</> : <><kbd>B</kbd> box <kbd>C</kbd> cylinder <kbd>K</kbd> sketch · right-click the plate to add here</>;
      break;
    case 'move':
      text = sel.length ? <>Drag the <b>arrows</b> to move <b>{name}</b> along an axis, the <b>squares</b> across a plane, or the part itself to slide it on the plate · 1 mm steps</> : 'Click a part first — the move handles appear on it';
      keys = sel.length ? <><kbd>⇧</kbd> 10 mm steps <kbd>←↑↓→</kbd> nudge <kbd>Esc</kbd> back to Select</> : null;
      break;
    case 'rotate':
      text = sel.length ? <>Drag a <b>ring</b> to turn <b>{name}</b> around that axis · 5° steps · exact angles on the right under Placement</> : 'Click a part first — the rotate rings appear on it';
      keys = sel.length ? <><kbd>Esc</kbd> back to Select</> : null;
      break;
    case 'pushpull':
      text = pending ? <>Type a distance and press <b>Enter</b> (negative cuts), or drag the orange arrow</> : hoverFace ? <>Press and drag: <b>out</b> adds material, <b>in</b> cuts · or click to type a distance</> : 'Move over a flat face of any part — it lights up — then press and drag it';
      keys = <><kbd>Esc</kbd> back to Select</>;
      break;
    case 'edges':
      text = !sel.length ? 'Click a part first — its straight edges become pickable' : edgeSel ? <>{edgeSel} edge{edgeSel > 1 ? 's' : ''} picked · choose <b>Round</b> or <b>Chamfer</b> and a size above, then Apply</> : <>Click an edge of <b>{name}</b> · <kbd>⇧</kbd>-click picks more</>;
      keys = <><kbd>Esc</kbd> back to Select</>;
      break;
  }
  return (
    <div className="toolhint" role="status">
      <b className="th-tool">{title}</b>
      <span className="th-text">{text}</span>
      {keys && <span className="th-keys">{keys}</span>}
    </div>
  );
}
