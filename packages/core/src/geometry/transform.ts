/** Minimal transform math: compose two (position, Euler XYZ degrees) transforms. */
import type { Transform, Vec3 } from '../document/types.js';

type M3 = [number, number, number, number, number, number, number, number, number];
const d2r = Math.PI / 180, r2d = 180 / Math.PI;

function eulerToMatrix(r: Vec3): M3 {
  const a = r.x * d2r, b = r.y * d2r, c = r.z * d2r;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // R = Rz * Ry * Rx (intrinsic XYZ == extrinsic ZYX), matching three.js 'XYZ' and Manifold.rotate
  return [
    cb * cc, sa * sb * cc - ca * sc, ca * sb * cc + sa * sc,
    cb * sc, sa * sb * sc + ca * cc, ca * sb * sc - sa * cc,
    -sb, sa * cb, ca * cb,
  ];
}

function matrixToEuler(m: M3): Vec3 {
  const sy = -m[6];
  const y = Math.asin(Math.max(-1, Math.min(1, sy)));
  let x: number, z: number;
  if (Math.abs(sy) < 0.999999) { x = Math.atan2(m[7], m[8]); z = Math.atan2(m[3], m[0]); }
  else { x = Math.atan2(-m[5], m[4]); z = 0; }
  return { x: round(x * r2d), y: round(y * r2d), z: round(z * r2d) };
}

const mul = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return o;
};
const apply = (m: M3, v: Vec3): Vec3 => ({ x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z });
const round = (v: number) => Math.round(v * 1000) / 1000;

/** parent ∘ child: the child's transform expressed in the parent's frame, returned in world frame. */
export function composeTransforms(parent: Transform, child: Transform): Transform {
  const Rp = eulerToMatrix(parent.rotation), Rc = eulerToMatrix(child.rotation);
  const p = apply(Rp, child.position);
  return {
    position: { x: round(parent.position.x + p.x), y: round(parent.position.y + p.y), z: round(parent.position.z + p.z) },
    rotation: matrixToEuler(mul(Rp, Rc)),
  };
}

export { eulerToMatrix };
