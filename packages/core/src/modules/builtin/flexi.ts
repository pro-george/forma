import type { ModuleDefinition, FeatureSpec } from '../registry.js';

/**
 * Flexi chain toy: head + hinged body segments + tail, print-in-place.
 * Hinges are bar-and-ring joints; clearance is a parameter so it can be tuned
 * per printer. The chain runs along +Y with the head at -Y.
 *
 * Real Manifold booleans mean the whole creature comes out as ONE watertight
 * shell, so slicers see a clean model.
 */
export const flexiModule: ModuleDefinition = {
  id: 'flexi-chain',
  name: 'Flexi chain toy',
  category: 'Toys',
  version: '1.0.0',
  description: 'An articulated creature with print-in-place hinges. Print flat, no supports; the joints free up with a gentle wiggle.',
  inputs: [
    { key: 'creature', type: 'select', label: 'Creature', default: 'cat', options: [{ value: 'cat', label: 'Cat' }, { value: 'worm', label: 'Worm' }, { value: 'fish', label: 'Fish' }] },
    { key: 'segments', type: 'number', label: 'Body segments', default: 6, min: 2, max: 20, step: 1 },
    { key: 'segmentLength', type: 'number', label: 'Segment length', default: 12, min: 6, max: 30, step: 0.5, unit: 'mm' },
    { key: 'width', type: 'number', label: 'Body width', default: 18, min: 8, max: 60, step: 0.5, unit: 'mm' },
    { key: 'height', type: 'number', label: 'Body height', default: 9, min: 7, max: 30, step: 0.5, unit: 'mm' },
    { key: 'taper', type: 'number', label: 'Tail taper', default: 45, min: 0, max: 80, step: 5, unit: '%' },
    { key: 'clearance', type: 'number', label: 'Hinge clearance', default: 0.45, min: 0.2, max: 0.8, step: 0.05, unit: 'mm', help: '0.4–0.5 mm for a 0.4 nozzle' },
    { key: 'loop', type: 'toggle', label: 'Keychain loop', default: true },
    { key: 'eyes', type: 'toggle', label: 'Eyes', default: true },
  ],
  build(i, api) {
    const n = Number(i.segments), segLen = Number(i.segmentLength), width = Number(i.width), height = Number(i.height);
    const taper = Number(i.taper) / 100, clearance = Number(i.clearance), creature = String(i.creature);
    const barR = 1.5, wall = 1.6, ringR = barR + clearance + wall, gap = 2 * ringR + 1.2, ringLen = 3;
    const out: FeatureSpec[] = [];
    let y = 0;

    const body = (w: number, len: number, yc: number, name: string): FeatureSpec => ({
      type: 'extrude', name,
      profile: { outer: api.roundedRect(w, len, Math.min(w, len) * 0.28), holes: [] },
      height, scaleTop: 1, twist: 0, position: { y: yc },
    });

    // bar (attached to the segment before the gap) + two rings (attached to the segment after)
    const hinge = (yBack: number, wA: number, wB: number) => {
      const yc = yBack + gap / 2, zc = height / 2, barLen = Math.min(wA, wB) * 0.8;
      out.push({ type: 'cylinder', name: 'Hinge bar', radius: barR, height: barLen, segments: 32, position: { x: -barLen / 2, y: yc, z: zc }, rotation: { y: 90 } });
      out.push({ type: 'box', name: 'Bar neck', width: barLen * 0.3, depth: gap / 2 + barR, height: barR * 2, position: { y: yBack + (gap / 2 + barR) / 2 - barR, z: zc - barR } });
      for (const s of [-1, 1]) {
        const x = s * (barLen / 2 - ringLen / 2);
        out.push({ type: 'tube', name: 'Hinge ring', radius: ringR, innerRadius: barR + clearance, height: ringLen, segments: 48, position: { x: x - ringLen / 2, y: yc, z: zc }, rotation: { y: 90 } });
        out.push({ type: 'box', name: 'Ring neck', width: ringLen, depth: gap / 2, height: wall, position: { x, y: yc + gap / 4, z: zc + ringR - wall - 0.2 } });
      }
    };

    // head
    const headW = width * 1.35, headL = segLen * 1.4;
    out.push(body(headW, headL, y + headL / 2, 'Head'));
    if (creature === 'cat') {
      for (const s of [-1, 1]) out.push({ type: 'cone', name: 'Ear', radiusBottom: headW * 0.16, radiusTop: 0.6, height: headW * 0.28, segments: 32, position: { x: s * headW * 0.3, y: y + headL * 0.35, z: height - 1 } });
    }
    if (creature === 'fish') {
      out.push({ type: 'cone', name: 'Dorsal fin', radiusBottom: headL * 0.22, radiusTop: 0.8, height: height * 0.6, segments: 4, position: { y: y + headL * 0.6, z: height - 1 }, rotation: { z: 45 } });
    }
    if (i.eyes) {
      const r = Math.min(2.2, headW * 0.09);
      for (const s of [-1, 1]) out.push({ type: 'sphere', name: 'Eye', radius: r, segments: 24, position: { x: s * headW * 0.22, y: y + 1.2 - r, z: height * 0.55 - r } });
    }
    if (creature === 'cat') out.push({ type: 'sphere', name: 'Nose', radius: 1.1, segments: 16, position: { y: y + 0.6, z: height * 0.4 - 1.1 } });
    if (i.loop) out.push({ type: 'tube', name: 'Keychain loop', radius: 4, innerRadius: 2.2, height: 3, segments: 48, position: { x: -1.5, y: y + headL * 0.6, z: height + 2.6 }, rotation: { y: 90 } });

    let prevW = headW;
    y += headL;
    for (let k = 0; k < n; k++) {
      const t = (k + 1) / n;
      const w = width * (1 - t * taper);
      hinge(y, prevW, w);
      y += gap;
      out.push(body(w, segLen, y + segLen / 2, `Segment ${k + 1}`));
      prevW = w;
      y += segLen;
    }
    // tail
    hinge(y, prevW, prevW);
    y += gap;
    if (creature === 'fish') {
      out.push({ type: 'cone', name: 'Tail fin', radiusBottom: prevW * 0.7, radiusTop: prevW * 0.25, height: segLen * 1.2, segments: 4, position: { y, z: height / 2 }, rotation: { x: -90, y: 45 } });
    } else {
      out.push({ type: 'cone', name: 'Tail', radiusBottom: height / 2, radiusTop: 1, height: segLen * 1.6, segments: 32, position: { y, z: height / 2 }, rotation: { x: -90 } });
    }
    const total = y + segLen * 1.6;
    for (const o of out) o.position = { ...(o.position ?? {}), y: (o.position?.y ?? 0) - total / 2 };
    return out;
  },
};
