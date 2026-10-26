import * as THREE from 'three';
import type { Transform } from '@forma/core';

/** A feature transform whose local XY plane sits at `point` with local +Z along `normal` (world space). */
export function planeTransform(point: [number, number, number], normal: [number, number, number]): Transform {
  const n = new THREE.Vector3(...normal).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const r2d = 180 / Math.PI;
  const round = (v: number) => Math.round(v * r2d * 1000) / 1000;
  const round1 = (v: number) => Math.round(v * 1000) / 1000;
  return { position: { x: round1(point[0]), y: round1(point[1]), z: round1(point[2]) }, rotation: { x: round(e.x), y: round(e.y), z: round(e.z) } };
}
