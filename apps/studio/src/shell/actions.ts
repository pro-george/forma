/**
 * One dispatcher for every catalogue / menu / key action, so the dock, the
 * "+" FAB, the context menu and the keyboard all do exactly the same thing.
 */
import * as THREE from 'three';
import { featureById, updateFeature, defaultRepeat, planarFace } from '@forma/core';
import { useStore } from '../state/store';
import { useSketch } from '../state/sketch';
import { useSel } from '../state/sel';
import { useOp } from '../state/op';
import { useTool } from '../state/tool';
import { useViewStore } from '../state/view';
import { useUI } from '../state/ui';
import type { ActionId } from './catalogue';

export function dispatch(id: ActionId, arg?: string): void {
  const s = useStore.getState();
  const sk = useSketch.getState();
  const sel = useSel.getState();
  const op = useOp.getState();
  switch (id) {
    case 'sketch.xy': sk.createAndStartOn('xy'); return;
    case 'sketch.xz': sk.createAndStartOn('xz'); return;
    case 'sketch.yz': sk.createAndStartOn('yz'); return;
    case 'sketch.face': {
      const f = sel.faces[0];
      if (!f) { s.toast('Select a flat face first, then Sketch.'); return; }
      const hit = faceHit(f.partId, f.faceIndex);
      if (!hit) { s.toast("Can't sketch on a curved face — use Sketch on… XY / XZ / YZ instead."); return; }
      sk.startOnFace(f.partId, hit.point, hit.normal);
      return;
    }
    case 'sketch.edit': {
      const id = s.selection[0];
      const f = id ? featureById(s.doc, id) : undefined;
      if (f?.type === 'extrude' && f.sketch) sk.start(f.id);
      else if (f?.type === 'module') useUI.getState().openSheet('props');
      else s.toast('Select a sketch to edit it.');
      return;
    }
    case 'prim.box': case 'prim.cylinder': case 'prim.sphere': case 'prim.cone': case 'prim.torus': case 'prim.tube': case 'prim.revolve':
      s.addPrimitive(id.slice(5) as 'box'); return;
    case 'module': if (arg) s.addModule(arg); return;
    case 'pushpull': if (useSel.getState().regions.length) op.beginRegionPush(); else op.beginPushPull(); return;
    case 'fillet': op.beginEdgeOp('round'); return;
    case 'chamfer': op.beginEdgeOp('chamfer'); return;
    case 'move': useTool.getState().set('move'); return;
    case 'rotate': useTool.getState().set('rotate'); return;
    case 'mirror': {
      const id = s.selection[0]; if (!id) return;
      const f = featureById(s.doc, id); if (!f) return;
      const r = { ...defaultRepeat(), ...f.repeat };
      s.patchFeature(id, { repeat: r.mode === 'mirror' ? { ...r, mode: 'none' } : { ...r, mode: 'mirror', axis: 'x' } } as never);
      s.toast(r.mode === 'mirror' ? 'Mirror removed.' : 'Mirrored across the X plane — change the plane under Repeat.');
      return;
    }
    case 'split': useUI.getState().openSheet('props'); s.toast('Split: choose the axis and position under "Split in two", then press Split.'); return;
    case 'pattern.linear': case 'pattern.circular': {
      const id = s.selection[0]; if (!id) return;
      const f = featureById(s.doc, id); if (!f) return;
      const r = { ...defaultRepeat(), ...f.repeat };
      s.patchFeature(id, { repeat: { ...r, mode: id === 'pattern.linear' ? 'linear' : 'radial', count: Math.max(2, r.count) } } as never);
      useUI.getState().openSheet('props');
      return;
    }
    case 'hole': s.toggleRole(); return;
    case 'duplicate': s.duplicateSelected(); return;
    case 'delete': s.deleteSelected(); sel.clear(); return;
    case 'bool.union': s.combineSelected(); return;
    case 'bool.subtract': {
      const [keep, ...cutters] = s.selection;
      if (!keep || !cutters.length) return;
      let doc = s.doc;
      for (const c of cutters) doc = updateFeature(doc, c, (f) => ({ ...f, role: 'hole' }));
      s.setDoc(doc);
      s.combineSelected();
      return;
    }
    case 'bool.intersect': {
      const [keep, ...others] = s.selection;
      if (!keep || !others.length) return;
      let doc = s.doc;
      for (const c of others) doc = updateFeature(doc, c, (f) => ({ ...f, role: 'intersect' }));
      s.setDoc(doc);
      s.combineSelected();
      return;
    }
    case 'ungroup': s.ungroupSelected(); return;
    case 'measure': useUI.getState().openSheet('props'); return;
    case 'frame': useViewStore.getState().fit(); return;
    case 'sk.select': sk.setTool('select'); return;
    case 'sk.line': sk.setTool('line'); return;
    case 'sk.rect': sk.setTool('rect'); return;
    case 'sk.circle': sk.setTool('circle'); return;
    case 'sk.arc': sk.setTool('arc'); return;
    case 'sk.polygon': sk.setTool('polygon'); return;
    case 'sk.trim': sk.setTool('trim'); return;
    case 'sk.finish': sk.finish(); return;
    case 'sk.exit': sk.cancel(); return;
    case 'sk.lookat': sk.lookAt(); return;
  }
}

/** World point + normal of a flat face of a part (for sketch-on-face). */
export function faceHit(partId: string, faceIndex: number): { point: [number, number, number]; normal: [number, number, number] } | null {
  const st = useStore.getState();
  const res = st.results.get(partId);
  const part = featureById(st.doc, partId);
  if (!res || !part) return null;
  const pf = planarFace(res.mesh, faceIndex);
  if (!pf) return null;
  const r = THREE.MathUtils.degToRad;
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(part.transform.position.x, part.transform.position.y, part.transform.position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r(part.transform.rotation.x), r(part.transform.rotation.y), r(part.transform.rotation.z), 'ZYX')),
    new THREE.Vector3(1, 1, 1),
  );
  const n = new THREE.Vector3(...pf.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(mat)).normalize();
  const p = new THREE.Vector3(...pf.origin).applyMatrix4(mat);
  return { point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] };
}
