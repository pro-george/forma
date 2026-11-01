import { useEffect } from 'react';
import { useMenu } from '../state/menu';
import { useStore } from '../state/store';
import { useSketch } from '../state/sketch';
import { usePushPull } from '../state/pushpull';
import { Icon } from './icons';

/**
 * Pie of pills around the point you pressed. On the ground: add a part
 * there or start a sketch. On a face: the same, placed on the face, plus
 * sketch-on-face and push/pull.
 */
export function RadialMenu() {
  const open = useMenu((m) => m.open);
  const close = useMenu((m) => m.close);
  const s = useStore();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.radial')) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); };
  }, [open, close]);
  if (!open) return null;
  const { hit } = open;
  const onFace = !!hit.partId;
  const place = (type: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'tube') => { s.addPrimitive(type, { point: hit.point, normal: hit.normal }); close(); };
  const items: { label: string; icon?: keyof typeof Icon; run: () => void; primary?: boolean }[] = [
    { label: 'Box', icon: 'box', run: () => place('box') },
    { label: 'Cylinder', icon: 'cylinder', run: () => place('cylinder') },
    { label: 'Sphere', icon: 'sphere', run: () => place('sphere') },
    { label: 'Tube', icon: 'tube', run: () => place('tube') },
    onFace
      ? { label: 'Sketch on face', icon: 'extrude', primary: true, run: () => { useSketch.getState().startOnFace(hit.partId!, hit.point, hit.normal); close(); } }
      : { label: 'Sketch here', icon: 'extrude', primary: true, run: () => { useSketch.getState().createAndStartAt(hit.point); close(); } },
  ];
  if (onFace) items.push({ label: 'Push / pull', run: () => { usePushPull.getState().arm(); close(); } });
  // keep the pie on screen
  const R = 78;
  const x = Math.min(window.innerWidth - R - 70, Math.max(R + 70, open.x));
  const y = Math.min(window.innerHeight - R - 30, Math.max(R + 30, open.y));
  return (
    <div className="radial" style={{ left: x, top: y }} role="menu">
      <div className="radial-dot" />
      {items.map((it, i) => {
        const a = (-90 + (i / items.length) * 360) * (Math.PI / 180);
        const I = it.icon ? Icon[it.icon] : null;
        return (
          <button key={it.label} className={`radial-item${it.primary ? ' primary' : ''}`} style={{ transform: `translate(calc(-50% + ${Math.cos(a) * R}px), calc(-50% + ${Math.sin(a) * R}px))` }} onClick={it.run}>
            {I && <I />}{it.label}
          </button>
        );
      })}
    </div>
  );
}
