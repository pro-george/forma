import { useState } from 'react';
import { featureById, inputVisible, parseProfileInput, defaultEdges, defaultRepeat, type Edges, type Feature, type FeatureOf, type Modifiers, type Repeat, type Vec2 } from '@forma/core';
import { useStore } from '../state/store';
import type { ModuleInfo } from '../state/worker-client';
import { Field, NumberField, Slider, TextField, formatNum } from './fields';
import { ProfileCanvas, ProfileEditor } from './ProfileEditor';
import { ImageField } from './ImageField';
import { useSketch } from '../state/sketch';
import { FilamentPicker, FilamentPalette } from './Filaments';

type NumKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
interface FieldDef<T extends Feature> { key: NumKey<T>; label: string; min?: number; max?: number; step?: number; unit?: string }

const mm = { unit: 'mm', min: 0.1, step: 1 } as const;
const seg = { label: 'Segments', min: 3, max: 256, step: 1 } as const;
const FIELDS: { [T in Feature['type']]?: FieldDef<FeatureOf<T>>[] } = {
  box: [{ key: 'width', label: 'Width', ...mm }, { key: 'depth', label: 'Depth', ...mm }, { key: 'height', label: 'Height', ...mm }],
  cylinder: [{ key: 'radius', label: 'Radius', ...mm }, { key: 'height', label: 'Height', ...mm }, { key: 'segments', ...seg }],
  cone: [{ key: 'radiusBottom', label: 'Base radius', ...mm }, { key: 'radiusTop', label: 'Top radius', unit: 'mm', min: 0, step: 1 }, { key: 'height', label: 'Height', ...mm }, { key: 'segments', ...seg }],
  sphere: [{ key: 'radius', label: 'Radius', ...mm }, { key: 'segments', label: 'Segments', min: 4, max: 256, step: 4 }],
  torus: [{ key: 'ringRadius', label: 'Ring radius', ...mm }, { key: 'tubeRadius', label: 'Tube radius', ...mm }, { key: 'segments', ...seg }],
  tube: [{ key: 'radius', label: 'Outer radius', ...mm }, { key: 'innerRadius', label: 'Inner radius', ...mm }, { key: 'height', label: 'Height', ...mm }, { key: 'segments', ...seg }],
  extrude: [{ key: 'height', label: 'Height', ...mm }, { key: 'scaleTop', label: 'Top scale', min: 0, max: 5, step: 0.05, unit: '×' }, { key: 'twist', label: 'Twist', min: -720, max: 720, step: 5, unit: '°' }],
  revolve: [{ key: 'height', label: 'Height', ...mm }, { key: 'wall', label: 'Wall (0 = solid)', unit: 'mm', min: 0, step: 0.2 }, { key: 'floor', label: 'Floor', unit: 'mm', min: 0, step: 0.2 }, { key: 'smoothing', label: 'Smoothing', min: 0, max: 5, step: 1 }, { key: 'segments', label: 'Segments', min: 8, max: 256, step: 8 }],
  mesh: [{ key: 'scale', label: 'Scale', min: 0.1, max: 20, step: 0.1, unit: '×' }],
};

type NumModKey = { [K in keyof Modifiers]: Modifiers[K] extends number ? K : never }[keyof Modifiers];
const MOD_DEFS: { key: NumModKey; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'twist', label: 'Twist', min: -360, max: 360, step: 5, unit: '°' },
  { key: 'taper', label: 'Taper', min: -90, max: 200, step: 1, unit: '%' },
  { key: 'rippleAmplitude', label: 'Ripple', min: 0, max: 10, step: 0.1, unit: 'mm' },
  { key: 'rippleWaves', label: 'Waves', min: 1, max: 24, step: 1, unit: '' },
  { key: 'grooveAmplitude', label: 'Grooves', min: 0, max: 8, step: 0.1, unit: 'mm' },
  { key: 'grooveCount', label: 'Count', min: 2, max: 64, step: 1, unit: '' },
];
const MOD_TYPES = new Set<Feature['type']>(['box', 'cylinder', 'cone', 'sphere', 'revolve', 'mesh', 'extrude', 'tube']);

const LABEL: Record<Feature['type'], string> = { box: 'Box', cylinder: 'Cylinder', cone: 'Cone', sphere: 'Sphere', torus: 'Torus', tube: 'Tube', extrude: 'Extrusion', revolve: 'Revolve', mesh: 'Mesh', combine: 'Combine', module: 'Module' };

export function Inspector() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const results = useStore((s) => s.results);
  const features = selection.map((id) => featureById(doc, id)).filter((f): f is Feature => !!f);

  if (features.length === 0) return (
    <div className="props">
      <div className="empty">Click a part to edit it. Every value stays live — change a hole's radius inside a combined part and the kernel recomputes the boolean.</div>
      <FilamentPalette />
      <h3>Keys</h3>
      <div className="keys">
        <span><b>B</b> box</span><span><b>C</b> cylinder</span><span><b>S</b> sphere</span><span><b>V</b> revolve</span><span><b>K</b> sketch</span><span><b>P</b> push/pull</span>
        <span><b>H</b> hole ⇄ solid</span><span><b>W</b>/<b>E</b> move/rotate</span><span><b>⌘G</b> combine</span><span><b>⌘D</b> duplicate</span><span><b>⌫</b> delete</span><span><b>⌘Z</b> undo</span><span><b>F</b> fit</span><span><b>G</b> grid</span>
      </div>
    </div>
  );
  if (features.length > 1) return <MultiPanel features={features} />;
  const f = features[0]!;
  const err = results.get(f.id)?.error;
  return (
    <div className="props">
      {f.type === 'module' ? <ModulePanel feature={f} /> : <FeaturePanel feature={f} />}
      {err && <div className="note err">⚠ {err}</div>}
    </div>
  );
}

function CommonHeader({ feature }: { feature: Feature }) {
  const patch = useStore((s) => s.patchFeature);
  return (
    <>
      <Field label="Name" htmlFor="f-name"><TextField id="f-name" value={feature.name} onChange={(v) => patch(feature.id, { name: v || feature.name }, { undoable: false })} /></Field>
      <Field label="Role">
        <div className="seg">
          <button className={feature.role === 'solid' ? 'on' : ''} onClick={() => patch(feature.id, { role: 'solid' })}>Solid</button>
          <button className={`hole ${feature.role === 'hole' ? 'on' : ''}`} onClick={() => patch(feature.id, { role: 'hole' })}>Hole</button>
          <button className={feature.role === 'intersect' ? 'on' : ''} onClick={() => patch(feature.id, { role: 'intersect' })} title="Keep only where this overlaps the solids before it (inside a combine)">Keep</button>
        </div>
      </Field>
      {feature.role === 'solid' && feature.parentId === null && <FilamentPicker ids={[feature.id]} />}
    </>
  );
}

const EDGE_KINDS = [{ value: 'none', label: 'None' }, { value: 'round', label: 'Round' }, { value: 'chamfer', label: 'Chamfer' }] as const;
const EDGE_TYPES = new Set<Feature['type']>(['box', 'cylinder', 'extrude']);

/** Fillet / chamfer / bevel for profile-based solids. */
function EdgesPanel({ feature }: { feature: Feature }) {
  const patch = useStore((s) => s.patchFeature);
  if (!EDGE_TYPES.has(feature.type)) return null;
  const edges: Edges = { ...defaultEdges(), ...((feature as { edges?: Partial<Edges> }).edges ?? {}) };
  const set = (part: keyof Edges, v: Partial<Edges[keyof Edges]>, undoable = true) => patch(feature.id, { edges: { ...edges, [part]: { ...edges[part], ...v } } } as Partial<Feature>, { undoable });
  const rows: { key: keyof Edges; label: string; hint: string }[] = feature.type === 'cylinder'
    ? [{ key: 'top', label: 'Top edge', hint: 'rim' }, { key: 'bottom', label: 'Bottom edge', hint: 'base' }]
    : [{ key: 'sides', label: 'Corners (bevel)', hint: 'vertical corners of the outline' }, { key: 'top', label: 'Top edge', hint: '' }, { key: 'bottom', label: 'Bottom edge', hint: '' }];
  const twisted = feature.type === 'extrude' && (feature.twist !== 0 || feature.scaleTop !== 1);
  return (
    <>
      <h3>Edges</h3>
      {rows.map((r) => (
        <div key={r.key} className="edge-row">
          <label>{r.label}</label>
          <select value={edges[r.key].kind} onChange={(e) => set(r.key, { kind: e.target.value as Edges['sides']['kind'] })}>{EDGE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
          <NumberField value={edges[r.key].size} min={0} step={0.5} unit="mm" onChange={(v) => set(r.key, { size: v }, false)} />
        </div>
      ))}
      <div className="note">{twisted ? 'Top and bottom treatments need a straight extrusion (no twist, top scale 1); corners still apply.' : 'Round = fillet, Chamfer = flat cut. Top and bottom rounds are built from 0.3 mm slices, finer than a printed layer.'}</div>
    </>
  );
}

const REPEAT_MODES = [{ value: 'none', label: 'Off' }, { value: 'linear', label: 'Linear' }, { value: 'grid', label: 'Grid' }, { value: 'radial', label: 'Radial' }, { value: 'mirror', label: 'Mirror' }] as const;

/** Repeater (linear / grid / radial / mirror) for any part, including combines. */
function RepeatPanel({ feature }: { feature: Feature }) {
  const patch = useStore((s) => s.patchFeature);
  const r: Repeat = { ...defaultRepeat(), ...(feature.repeat ?? {}) };
  const set = (v: Partial<Repeat>, undoable = true) => patch(feature.id, { repeat: { ...r, ...v } } as Partial<Feature>, { undoable });
  const vec = (key: 'step' | 'step2') => (
    <div className="triple">
      {(['x', 'y', 'z'] as const).map((ax) => <NumberField key={ax} axis={ax} value={r[key][ax]} step={1} onChange={(v) => set({ [key]: { ...r[key], [ax]: v } }, false)} />)}
    </div>
  );
  return (
    <>
      <h3>Repeat</h3>
      <Field label="Mode"><select value={r.mode} onChange={(e) => set({ mode: e.target.value as Repeat['mode'] })}>{REPEAT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
      {(r.mode === 'linear' || r.mode === 'grid') && (
        <>
          <Field label="Count"><NumberField value={r.count} min={1} max={200} step={1} onChange={(v) => set({ count: Math.round(v) }, false)} /></Field>
          <div className="field-block"><label>Step (mm)</label>{vec('step')}</div>
          {r.mode === 'grid' && (
            <>
              <Field label="Count 2"><NumberField value={r.count2} min={1} max={200} step={1} onChange={(v) => set({ count2: Math.round(v) }, false)} /></Field>
              <div className="field-block"><label>Step 2 (mm)</label>{vec('step2')}</div>
            </>
          )}
        </>
      )}
      {r.mode === 'radial' && (
        <>
          <Field label="Count"><NumberField value={r.count} min={1} max={200} step={1} onChange={(v) => set({ count: Math.round(v) }, false)} /></Field>
          <Field label="Sweep"><NumberField value={r.sweep} min={-360} max={360} step={5} unit="°" onChange={(v) => set({ sweep: v }, false)} /></Field>
          <Field label="Centre X"><NumberField value={r.center[0]} step={1} unit="mm" onChange={(v) => set({ center: [v, r.center[1]] }, false)} /></Field>
          <Field label="Centre Y"><NumberField value={r.center[1]} step={1} unit="mm" onChange={(v) => set({ center: [r.center[0], v] }, false)} /></Field>
          <div className="note">Copies turn around a point in the part's own frame. Put the centre 30 mm to the left to spread the part on a 30 mm circle.</div>
        </>
      )}
      {r.mode === 'mirror' && (
        <>
          <Field label="Across">
            <div className="seg">{(['x', 'y', 'z'] as const).map((ax) => <button key={ax} className={r.axis === ax ? 'on' : ''} onClick={() => set({ axis: ax })}>{ax.toUpperCase()}</button>)}</div>
          </Field>
          <Field label="Plane offset"><NumberField value={r.offset} step={1} unit="mm" onChange={(v) => set({ offset: v }, false)} /></Field>
          <Field label="Keep original"><label className="check"><input type="checkbox" checked={r.keepOriginal} onChange={(e) => set({ keepOriginal: e.target.checked })} /></label></Field>
        </>
      )}
    </>
  );
}

/** Cut a top-level part in two with a plane (print-in-parts, "loop cut"). */
function SplitPanel({ feature }: { feature: Feature }) {
  const split = useStore((s) => s.splitFeature);
  const result = useStore((s) => s.results.get(feature.id));
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>('z');
  const [at, setAt] = useState<number | null>(null);
  const [gap, setGap] = useState(0);
  if (feature.parentId !== null) return null;
  const p = feature.transform.position;
  const mid = result ? (result.bbox.min[axis] + result.bbox.max[axis]) / 2 + p[axis] : p[axis];
  const value = at ?? Math.round(mid * 10) / 10;
  return (
    <>
      <h3>Split</h3>
      <Field label="Plane">
        <div className="seg">{(['x', 'y', 'z'] as const).map((ax) => <button key={ax} className={axis === ax ? 'on' : ''} onClick={() => { setAxis(ax); setAt(null); }}>{ax.toUpperCase()}</button>)}</div>
      </Field>
      <Field label="Position"><NumberField value={value} step={1} unit="mm" onChange={setAt} /></Field>
      <Field label="Gap"><NumberField value={gap} min={0} step={0.1} unit="mm" onChange={setGap} /></Field>
      <div className="actions"><button onClick={() => split(feature.id, { axis, at: value, gap })}>Split into two parts</button></div>
      <div className="note">Both halves stay parametric: each is the original part with a cutting block, so you can still edit the part inside.</div>
    </>
  );
}

function Placement({ feature }: { feature: Feature }) {
  const setTransform = useStore((s) => s.setTransform);
  const t = feature.transform;
  const axes = ['x', 'y', 'z'] as const;
  return (
    <>
      <h3>Placement</h3>
      <div className="field"><label>Position (mm)</label></div>
      <div className="triple">
        {axes.map((a) => <NumberField key={a} axis={a.toUpperCase()} value={t.position[a]} step={1} onChange={(v) => setTransform(feature.id, { position: { ...t.position, [a]: v } }, { undoable: false })} />)}
      </div>
      <div className="field"><label>Rotation (°)</label></div>
      <div className="triple">
        {axes.map((a) => <NumberField key={a} axis={a.toUpperCase()} value={t.rotation[a]} step={15} onChange={(v) => setTransform(feature.id, { rotation: { ...t.rotation, [a]: v } }, { undoable: false })} />)}
      </div>
    </>
  );
}

function ModifiersPanel({ feature }: { feature: Feature }) {
  const patch = useStore((s) => s.patchFeature);
  if (!MOD_TYPES.has(feature.type)) return null;
  return (
    <>
      <h3>Surface modifiers</h3>
      {MOD_DEFS.map((d) => (
        <Slider key={d.key} id={`mod-${d.key}`} label={d.label} min={d.min} max={d.max} step={d.step} unit={d.unit} value={feature.modifiers[d.key]}
          onChange={(v) => patch(feature.id, { modifiers: { ...feature.modifiers, [d.key]: v } }, { undoable: false })} />
      ))}
      <div className="note">Applied on top of the shape by the kernel, so the part stays watertight; the mesh is refined automatically where it bends.</div>
    </>
  );
}

function Actions({ feature }: { feature: Feature }) {
  const s = useStore();
  const isChild = feature.parentId !== null;
  return (
    <div className="actions">
      {feature.type === 'combine' && <button onClick={s.ungroupSelected}>Ungroup</button>}
      {!isChild && <button onClick={s.duplicateSelected}>Duplicate</button>}
      <button onClick={s.deleteSelected}>Delete</button>
    </div>
  );
}

function FeaturePanel({ feature }: { feature: Feature }) {
  const patch = useStore((s) => s.patchFeature);
  const doc = useStore((s) => s.doc);
  const defs = (FIELDS as Record<string, FieldDef<Feature>[] | undefined>)[feature.type];
  return (
    <>
      <h3>{LABEL[feature.type]}</h3>
      <CommonHeader feature={feature} />
      {defs && defs.length > 0 && <h3>Dimensions</h3>}
      {defs?.map((d) => (
        <Field key={String(d.key)} label={d.label} htmlFor={`f-${String(d.key)}`}>
          <NumberField id={`f-${String(d.key)}`} value={(feature as unknown as Record<string, number>)[d.key as string]!} min={d.min} max={d.max} step={d.step} unit={d.unit}
            onChange={(v) => patch(feature.id, { [d.key]: v } as Partial<Feature>, { undoable: false })} />
        </Field>
      ))}
      {feature.type === 'revolve' && <><h3>Profile</h3><ProfileEditor feature={feature} /></>}
      {feature.type === 'extrude' && (
        <>
          <Field label="Direction">
            <div className="seg">
              <button className={!feature.flip ? 'on' : ''} onClick={() => patch(feature.id, { flip: false } as Partial<FeatureOf<'extrude'>>)}>Up</button>
              <button className={feature.flip ? 'on' : ''} onClick={() => patch(feature.id, { flip: true } as Partial<FeatureOf<'extrude'>>)}>Down</button>
            </div>
          </Field>
          <div className="actions"><button className="primary" onClick={() => useSketch.getState().start(feature.id)}>Edit sketch</button></div>
          <div className="note">{feature.sketch ? `${feature.sketch.entities.length} sketch segments` : `${feature.profile?.outer.length ?? 0} outline points`}. Height, top scale and twist are parametric; the outline is edited in the sketcher.</div>
        </>
      )}
      {feature.type === 'combine' && (
        <div className="note">{feature.childIds.length} children, {feature.childIds.filter((id) => featureById(doc, id)?.role === 'hole').length} holes, {feature.childIds.filter((id) => featureById(doc, id)?.role === 'intersect').length} keep. Solids are unioned, Keep parts intersected, holes subtracted. Edit any child in the tree to change the result.</div>
      )}
      {feature.type === 'mesh' && <div className="note">{(feature.positions.length / 9).toLocaleString()} triangles, imported as a watertight mesh; booleans and modifiers work on it like any other part.</div>}
      <EdgesPanel feature={feature} />
      <ModifiersPanel feature={feature} />
      <RepeatPanel feature={feature} />
      <Placement feature={feature} />
      <SplitPanel feature={feature} />
      <Actions feature={feature} />
    </>
  );
}

function ModulePanel({ feature }: { feature: FeatureOf<'module'> }) {
  const modules = useStore((s) => s.modules);
  const patch = useStore((s) => s.patchFeature);
  const bake = useStore((s) => s.bakeModule);
  const [showSource, setShowSource] = useState(false);
  const info: ModuleInfo | undefined = modules.find((m) => m.id === feature.moduleId);
  const result = useStore((st) => st.results.get(feature.id));
  const setInput = (key: string, value: unknown, undoable = false) => patch(feature.id, { inputs: { ...feature.inputs, [key]: value } }, { undoable });
  if (!info) return <><h3>Module</h3><div className="note err">Unknown module "{feature.moduleId}". It may come from a plugin that is not loaded.</div><Actions feature={feature} /></>;
  return (
    <>
      <h3>Module · {info.name}</h3>
      <div className="note" style={{ marginTop: 0 }}>{info.description}</div>
      <CommonHeader feature={feature} />
      <h3>Inputs</h3>
      {(() => {
        const values: Record<string, unknown> = {};
        for (const inp of info.inputs) values[inp.key] = feature.inputs[inp.key] ?? inp.default;
        let lastGroup: string | undefined;
        return info.inputs.filter((inp) => inputVisible(inp, values)).map((inp) => {
          const v = values[inp.key];
          const id = `mi-${inp.key}`;
          const header = inp.group && inp.group !== lastGroup ? <h4 className="group" key={`g-${inp.group}`}>{inp.group}</h4> : null;
          lastGroup = inp.group ?? lastGroup;
          let field: React.ReactNode;
          switch (inp.type) {
            case 'text': field = <Field key={inp.key} label={inp.label} htmlFor={id}><TextField id={id} value={String(v)} placeholder={inp.placeholder} onChange={(t) => setInput(inp.key, t)} /></Field>; break;
            case 'number': field = <Field key={inp.key} label={inp.label} htmlFor={id}><NumberField id={id} value={Number(v)} min={inp.min} max={inp.max} step={inp.step} unit={inp.unit} onChange={(n) => setInput(inp.key, n)} /></Field>; break;
            case 'select': field = <Field key={inp.key} label={inp.label} htmlFor={id}><select id={id} value={String(v)} onChange={(e) => setInput(inp.key, e.target.value, true)}>{inp.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>; break;
            case 'toggle': field = <Field key={inp.key} label={inp.label} htmlFor={id}><label className="check"><input id={id} type="checkbox" checked={Boolean(v)} onChange={(e) => setInput(inp.key, e.target.checked, true)} /></label></Field>; break;
            case 'color': field = <Field key={inp.key} label={inp.label} htmlFor={id}><input id={id} type="color" value={String(v)} onChange={(e) => setInput(inp.key, e.target.value, true)} /></Field>; break;
            case 'image': field = (
              <div key={inp.key} className="field-block">
                <label htmlFor={id}>{inp.label}</label>
                <ImageField id={id} value={String(v)} onChange={(str) => setInput(inp.key, str, true)} />
                {inp.help && <div className="help">{inp.help}</div>}
              </div>
            ); break;
            case 'profile': {
              const fallback = parseProfileInput(inp.default, [[1, 0], [1, 1]]);
              const prof = parseProfileInput(v, fallback);
              const diameter = Number(values.diameter ?? 0);
              field = (
                <div key={inp.key} className="field-block">
                  <label>{inp.label}</label>
                  <ProfileCanvas profile={prof} smoothing={3} heightLabel={`h ${values.height ?? ''} mm`} unit="×" radiusScale={diameter / 2}
                    onChange={(p: Vec2[], undoable) => setInput(inp.key, JSON.stringify(p), undoable)} />
                  {inp.help && <div className="help">{inp.help}</div>}
                </div>
              );
              break;
            }
          }
          return header ? <div key={`w-${inp.key}`}>{header}{field}</div> : field;
        });
      })()}
      {result?.warnings && result.warnings.length > 0 && (
        <div className="note warn"><strong>Print check</strong><ul>{result.warnings.map((w, k) => <li key={k}>{w}</li>)}</ul></div>
      )}
      {info.printNotes && <div className="note"><strong>Printing</strong><br />{info.printNotes}</div>}
      <Placement feature={feature} />
      <div className="actions">
        <button onClick={() => bake(feature.id)}>Bake to parts</button>
        <button onClick={() => setShowSource(true)}>Module code</button>
        <button onClick={useStore.getState().duplicateSelected}>Duplicate</button>
        <button onClick={useStore.getState().deleteSelected}>Delete</button>
      </div>
      <div className="note">A module is a generator: change any input and the whole part is rebuilt as one watertight solid. Bake turns it into ordinary editable parts inside a combine.</div>
      {showSource && (
        <div className="modal-back" onClick={() => setShowSource(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{info.name} · module source</h2>
            <pre>{`registerModule({\n  id: '${info.id}', name: '${info.name}', version: '${info.version ?? '1.0.0'}',\n  inputs: ${JSON.stringify(info.inputs, null, 2)},\n  build: ${info.source}\n})`}</pre>
            <div className="foot"><button onClick={() => setShowSource(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function MultiPanel({ features }: { features: Feature[] }) {
  const s = useStore();
  const results = useStore((st) => st.results);
  const vol = features.reduce((a, f) => a + (results.get(f.id)?.volume ?? 0), 0);
  return (
    <div className="props">
      <h3>{features.length} parts selected</h3>
      <div className="note">Total volume {formatNum(vol / 1000)} cm³ · ≈{formatNum((vol / 1000) * 1.24)} g PLA</div>
      <FilamentPicker ids={features.filter((f) => f.parentId === null).map((f) => f.id)} />
      <div className="actions">
        <button className="primary" onClick={s.combineSelected}>Combine</button>
        <button onClick={() => s.toggleRole()}>Toggle hole</button>
        <button onClick={s.duplicateSelected}>Duplicate</button>
        <button onClick={s.deleteSelected}>Delete</button>
      </div>
      <div className="note">Combine merges the solids and subtracts the holes into one editable part. The originals stay in the tree, so you can still change them later.</div>
    </div>
  );
}
