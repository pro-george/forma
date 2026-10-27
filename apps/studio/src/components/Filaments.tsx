import { useState } from 'react';
import { DEFAULT_FILAMENTS, type Filament } from '@forma/core';
import { useStore } from '../state/store';
import { Icon } from './icons';

const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'Support'];
const SUGGESTED = ['#d9d6cf', '#ff3c00', '#1f2329', '#f2c94c', '#2d9cdb', '#27ae60', '#9b51e0', '#ffffff', '#8d6e63', '#ff80ab', '#00bcd4', '#607d8b'];

/**
 * Filament slots = the trays of the printer's AMS. Each part picks one, the
 * 3MF export writes the slot number per part, and Bambu Studio puts it in
 * that tray. Colours here are for the preview; the real colour is whatever
 * is loaded in the tray.
 */
export function FilamentPicker({ ids }: { ids: string[] }) {
  const doc = useStore((s) => s.doc);
  const setDoc = useStore((s) => s.setDoc);
  const patch = useStore((s) => s.patchFeature);
  const current = new Set(ids.map((id) => doc.features.find((f) => f.id === id)?.filament ?? 1));
  const setAll = (slot: number) => {
    let d = doc;
    for (const id of ids) d = { ...d, features: d.features.map((f) => (f.id === id ? { ...f, filament: slot } : f)) };
    setDoc(d);
  };
  return (
    <div className="field-block">
      <label>Filament <span className="help-inline">AMS slot</span></label>
      <div className="slots">
        {doc.filaments.map((fl, i) => (
          <button key={i} className={`slot${current.has(i + 1) ? ' on' : ''}`} style={{ '--c': fl.color } as React.CSSProperties} title={`Slot ${i + 1} · ${fl.name || fl.type}`} onClick={() => (ids.length === 1 ? patch(ids[0]!, { filament: i + 1 }) : setAll(i + 1))}>
            <i /><span>{i + 1}</span>
          </button>
        ))}
        {doc.filaments.length < 16 && <button className="slot add" title="Add a filament slot" onClick={() => { setDoc({ ...doc, filaments: [...doc.filaments, { ...(DEFAULT_FILAMENTS[doc.filaments.length] ?? { color: SUGGESTED[doc.filaments.length % SUGGESTED.length]!, type: 'PLA', name: '' }) }] }); setAll(doc.filaments.length + 1); }}><Icon.plus /></button>}
      </div>
    </div>
  );
}

/** The palette editor, shown in the Scene panel: colour, material and name per slot. */
export function FilamentPalette() {
  const doc = useStore((s) => s.doc);
  const setDoc = useStore((s) => s.setDoc);
  const [open, setOpen] = useState<number | null>(null);
  const update = (i: number, p: Partial<Filament>, undoable = true) => setDoc({ ...doc, filaments: doc.filaments.map((f, k) => (k === i ? { ...f, ...p } : f)) }, { undoable });
  const remove = (i: number) => {
    if (doc.filaments.length <= 1) return;
    const filaments = doc.filaments.filter((_, k) => k !== i);
    const features = doc.features.map((f) => (f.filament - 1 === i ? { ...f, filament: 1 } : f.filament - 1 > i ? { ...f, filament: f.filament - 1 } : f));
    setDoc({ ...doc, filaments, features });
    setOpen(null);
  };
  const used = (i: number) => doc.features.filter((f) => f.parentId === null && f.filament === i + 1).length;
  return (
    <div className="palette">
      <h3>Filaments <span className="help-inline">what is loaded in the AMS</span></h3>
      {doc.filaments.map((fl, i) => (
        <div key={i} className={`pal-row${open === i ? ' open' : ''}`}>
          <button className="pal-main" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <i className="pal-dot" style={{ background: fl.color }} />
            <span className="pal-n">{i + 1}</span>
            <span className="pal-name">{fl.name || fl.type}</span>
            <small>{used(i) ? `${used(i)} part${used(i) > 1 ? 's' : ''}` : 'unused'}</small>
          </button>
          {open === i && (
            <div className="pal-edit">
              <div className="swatches">
                {SUGGESTED.map((c) => <button key={c} className={`sw${fl.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => update(i, { color: c })} title={c} />)}
                <label className="sw custom" title="Any colour" style={{ background: fl.color }}><input type="color" value={fl.color} onChange={(e) => update(i, { color: e.target.value }, false)} onBlur={(e) => update(i, { color: e.target.value })} /></label>
              </div>
              <div className="pal-fields">
                <select value={fl.type} onChange={(e) => update(i, { type: e.target.value })} aria-label="Material">{MATERIALS.map((m) => <option key={m}>{m}</option>)}</select>
                <input type="text" value={fl.name} placeholder="Name (optional)" onChange={(e) => update(i, { name: e.target.value }, false)} onBlur={(e) => update(i, { name: e.target.value })} aria-label="Filament name" />
                <button className="ghost" disabled={doc.filaments.length <= 1} onClick={() => remove(i)} title="Remove slot (its parts move to slot 1)"><Icon.trash /></button>
              </div>
            </div>
          )}
        </div>
      ))}
      {doc.filaments.length < 16 && <button className="pal-add" onClick={() => setDoc({ ...doc, filaments: [...doc.filaments, { color: SUGGESTED[doc.filaments.length % SUGGESTED.length]!, type: 'PLA', name: '' }] })}><Icon.plus /> Add slot</button>}
      <div className="note">Export → <b>3MF for Bambu Studio</b> writes the slot of every part, so the print lands in the right trays without any clicking in the slicer.</div>
    </div>
  );
}
