import { useEffect, useMemo, useRef } from 'react';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { featureById, tessellate, sketchToProfiles, endpoints, sk, arcSweep, solveSketch, evalParams, constraintRefs, isDimension, type Vec2, type SketchEntity, type Transform, type Constraint } from '@forma/core';
import { useSketchMenu } from './ContextMenu';
import { useStore } from '../state/store';
import { useSketch, rectCorners, circleFrom, type SketchPick } from '../state/sketch';
import { useSel } from '../state/sel';
import { useUI } from '../state/ui';

interface Colors { accent: string; solid: string; hole: string; vp: string }

const d2r = Math.PI / 180;

/** World ↔ sketch-local for the feature frame (any orientation: the sketch plane is the feature's local XY). */
function frame(t: Transform) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(t.position.x, t.position.y, t.position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rotation.x * d2r, t.rotation.y * d2r, t.rotation.z * d2r, 'ZYX')),
    new THREE.Vector3(1, 1, 1),
  );
  const inv = m.clone().invert();
  const v = new THREE.Vector3();
  const toLocal = (wx: number, wy: number, wz = 0): Vec2 => { v.set(wx, wy, wz).applyMatrix4(inv); return [v.x, v.y]; };
  const toWorld = (p: Vec2, z = 0): [number, number, number] => { const w = new THREE.Vector3(p[0], p[1], z).applyMatrix4(m); return [w.x, w.y, w.z]; };
  const euler: [number, number, number, 'ZYX'] = [t.rotation.x * d2r, t.rotation.y * d2r, t.rotation.z * d2r, 'ZYX'];
  return { toLocal, toWorld, euler };
}

const GUIDE = '#8cdcff'; // Materializr's inference cyan (140, 220, 255)
const DRAG_PX = 12;

export function SketchLayer({ colors }: { colors: Colors }) {
  const active = useSketch((s) => s.active);
  const rectMode = useSketch((s) => s.rectMode);
  const circleMode = useSketch((s) => s.circleMode);
  const regions = useSel((s) => s.regions);
  const touch = useUI((u) => u.touch);
  const { camera, size } = useThree();
  const press = useRef<{ local: Vec2; x: number; y: number } | null>(null);
  const doc = useStore((s) => s.doc);
  const feature = active ? featureById(doc, active.featureId) : undefined;
  const sketch = feature && feature.type === 'extrude' ? feature.sketch ?? { entities: [] } : null;
  const t = feature?.transform;
  const fr = useMemo(() => (t ? frame(t) : null), [t]);

  const profiles = useMemo(() => (sketch ? sketchToProfiles(sketch) : null), [sketch]);
  const params = doc.params;
  // the solve for colouring: fully constrained entities, and the dof readout
  const solve = useMemo(() => (sketch ? solveSketch(sketch, { scope: evalParams(params ?? []).scope }) : null), [sketch, params]);
  const light = useUI((u) => u.light);
  const DONE = light ? '#111111' : '#f4f5f7';
  // one fill per closed region so hover / selection can light a single one
  const regionGeometries = useMemo(() => {
    if (!profiles) return [];
    return profiles.profiles.map((p) => {
      const sh = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)));
      sh.holes = p.holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return new THREE.ShapeGeometry(sh);
    });
  }, [profiles]);

  if (!active || !feature || !sketch || !fr || !t) return null;
  const lift = 0.15;
  const mods = (e: { shiftKey: boolean; altKey: boolean }) => ({ shift: e.shiftKey, alt: e.altKey });
  const localOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => fr.toLocal(e.point.x, e.point.y, e.point.z);
  /** screen pixels per sketch mm around a local point, so the state can scale its pixel tolerances */
  const reportScale = (local: Vec2) => {
    const a = new THREE.Vector3(...fr.toWorld(local)).project(camera), b = new THREE.Vector3(...fr.toWorld([local[0] + 1, local[1]])).project(camera);
    api.setScale(Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height) / 2);
  };
  const planePos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
  const sk3 = (pts: Vec2[], lz = lift) => pts.map((p) => fr.toWorld(p, lz));
  const openIds = new Set(profiles?.openIds ?? []);
  const api = useSketch.getState();

  // draft preview
  const preview: { pts: Vec2[]; closed?: boolean; label?: string; at?: Vec2 }[] = [];
  const cur = active.snap?.p ?? active.cursor;
  if (cur && active.draft.length) {
    const a = active.draft[active.draft.length - 1]!;
    const typed = parseFloat(active.typed);
    switch (active.tool) {
      case 'line': {
        let p = cur;
        if (Number.isFinite(typed) && typed > 0) { const L = Math.hypot(cur[0] - a[0], cur[1] - a[1]) || 1; p = [a[0] + ((cur[0] - a[0]) / L) * typed, a[1] + ((cur[1] - a[1]) / L) * typed]; }
        const len = Math.hypot(p[0] - a[0], p[1] - a[1]);
        const ang = (Math.atan2(p[1] - a[1], p[0] - a[0]) / d2r + 360) % 360;
        preview.push({ pts: [a, p], label: `${fmt(len)} mm · ${fmt(ang)}°`, at: p });
        if (active.draft.length > 1) preview.push({ pts: active.draft });
        break;
      }
      case 'rect': {
        const c = rectCorners(a, cur, rectMode, active.typedW, active.typed);
        if (c) {
          const [p0, p1] = c;
          const w = Math.abs(p1[0] - p0[0]), h = Math.abs(p1[1] - p0[1]);
          const lw = active.typedW !== null ? `${fmt(w)} ✓` : fmt(w), lh = active.typedW !== null && active.typed ? `${fmt(h)} ✓` : fmt(h);
          preview.push({ pts: [p0, [p1[0], p0[1]], p1, [p0[0], p1[1]]], closed: true, label: `${lw} × ${lh} mm${active.typedW === null ? (active.typed ? '' : ' · type width ⏎ height ⏎') : ''}`, at: cur });
        }
        break;
      }
      case 'circle': {
        const c = circleFrom(a, cur, circleMode, active.typed);
        if (c) { preview.push({ pts: tessellate(sk.circle(c.center, c.radius)), closed: true, label: `⌀ ${fmt(c.radius * 2)} mm · r ${fmt(c.radius)}`, at: cur }); if (circleMode === '2pt') preview.push({ pts: [a, cur] }); }
        break;
      }
      case 'arc': {
        if (active.draft.length === 1) preview.push({ pts: [a, cur], label: `chord ${fmt(Math.hypot(cur[0] - a[0], cur[1] - a[1]))} mm`, at: cur });
        else {
          const arc = sk.arc3(active.draft[0]!, cur, active.draft[1]!);
          preview.push({ pts: tessellate(arc), label: arc.type === 'arc' ? `r ${fmt(arc.radius)} · ${fmt(Math.abs(arcSweep(arc)))}°` : 'line', at: cur });
        }
        break;
      }
    }
  }

  const vertexHandles: { p: Vec2; pick: SketchPick }[] = [];
  if (active.tool === 'select' || active.tool === 'dim') for (const e of sketch.entities) {
    if (e.type === 'line') vertexHandles.push({ p: e.a, pick: { id: e.id, pt: 'a' } }, { p: e.b, pick: { id: e.id, pt: 'b' } });
    else { vertexHandles.push({ p: e.center, pick: { id: e.id, pt: 'c' } }); if (e.type === 'arc') { const ep = endpoints(e)!; vertexHandles.push({ p: ep[0], pick: { id: e.id, pt: 'a' } }, { p: ep[1], pick: { id: e.id, pt: 'b' } }); } }
  }
  const picked = (pk: SketchPick) => active.picks.some((x) => x.id === pk.id && (x.pt ?? null) === (pk.pt ?? null));
  const addKey = (ev: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => ev.ctrlKey || ev.metaKey || ev.shiftKey || useSel.getState().multi;
  /** Dimension tool: the first pick waits, the second (or a single line / curve) opens the editor */
  const dimPick = (pk: SketchPick, at: Vec2) => {
    const cur = active.picks;
    const e = sketch.entities.find((x) => x.id === pk.id);
    if (!e) return;
    if (!pk.pt && cur.length === 0) {
      // a lone line → length, a lone circle → diameter, an arc → radius
      api.pick(pk, false);
      api.move(at, { shift: false, alt: false });
      api.addConstraint(e.type === 'line' ? 'length' : e.type === 'circle' ? 'diameter' : 'radius');
      return;
    }
    api.pick(pk, true);
    const picks = useSketch.getState().active?.picks ?? [];
    const pts = picks.filter((x) => x.pt), ents = picks.filter((x) => !x.pt);
    api.move(at, { shift: false, alt: false });
    if (pts.length === 2) api.addConstraint('distance');
    else if (ents.length === 2 && ents.every((x) => sketch.entities.find((y) => y.id === x.id)?.type === 'line')) api.addConstraint('angle');
    else if (pts.length === 1 && ents.length === 1) api.addConstraint('distance');
  };
  const openMenu = (ev: { clientX: number; clientY: number }, pk: SketchPick) => { if (!picked(pk)) api.pick(pk, false); useSketchMenu.getState().show(ev.clientX, ev.clientY); };
  /** where a constraint's glyph sits: near the entity's middle, offset so several stack */
  const glyphAt = (c: Constraint, k: number): Vec2 | null => {
    const e = sketch.entities.find((x) => x.id === constraintRefs(c)[0]);
    if (!e) return null;
    const mid: Vec2 = e.type === 'line' ? [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2] : e.type === 'circle' ? [e.center[0], e.center[1] + e.radius] : (() => { const ep = endpoints(e)!; return [(ep[0][0] + ep[1][0]) / 2, (ep[0][1] + ep[1][1]) / 2] as Vec2; })();
    if ('p' in c && c.kind !== 'midpoint') { const p = pointOf(sketch.entities, c.p); if (p) return [p[0], p[1]]; }
    return [mid[0], mid[1] - k * 0]; // stacking is done in CSS by index
  };
  const GLYPH: Record<string, string> = { coincident: '•', pointOnCurve: '◇', horizontal: '─', vertical: '│', parallel: '∥', perpendicular: '⟂', tangent: '⌒', equal: '=', concentric: '◎', midpoint: '△', fix: '⊙' };
  const cons = sketch.constraints ?? [];
  const glyphIndex = new Map<string, number>();

  return (
    <group>
      {/* pointer plane at the sketch level */}
      <mesh
        position={planePos} rotation={fr.euler}
        onPointerMove={(e) => { e.stopPropagation(); const l = localOf(e); reportScale(l); if (active.dragVertex) api.dragVertexTo(l, mods(e)); else api.move(l, mods(e)); }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const l = localOf(e); reportScale(l);
          if (e.nativeEvent.pointerType === 'touch') api.move(l, mods(e)); // a tap has no hover before it: give the state a cursor
          // a vertex drag must not also pan the camera: OrbitControls listens on the same canvas, after r3f
          if (active.tool === 'select') { if (api.beginVertexDrag(l)) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); } return; }
          // touch: a press that turns into a drag draws the shape in one gesture (press = first point, release = second)
          if (e.nativeEvent.pointerType === 'touch' && !active.draft.length && ['line', 'rect', 'circle', 'polygon'].includes(active.tool)) { press.current = { local: l, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }; e.nativeEvent.stopImmediatePropagation(); }
        }}
        onPointerUp={(e) => {
          if (active.dragVertex) { e.stopPropagation(); api.endVertexDrag(); return; }
          const pr = press.current; press.current = null;
          if (pr && Math.hypot(e.nativeEvent.clientX - pr.x, e.nativeEvent.clientY - pr.y) > DRAG_PX) {
            e.stopPropagation();
            api.click(pr.local, mods(e)); api.click(localOf(e), mods(e));
          }
        }}
        onClick={(e) => { if (e.button !== 0 || (e.delta ?? 0) > 4) return; e.stopPropagation(); if (active.tool === 'dim') { if (!addKey(e.nativeEvent)) api.pick(null, false); return; } api.click(localOf(e), mods(e)); }}
        onDoubleClick={(e) => { e.stopPropagation(); api.doubleClick(); }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* closed regions: faint fill, brighter when hovered with Select, blue when selected (then the dock offers Push) */}
      {regionGeometries.map((g, i) => {
        const sel = regions.some((r) => r.sketchId === active.featureId && r.index === i);
        const hov = active.hoverRegion === i;
        return (
          <mesh key={i} geometry={g} position={fr.toWorld([0, 0], lift * 0.5)} rotation={fr.euler}>
            <meshBasicMaterial color={sel ? '#408cff' : hov ? GUIDE : colors.accent} transparent opacity={sel ? 0.4 : hov ? 0.25 : 0.12} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        );
      })}

      {/* entities */}
      {sketch.entities.map((e) => {
        const pts = tessellate(e);
        const isSel = active.selected === e.id || picked({ id: e.id });
        const isOpen = openIds.has(e.id);
        const done = solve?.fullyConstrained.has(e.id);
        const inCons = active.selectedConstraint ? constraintRefs(cons.find((c) => c.id === active.selectedConstraint) ?? { kind: 'fix', id: '', p: { id: '', pt: 'a' } }).includes(e.id) : false;
        return (
          <group key={e.id}>
            <Line points={sk3(e.type === 'circle' ? [...pts, pts[0]!] : pts)} color={isSel || inCons ? colors.accent : isOpen ? colors.hole : done ? DONE : '#9fb0c8'} lineWidth={isSel ? 2.5 : done ? 2 : 1.6} dashed={isOpen} dashSize={1.5} gapSize={1} />
            {/* fat invisible hit line for selection */}
            <Line points={sk3(e.type === 'circle' ? [...pts, pts[0]!] : pts, lift + 0.05)} color={colors.accent} lineWidth={12} transparent opacity={0}
              onClick={(ev: ThreeEvent<MouseEvent>) => {
                if (active.tool === 'select') { ev.stopPropagation(); api.pick({ id: e.id }, addKey(ev.nativeEvent)); }
                else if (active.tool === 'dim') { ev.stopPropagation(); dimPick({ id: e.id }, fr.toLocal(ev.point.x, ev.point.y, ev.point.z)); }
              }}
              onContextMenu={(ev: ThreeEvent<MouseEvent>) => { if (active.tool !== 'select') return; ev.stopPropagation(); ev.nativeEvent.preventDefault(); openMenu(ev.nativeEvent, { id: e.id }); }} />
          </group>
        );
      })}

      {/* vertex handles (Select: drag or pick; Dimension: pick) */}
      {vertexHandles.map((h, i) => {
        const hot = active.hoverVertex && dist(active.hoverVertex, h.p) < 0.01;
        const on = picked(h.pick);
        return (
          <mesh key={i} position={fr.toWorld(h.p, lift + 0.12)}
            onClick={(ev) => { if ((ev.delta ?? 0) > 4) return; ev.stopPropagation(); if (active.tool === 'dim') dimPick(h.pick, h.p); else api.pick(h.pick, addKey(ev.nativeEvent)); }}
            onContextMenu={(ev) => { if (active.tool !== 'select') return; ev.stopPropagation(); ev.nativeEvent.preventDefault(); openMenu(ev.nativeEvent, h.pick); }}>
            <circleGeometry args={[on ? 1.2 : hot ? 1 : 0.6, 20]} />
            <meshBasicMaterial color={on || hot ? colors.accent : '#9fb0c8'} depthTest={false} />
          </mesh>
        );
      })}

      {/* constraint glyphs and dimensions */}
      {cons.map((c) => {
        const at = glyphAt(c, 0);
        if (!at) return null;
        const key = `${at[0].toFixed(2)},${at[1].toFixed(2)}`;
        const k = glyphIndex.get(key) ?? 0; glyphIndex.set(key, k + 1);
        const sel = active.selectedConstraint === c.id;
        if (isDimension(c)) {
          const label = c.kind === 'angle' ? `${fmt(c.value)}°` : c.kind === 'diameter' ? `⌀${fmt(c.value)}` : c.kind === 'radius' ? `R${fmt(c.value)}` : fmt(c.value);
          const editing = active.dimEdit?.id === c.id;
          return (
            <Html key={c.id} position={fr.toWorld(at, 2)} style={{ transform: `translate(-50%, ${-18 - k * 18}px)` }} zIndexRange={[20, 10]}>
              {editing ? <DimInput /> : (
                <button className={`sk-dim${sel ? ' on' : ''}${c.expr ? ' expr' : ''}`} title={c.expr ? `${c.expr} = ${fmt(c.value)}` : 'Click to edit'} onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => { ev.stopPropagation(); api.editDimension(c.id, at); }}>{label}{c.expr && <small>{c.expr}</small>}</button>
              )}
            </Html>
          );
        }
        return (
          <Html key={c.id} position={fr.toWorld(at, 2)} style={{ transform: `translate(${8 + k * 16}px, 6px)` }} zIndexRange={[20, 10]}>
            <button className={`sk-cons${sel ? ' on' : ''}`} title={c.kind} onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => { ev.stopPropagation(); api.selectConstraint(sel ? null : c.id); }}>{GLYPH[c.kind] ?? '?'}</button>
          </Html>
        );
      })}
      {active.dimEdit && !active.dimEdit.id && (
        <Html position={fr.toWorld(active.dimEdit.at, 2)} style={{ transform: 'translate(-50%, -18px)' }} zIndexRange={[20, 10]}><DimInput /></Html>
      )}


      {/* draft */}
      {preview.map((pv, i) => (
        <group key={i}>
          <Line points={sk3(pv.closed ? [...pv.pts, pv.pts[0]!] : pv.pts, lift + 0.05)} color={colors.accent} lineWidth={1.6} />
          {pv.label && pv.at && (
            <Html position={fr.toWorld(pv.at, 2)} style={{ pointerEvents: 'none', transform: 'translate(12px, -14px)' }}>
              <div className="sketch-label">{pv.label}{active.typed ? ` · typed ${active.typed}` : ''}</div>
            </Html>
          )}
        </group>
      ))}
      {active.draft.map((p, i) => <Dot key={`d${i}`} p={fr.toWorld(p, lift + 0.1)} color={colors.accent} r={0.8} />)}

      {/* snap cursor + inference guides (cyan, with a glyph saying why) */}
      {active.snap && (
        <>
          <Dot p={fr.toWorld(active.snap.p, lift + 0.1)} color={active.snap.kind === 'point' ? GUIDE : active.snap.kind === 'axis' ? GUIDE : '#9fb0c8'} r={active.snap.kind === 'point' ? 1.1 : 0.7} ring />
          {active.snap.guides.map((g, i) => g.line && (
            <Line key={i} points={sk3(g.line, lift)} color={GUIDE} lineWidth={1} dashed dashSize={1.2} gapSize={0.8} transparent opacity={0.8} />
          ))}
          {active.snap.guides.some((g) => g.glyph) && (
            <Html position={fr.toWorld(active.snap.p, 2)} style={{ pointerEvents: 'none', transform: touch ? 'translate(-50%, -44px)' : 'translate(14px, 6px)' }}>
              <div className="sketch-guide">{active.snap.guides.filter((g) => g.glyph).map((g, i) => <span key={i} title={g.kind}>{g.glyph}{g.label ? ` ${g.label}` : ''}</span>)}</div>
            </Html>
          )}
        </>
      )}
    </group>
  );
}

function Dot({ p, color, r, ring }: { p: [number, number, number]; color: string; r: number; ring?: boolean }) {
  return (
    <mesh position={p}>
      {ring ? <ringGeometry args={[r * 0.7, r, 20]} /> : <circleGeometry args={[r, 20]} />}
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ''));
export type { SketchEntity };

/** Inline dimension editor: a number, an expression over parameters, or `name = expr`. Enter applies, Esc cancels. */
function DimInput() {
  const edit = useSketch((s) => s.active?.dimEdit);
  const api = useSketch.getState();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  if (!edit) return null;
  return (
    <form className="sk-dim-edit" onSubmit={(e) => { e.preventDefault(); api.commitDim(); }} onPointerDown={(e) => e.stopPropagation()}>
      <input ref={ref} value={edit.value} onChange={(e) => api.setDimValue(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') api.cancelDim(); }} placeholder="value, expr, name = expr" />
      <button type="submit" aria-label="Apply">✓</button>
    </form>
  );
}

function pointOf(entities: SketchEntity[], r: { id: string; pt: 'a' | 'b' | 'c' }): Vec2 | null {
  const e = entities.find((x) => x.id === r.id); if (!e) return null;
  if (e.type === 'line') return r.pt === 'b' ? e.b : e.a;
  if (e.type === 'circle' || r.pt === 'c') return e.center;
  const ep = endpoints(e)!; return r.pt === 'a' ? ep[0] : ep[1];
}
