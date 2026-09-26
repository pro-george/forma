/**
 * Pure, immutable operations on a FormaDocument.
 * Every function returns a new document; the input is never mutated.
 * This keeps undo/redo trivial (snapshots) and makes the worker boundary safe.
 */
import {
  DocumentSchema, FeatureSchema, DOCUMENT_VERSION, defaultModifiers, identityTransform,
  type Feature, type FeatureOf, type FeatureInputOf, type FeatureType, type FormaDocument, type Transform,
} from './types.js';

let counter = 0;
/** Short unique id, stable enough for a document; not a security token. */
export function newId(prefix = 'f'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createDocument(name = 'Untitled'): FormaDocument {
  const now = new Date().toISOString();
  return { version: DOCUMENT_VERSION, name, units: 'mm', features: [], createdAt: now, updatedAt: now };
}

/** Parse + validate JSON (from a .forma file or storage). Throws ZodError on bad input. */
export function parseDocument(json: unknown): FormaDocument {
  return DocumentSchema.parse(json);
}

export function serializeDocument(doc: FormaDocument): string {
  return JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }, null, 2);
}

export const featureById = (doc: FormaDocument, id: string): Feature | undefined =>
  doc.features.find((f) => f.id === id);

export const topLevel = (doc: FormaDocument): Feature[] => doc.features.filter((f) => f.parentId === null);

export const childrenOf = (doc: FormaDocument, id: string): Feature[] => {
  const f = featureById(doc, id);
  if (!f || f.type !== 'combine') return [];
  return f.childIds.map((cid) => featureById(doc, cid)).filter((x): x is Feature => !!x);
};

/** Root ancestor (the top-level feature that contains this one). */
export function rootOf(doc: FormaDocument, id: string): Feature | undefined {
  let f = featureById(doc, id);
  while (f && f.parentId) f = featureById(doc, f.parentId);
  return f;
}

type Defaults<T extends FeatureType> = Omit<FeatureInputOf<T>, 'id' | 'type' | 'parentId' | 'name'> & { name?: string };

const LABELS: Record<FeatureType, string> = {
  box: 'Box', cylinder: 'Cylinder', cone: 'Cone', sphere: 'Sphere', torus: 'Torus', tube: 'Tube',
  extrude: 'Extrusion', revolve: 'Revolve', mesh: 'Mesh', combine: 'Combine', module: 'Module',
};

function nextName(doc: FormaDocument, type: FeatureType): string {
  const label = LABELS[type];
  const n = doc.features.filter((f) => f.type === type).length + 1;
  return `${label} ${n}`;
}

/** Build a fully-defaulted, validated feature of the given type. */
export function makeFeature<T extends FeatureType>(doc: FormaDocument, type: T, props: Defaults<T>): FeatureOf<T> {
  const raw = {
    id: newId(),
    name: nextName(doc, type),
    role: 'solid',
    visible: true,
    transform: identityTransform(),
    parentId: null,
    modifiers: defaultModifiers(),
    ...props,
    type,
  };
  return FeatureSchema.parse(raw) as FeatureOf<T>;
}

export function addFeature(doc: FormaDocument, feature: Feature): FormaDocument {
  return { ...doc, features: [...doc.features, feature] };
}

export function updateFeature<T extends Feature>(doc: FormaDocument, id: string, patch: Partial<T> | ((f: T) => T)): FormaDocument {
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== id) return f;
      return typeof patch === 'function' ? patch(f as T) : ({ ...f, ...patch } as Feature);
    }),
  };
}

export function setTransform(doc: FormaDocument, id: string, transform: Partial<Transform>): FormaDocument {
  return updateFeature(doc, id, (f) => ({ ...f, transform: { ...f.transform, ...transform } }));
}

/** Remove features and everything nested under them; combines left empty are removed too. */
export function removeFeatures(doc: FormaDocument, ids: string[]): FormaDocument {
  const gone = new Set<string>();
  const visit = (id: string) => {
    if (gone.has(id)) return;
    gone.add(id);
    childrenOf(doc, id).forEach((c) => visit(c.id));
  };
  ids.forEach(visit);
  let features = doc.features
    .filter((f) => !gone.has(f.id))
    .map((f) => (f.type === 'combine' ? { ...f, childIds: f.childIds.filter((c) => !gone.has(c)) } : f));
  features = features.filter((f) => !(f.type === 'combine' && f.childIds.length === 0));
  return { ...doc, features };
}

/** Group top-level features into a new combine. Children keep their world transforms. */
export function combine(doc: FormaDocument, ids: string[], name?: string): { doc: FormaDocument; combineId: string } {
  const kids = ids.map((id) => featureById(doc, id)).filter((f): f is Feature => !!f && f.parentId === null);
  if (kids.length === 0) throw new Error('Nothing to combine');
  const c = makeFeature(doc, 'combine', { childIds: kids.map((k) => k.id), ...(name ? { name } : {}) });
  const features = doc.features.map((f) => (kids.includes(f) ? { ...f, parentId: c.id } : f));
  return { doc: { ...doc, features: [...features, c] }, combineId: c.id };
}

/** Dissolve a combine: children go back to the top level, offset by the combine's position. */
export function ungroup(doc: FormaDocument, combineId: string): FormaDocument {
  const c = featureById(doc, combineId);
  if (!c || c.type !== 'combine') return doc;
  const p = c.transform.position;
  const features = doc.features
    .filter((f) => f.id !== combineId)
    .map((f) => {
      if (f.parentId !== combineId) return f;
      return {
        ...f,
        parentId: c.parentId,
        transform: { ...f.transform, position: { x: f.transform.position.x + p.x, y: f.transform.position.y + p.y, z: f.transform.position.z + p.z } },
      };
    });
  // if the combine itself was nested, its parent must now reference the children
  const parent = c.parentId ? featureById(doc, c.parentId) : undefined;
  if (parent && parent.type === 'combine') {
    return {
      ...doc,
      features: features.map((f) =>
        f.id === parent.id && f.type === 'combine'
          ? { ...f, childIds: f.childIds.flatMap((id) => (id === combineId ? c.childIds : [id])) }
          : f,
      ),
    };
  }
  return { ...doc, features };
}

/** Deep-duplicate top-level features (and their subtrees) with new ids, shifted by `offset`. */
export function duplicate(doc: FormaDocument, ids: string[], offset = { x: 20, y: 0, z: 0 }): { doc: FormaDocument; newIds: string[] } {
  const newIds: string[] = [];
  let out = doc;
  const clone = (f: Feature, parentId: string | null, shift: boolean): Feature => {
    const id = newId();
    const t = shift
      ? { ...f.transform, position: { x: f.transform.position.x + offset.x, y: f.transform.position.y + offset.y, z: f.transform.position.z + offset.z } }
      : f.transform;
    let copy: Feature = { ...structuredClone(f), id, parentId, transform: t, name: `${f.name} copy` };
    if (copy.type === 'combine') {
      const kids = childrenOf(doc, f.id).map((k) => clone(k, id, shift));
      copy = { ...copy, childIds: kids.map((k) => k.id) };
    }
    out = { ...out, features: [...out.features, copy] };
    return copy;
  };
  for (const id of ids) {
    const f = featureById(doc, id);
    if (!f || f.parentId !== null) continue;
    newIds.push(clone(f, null, true).id);
  }
  return { doc: out, newIds };
}

/** Move a feature in the top-level ordering (affects tree order and boolean order inside combines). */
export function reorder(doc: FormaDocument, id: string, direction: -1 | 1): FormaDocument {
  const idx = doc.features.findIndex((f) => f.id === id);
  const j = idx + direction;
  if (idx < 0 || j < 0 || j >= doc.features.length) return doc;
  const features = [...doc.features];
  const [f] = features.splice(idx, 1);
  features.splice(j, 0, f as Feature);
  return { ...doc, features };
}
