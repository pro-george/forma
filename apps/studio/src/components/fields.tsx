import { useEffect, useState } from 'react';
import { useStore } from '../state/store';

/**
 * Numeric field with live (non-undoable) updates while typing or using the
 * arrow keys, and a single undo step per edit (gesture begins on focus).
 */
export function NumberField({ value, onChange, min, max, step = 1, unit, axis, id }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; axis?: string; id?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value)); }, [value, focused]);
  const commit = (raw: string) => {
    let v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    v = Math.round(v * 1000) / 1000;
    if (v !== value) onChange(v);
  };
  return (
    <div className={`numfield${axis ? ' with-axis' : ''}`}>
      {axis && <span className="axis">{axis}</span>}
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={text}
        min={min} max={max} step={step}
        onFocus={() => { setFocused(true); useStore.getState().beginGesture(); }}
        onBlur={() => { setFocused(false); commit(text); useStore.getState().endGesture(); setText(String(value)); }}
        onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(String(value)); (e.target as HTMLInputElement).blur(); } }}
        onWheel={(e) => (e.target as HTMLInputElement).blur()}
      />
      {unit && !axis && <span className="unit">{unit}</span>}
    </div>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function Slider({ label, value, min, max, step, unit, onChange, id }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; id?: string;
}) {
  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} type="range" min={min} max={max} step={step} value={value}
        onPointerDown={() => useStore.getState().beginGesture()}
        onPointerUp={() => useStore.getState().endGesture()}
        onKeyDown={() => useStore.getState().beginGesture()}
        onKeyUp={() => useStore.getState().endGesture()}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="v">{formatNum(value)}{unit ?? ''}</span>
    </div>
  );
}

export const formatNum = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, ''));

export function TextField({ value, onChange, id, placeholder }: { value: string; onChange: (v: string) => void; id?: string; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      id={id} type="text" value={text} placeholder={placeholder}
      onFocus={() => useStore.getState().beginGesture()}
      onBlur={() => { useStore.getState().endGesture(); }}
      onChange={(e) => { setText(e.target.value); onChange(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}
