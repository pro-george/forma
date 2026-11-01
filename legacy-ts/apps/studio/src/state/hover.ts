/**
 * What is under the pointer in the viewport. Faces are recovered lazily
 * (and cached per mesh) so hovering stays cheap; huge meshes skip face
 * recovery and only report the part.
 */
import { create } from 'zustand';
import { planarFace, type PlanarFace, type TriangleMesh } from '@forma/core';

export interface HoverFace { partId: string; faceIndex: number; face: PlanarFace | null }

export const useHover = create<{
  hover: HoverFace | null;
  set(h: HoverFace | null): void;
}>((set) => ({
  hover: null,
  set: (hover) => set((s) => (sameHover(s.hover, hover) ? s : { hover })),
}));

function sameHover(a: HoverFace | null, b: HoverFace | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.partId !== b.partId) return false;
  if (a.face && b.face) return a.face === b.face;
  return a.faceIndex === b.faceIndex;
}

const FACE_LIMIT = 400_000; // indices; above this hover shows no face

/** Face containing triangle `tri` of `mesh`, memoised per mesh. */
const cache = new WeakMap<TriangleMesh, Map<number, PlanarFace | null>>();
export function faceAt(mesh: TriangleMesh, tri: number): PlanarFace | null {
  if (mesh.indices.length > FACE_LIMIT) return null;
  let m = cache.get(mesh);
  if (!m) { m = new Map(); cache.set(mesh, m); }
  // triangles already known to belong to a recovered face resolve instantly
  const hit = m.get(tri);
  if (hit !== undefined) return hit;
  const face = planarFace(mesh, tri);
  if (face) for (const t of face.triangles) m.set(t, face);
  else m.set(tri, null);
  return face;
}
