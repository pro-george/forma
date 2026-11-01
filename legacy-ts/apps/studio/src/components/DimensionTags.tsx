import { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { childrenOf, type EvaluatedFeature, type Feature } from '@forma/core';
import { useStore } from '../state/store';
import { formatNum } from './fields';

/**
 * Numbers you can tap: the key dimensions of the selected part float on
 * the model as small chips. Tap one, type, Enter. Positions are in the
 * feature's own frame (the parent group carries the transform).
 */
interface Tag { key: string; label: string; value: number; at: [number, number, number]; min?: number; apply: (v: number) => void }

export function DimensionTags({ feature, result }: { feature: Feature; result: EvaluatedFeature }) {
  const patch = useStore((s) => s.patchFeature);
  const doc = useStore((s) => s.doc);
  if (feature.type === 'combine') {
    // a combined part shows the chip of its latest extrusion (the face you just pulled or cut)
    const kids = childrenOf(doc, feature.id).filter((k) => k.type === 'extrude' && k.visible);
    const last = kids[kids.length - 1];
    if (!last || last.type !== 'extrude') return null;
    const t = last.transform;
    const d2r = Math.PI / 180;
    const top = last.flip ? -last.height : last.height;
    const tag: Tag = { key: last.id, label: last.role === 'hole' ? 'Depth' : 'H', value: last.height, at: [0, 0, top], min: 0.1, apply: (v) => patch(last.id, { height: v } as Partial<Feature>) };
    return (
      <group position={[t.position.x, t.position.y, t.position.z]} rotation={[t.rotation.x * d2r, t.rotation.y * d2r, t.rotation.z * d2r, 'ZYX']}>
        <TagChip tag={tag} />
      </group>
    );
  }
  const b = result.bbox;
  const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, top = b.max.z;
  const tags: Tag[] = [];
  const set = (key: string) => (v: number) => patch(feature.id, { [key]: v } as Partial<Feature>);
  switch (feature.type) {
    case 'box':
      tags.push(
        { key: 'width', label: 'W', value: feature.width, at: [cx, b.min.y, top], min: 0.1, apply: set('width') },
        { key: 'depth', label: 'D', value: feature.depth, at: [b.max.x, cy, top], min: 0.1, apply: set('depth') },
        { key: 'height', label: 'H', value: feature.height, at: [b.max.x, b.min.y, top / 2], min: 0.1, apply: set('height') },
      );
      break;
    case 'cylinder':
      tags.push(
        { key: 'radius', label: 'R', value: feature.radius, at: [feature.radius, 0, top], min: 0.1, apply: set('radius') },
        { key: 'height', label: 'H', value: feature.height, at: [feature.radius * 0.7, -feature.radius * 0.7, top / 2], min: 0.1, apply: set('height') },
      );
      break;
    case 'cone':
      tags.push(
        { key: 'radiusBottom', label: 'R', value: feature.radiusBottom, at: [feature.radiusBottom, 0, 0], min: 0.1, apply: set('radiusBottom') },
        { key: 'height', label: 'H', value: feature.height, at: [0, 0, top], min: 0.1, apply: set('height') },
      );
      break;
    case 'sphere':
      tags.push({ key: 'radius', label: 'R', value: feature.radius, at: [feature.radius, 0, feature.radius], min: 0.1, apply: set('radius') });
      break;
    case 'tube':
      tags.push(
        { key: 'radius', label: 'R', value: feature.radius, at: [feature.radius, 0, top], min: 0.1, apply: set('radius') },
        { key: 'innerRadius', label: 'r', value: feature.innerRadius, at: [feature.innerRadius, 0, top], min: 0.1, apply: set('innerRadius') },
        { key: 'height', label: 'H', value: feature.height, at: [feature.radius * 0.7, -feature.radius * 0.7, top / 2], min: 0.1, apply: set('height') },
      );
      break;
    case 'extrude':
      tags.push({ key: 'height', label: feature.role === 'hole' ? 'Depth' : 'H', value: feature.height, at: [cx, cy, feature.flip ? b.min.z : top], min: 0.1, apply: set('height') });
      break;
    case 'revolve':
      tags.push({ key: 'height', label: 'H', value: feature.height, at: [0, 0, top], min: 0.5, apply: set('height') });
      break;
    default:
      return null;
  }
  return <>{tags.map((t) => <TagChip key={t.key} tag={t} />)}</>;
}

function TagChip({ tag }: { tag: Tag }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(tag.value));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setText(String(Math.round(tag.value * 100) / 100)); }, [tag.value, editing]);
  useEffect(() => {
    if (!editing) return;
    // the chip lives in a drei <Html> portal that can re-layout right after mount: focus on the next frames
    const focus = () => { input.current?.focus(); input.current?.select(); };
    focus();
    const r1 = requestAnimationFrame(() => { focus(); requestAnimationFrame(focus); });
    return () => cancelAnimationFrame(r1);
  }, [editing]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v) && v !== tag.value && v >= (tag.min ?? -Infinity)) tag.apply(Math.round(v * 100) / 100);
    setEditing(false);
  };
  return (
    <Html position={tag.at} zIndexRange={[20, 10]} style={{ pointerEvents: 'auto', transform: 'translate(-50%, -50%)' }}>
      {editing ? (
        <input ref={input} className="dim-input" value={text} inputMode="decimal" autoFocus
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); e.stopPropagation(); }}
          onPointerDown={(e) => e.stopPropagation()} />
      ) : (
        <button className="dim-chip" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setEditing(true); }} title="Tap to type a value">
          <span>{tag.label}</span>{formatNum(tag.value)}<small>mm</small>
        </button>
      )}
    </Html>
  );
}
