/**
 * Forma document model.
 *
 * Conventions (match 3D printing and every slicer):
 *  - units are millimetres
 *  - Z is up, the build plate is the XY plane at Z = 0
 *  - every feature is authored with its base on Z = 0 and its footprint
 *    centred on the origin; the transform then places it in the scene
 *  - rotations are Euler XYZ in degrees
 *
 * The document is plain JSON validated by zod, so it can be saved as a
 * `.forma` file, diffed, and evaluated in a worker without any class instances.
 */
import { z } from 'zod';
import { SketchSchema } from '../sketch/sketch.js';

export const Vec2Schema = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2Schema>;

export const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export type Vec3 = z.infer<typeof Vec3Schema>;

export const TransformSchema = z.object({
  position: Vec3Schema,
  /** Euler XYZ, degrees */
  rotation: Vec3Schema,
});
export type Transform = z.infer<typeof TransformSchema>;

export const identityTransform = (): Transform => ({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
});

/** A closed 2D outline with optional holes, in the XY plane (mm). */
export const ProfileSchema = z.object({
  outer: z.array(Vec2Schema).min(3),
  holes: z.array(z.array(Vec2Schema).min(3)).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * Image-driven relief: a height map (see raster/heightmap.ts) wrapped around
 * the part and pushed outward along the radius. Zero depth or an empty map
 * disables it.
 */
export const ReliefSchema = z.object({
  /** encoded height map (`hm1:w:h:base64`), '' = none */
  map: z.string().default(''),
  /** mm at full white; negative carves inward */
  depth: z.number().default(0),
  /** tiles around the perimeter */
  repeat: z.number().int().min(1).max(64).default(1),
  /** tiles over the covered height */
  rows: z.number().int().min(1).max(32).default(1),
  /** covered height band as fractions of the part height, bottom → top */
  from: z.number().min(0).max(1).default(0),
  to: z.number().min(0).max(1).default(1),
  /** blur radius in map pixels, rounds the edges of flat shapes */
  soften: z.number().min(0).max(32).default(0),
  /** swap raised and flat */
  invert: z.boolean().default(false),
  /** rotate the pattern around the part, degrees */
  phase: z.number().default(0),
  /** true: the map is tiled `repeat` × `rows` over the band; false: one copy, `width` of the circumference wide, centred at `phase` */
  tile: z.boolean().default(true),
  /** single-picture width as a fraction of the circumference (tile = false) */
  width: z.number().min(0.02).max(1).default(0.4),
});
export type Relief = z.infer<typeof ReliefSchema>;
export const defaultRelief = (): Relief => ReliefSchema.parse({});

/** Non-destructive surface modifiers, applied after the base shape is built. */
export const ModifiersSchema = z.object({
  relief: ReliefSchema.default({}),
  /** extra relief layers (front picture, back picture, text…), summed with `relief` */
  reliefs: z.array(ReliefSchema).default([]),
  /** total rotation around Z over the part height, degrees */
  twist: z.number().default(0),
  /** radial scale change from bottom (0 %) to top, percent; -50 halves the top */
  taper: z.number().default(0),
  /** vertical sine wave on the radius, mm amplitude */
  rippleAmplitude: z.number().default(0),
  rippleWaves: z.number().default(6),
  /** grooves around the perimeter, mm amplitude */
  grooveAmplitude: z.number().default(0),
  grooveCount: z.number().default(12),
  /** vertical period in mm that turns each groove ridge into a stack of beads; 0 = straight ribs */
  grooveWaveLength: z.number().min(0).default(0),
  /** shift the beads by half a period on every other rib (woven look) */
  grooveStagger: z.boolean().default(false),
  /** random surface noise, mm amplitude ("fuzzy skin" look) */
  fuzz: z.number().min(0).default(0),
  /** size of the noise cells, mm */
  fuzzScale: z.number().min(0.2).default(1.5),
  /** mesh refinement before warping: 1 = default edge length, 2 = twice as coarse (faster previews) */
  coarseness: z.number().min(0.25).max(4).default(1),
});
export type Modifiers = z.infer<typeof ModifiersSchema>;
export const defaultModifiers = (): Modifiers => ModifiersSchema.parse({});

export const RoleSchema = z.enum(['solid', 'hole']);
export type Role = z.infer<typeof RoleSchema>;

const base = {
  id: z.string(),
  name: z.string(),
  role: RoleSchema.default('solid'),
  visible: z.boolean().default(true),
  transform: TransformSchema.default(identityTransform()),
  /** id of the combine that owns this feature, if any */
  parentId: z.string().nullable().default(null),
  modifiers: ModifiersSchema.default(defaultModifiers()),
};

export const BoxFeature = z.object({ ...base, type: z.literal('box'), width: z.number().positive(), depth: z.number().positive(), height: z.number().positive() });
export const CylinderFeature = z.object({ ...base, type: z.literal('cylinder'), radius: z.number().positive(), height: z.number().positive(), segments: z.number().int().min(3).default(64) });
export const ConeFeature = z.object({ ...base, type: z.literal('cone'), radiusBottom: z.number().positive(), radiusTop: z.number().min(0), height: z.number().positive(), segments: z.number().int().min(3).default(64) });
export const SphereFeature = z.object({ ...base, type: z.literal('sphere'), radius: z.number().positive(), segments: z.number().int().min(4).default(48) });
export const TorusFeature = z.object({ ...base, type: z.literal('torus'), ringRadius: z.number().positive(), tubeRadius: z.number().positive(), segments: z.number().int().min(6).default(64) });
export const TubeFeature = z.object({ ...base, type: z.literal('tube'), radius: z.number().positive(), innerRadius: z.number().positive(), height: z.number().positive(), segments: z.number().int().min(3).default(64) });
export const ExtrudeFeature = z.object({
  ...base,
  type: z.literal('extrude'),
  /** fixed outline (modules, imports). Ignored when `sketch` is present. */
  profile: ProfileSchema.optional(),
  /** editable 2D sketch; closed loops become the outline(s), nested loops become holes */
  sketch: z.lazy(() => SketchSchema).optional(),
  height: z.number().positive(),
  /** scale of the top face relative to the bottom, 1 = straight walls */
  scaleTop: z.number().min(0).default(1),
  /** rotation of the top face relative to the bottom, degrees */
  twist: z.number().default(0),
});
export const RevolveFeature = z.object({
  ...base,
  type: z.literal('revolve'),
  /** side profile as [radius, heightFraction 0..1] pairs from bottom to top */
  profile: z.array(Vec2Schema).min(2),
  height: z.number().positive(),
  /** 0 = solid; > 0 = hollow vessel with this wall thickness */
  wall: z.number().min(0).default(0),
  floor: z.number().min(0).default(2),
  /** rounds of Chaikin smoothing applied to the profile */
  smoothing: z.number().int().min(0).max(5).default(2),
  segments: z.number().int().min(8).default(96),
  /** with a wall: leave both ends open (a sleeve, e.g. a lampshade) instead of a cup with a floor */
  open: z.boolean().default(false),
});
export const MeshFeature = z.object({
  ...base,
  type: z.literal('mesh'),
  /** flat xyz triangle soup, 9 numbers per triangle, authored base on Z=0 */
  positions: z.array(z.number()),
  scale: z.number().positive().default(1),
});
export const CombineFeature = z.object({
  ...base,
  type: z.literal('combine'),
  /** solids are unioned, holes subtracted, in tree order */
  childIds: z.array(z.string()),
});
export const ModuleFeature = z.object({
  ...base,
  type: z.literal('module'),
  moduleId: z.string(),
  inputs: z.record(z.unknown()),
});

export const FeatureSchema = z.discriminatedUnion('type', [
  BoxFeature, CylinderFeature, ConeFeature, SphereFeature, TorusFeature, TubeFeature,
  ExtrudeFeature, RevolveFeature, MeshFeature, CombineFeature, ModuleFeature,
]);
export type Feature = z.infer<typeof FeatureSchema>;
export type FeatureInput = z.input<typeof FeatureSchema>;
export type FeatureType = Feature['type'];
export type FeatureOf<T extends FeatureType> = Extract<Feature, { type: T }>;
export type FeatureInputOf<T extends FeatureType> = Extract<FeatureInput, { type: T }>;

export const DOCUMENT_VERSION = 1;

export const DocumentSchema = z.object({
  version: z.literal(DOCUMENT_VERSION),
  name: z.string().default('Untitled'),
  units: z.literal('mm').default('mm'),
  features: z.array(FeatureSchema),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type FormaDocument = z.infer<typeof DocumentSchema>;

/** Mesh data handed to renderers and exporters: non-indexed triangles, Z-up, mm. */
export interface TriangleMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface EvaluatedFeature {
  id: string;
  mesh: TriangleMesh;
  /** volume in mm³ (0 for holes shown as ghosts) */
  volume: number;
  bbox: { min: Vec3; max: Vec3 };
  role: Role;
  /** wall-clock ms spent evaluating (for the status bar) */
  ms: number;
  error?: string;
  /** printability or usage warnings (from a module's check()) */
  warnings?: string[];
}
