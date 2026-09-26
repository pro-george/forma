import { useState } from 'react';
import { featureById, type Feature, type FeatureOf, type Modifiers } from '@forma/core';
import { useStore } from '../state/store';
import type { ModuleInfo } from '../state/worker-client';
import { Field, NumberField, Slider, TextField, formatNum } from './fields';
import { ProfileEditor } from './ProfileEditor';

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

const MOD_DEFS: { key: keyof Modifiers; label: string; min: number; max: number; step: number; unit: string }[] = [
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

  if (features.length === 0) return <div className="props"><h3>Parameters</h3><div className="empty">Select a part to edit it. Every value stays live: change a hole's radius inside a combined part and the boolean is recomputed by the geometry kernel.<br /><br />Shortcuts: <b>B</b> box · <b>C</b> cylinder · <b>S</b> sphere · <b>V</b> revolve · <b>K</b> sketch · <b>H</b> hole/solid · <b>W</b>/<b>E</b> move/rotate gizmo · <b>⌘G</b> combine · <b>⌘D</b> duplicate · <b>⌫</b> delete · <b>⌘Z</b> undo · <b>F</b> fit.</div></div>;
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
        </div>
      </Field>
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
      {feature.type === 'extrude' && <div className="note">{feature.profile.outer.length} outline points{feature.profile.holes.length ? `, ${feature.profile.holes.length} holes` : ''}. Height, top scale and twist are parametric.</div>}
      {feature.type === 'combine' && (
        <div className="note">{feature.childIds.length} children, {feature.childIds.filter((id) => featureById(doc, id)?.role === 'hole').length} of them holes. Solids are unioned, holes subtracted. Edit any child in the tree to change the result.</div>
      )}
      {feature.type === 'mesh' && <div className="note">{(feature.positions.length / 9).toLocaleString()} triangles, imported as a watertight mesh; booleans and modifiers work on it like any other part.</div>}
      <ModifiersPanel feature={feature} />
      <Placement feature={feature} />
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
  const setInput = (key: string, value: unknown, undoable = false) => patch(feature.id, { inputs: { ...feature.inputs, [key]: value } }, { undoable });
  if (!info) return <><h3>Module</h3><div className="note err">Unknown module "{feature.moduleId}". It may come from a plugin that is not loaded.</div><Actions feature={feature} /></>;
  return (
    <>
      <h3>Module · {info.name}</h3>
      <div className="note" style={{ marginTop: 0 }}>{info.description}</div>
      <CommonHeader feature={feature} />
      <h3>Inputs</h3>
      {info.inputs.map((inp) => {
        const v = feature.inputs[inp.key] ?? inp.default;
        const id = `mi-${inp.key}`;
        switch (inp.type) {
          case 'text': return <Field key={inp.key} label={inp.label} htmlFor={id}><TextField id={id} value={String(v)} placeholder={inp.placeholder} onChange={(t) => setInput(inp.key, t)} /></Field>;
          case 'number': return <Field key={inp.key} label={inp.label} htmlFor={id}><NumberField id={id} value={Number(v)} min={inp.min} max={inp.max} step={inp.step} unit={inp.unit} onChange={(n) => setInput(inp.key, n)} /></Field>;
          case 'select': return <Field key={inp.key} label={inp.label} htmlFor={id}><select id={id} value={String(v)} onChange={(e) => setInput(inp.key, e.target.value, true)}>{inp.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>;
          case 'toggle': return <Field key={inp.key} label={inp.label} htmlFor={id}><label className="check"><input id={id} type="checkbox" checked={Boolean(v)} onChange={(e) => setInput(inp.key, e.target.checked, true)} /></label></Field>;
          case 'color': return <Field key={inp.key} label={inp.label} htmlFor={id}><input id={id} type="color" value={String(v)} onChange={(e) => setInput(inp.key, e.target.value, true)} /></Field>;
        }
      })}
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
