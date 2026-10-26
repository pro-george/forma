import type { TriangleMesh } from '../document/types.js';

/**
 * Wavefront OBJ (ASCII): one `o` group per object, shared vertex numbering,
 * normals omitted (slicers and modellers recompute them). Units mm, Z up.
 */
export function toOBJ(objects: { name: string; mesh: TriangleMesh }[], docName = 'forma'): Uint8Array {
  const lines: string[] = [`# ${docName} — Forma OBJ export, units mm, Z up`];
  let base = 1;
  for (const { name, mesh } of objects) {
    lines.push(`o ${name.replace(/\s+/g, '_')}`);
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) lines.push(`v ${fmt(p[i]!)} ${fmt(p[i + 1]!)} ${fmt(p[i + 2]!)}`);
    const idx = mesh.indices;
    for (let i = 0; i < idx.length; i += 3) lines.push(`f ${idx[i]! + base} ${idx[i + 1]! + base} ${idx[i + 2]! + base}`);
    base += p.length / 3;
  }
  return new TextEncoder().encode(lines.join('\n') + '\n');
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, ''));
