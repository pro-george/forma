import type { TriangleMesh } from '../document/types.js';

/** Binary STL from one or more meshes (already in world space, Z-up, mm). */
export function toBinarySTL(meshes: TriangleMesh[], header = 'Forma binary STL, units mm, Z up'): Uint8Array {
  let triCount = 0;
  for (const m of meshes) triCount += m.indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(new TextEncoder().encode(header).slice(0, 80));
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (const m of meshes) {
    const p = m.positions, idx = m.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i]! * 3, b = idx[i + 1]! * 3, c = idx[i + 2]! * 3;
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
      for (const k of [a, b, c]) { dv.setFloat32(o, p[k]!, true); dv.setFloat32(o + 4, p[k + 1]!, true); dv.setFloat32(o + 8, p[k + 2]!, true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return new Uint8Array(buf);
}
