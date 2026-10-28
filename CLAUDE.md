# Forma — working notes for agents and humans

- pnpm monorepo. `packages/core` has no DOM dependency and must stay that way (it runs in Node tests and in a Web Worker). Anything that needs a canvas goes through an injected provider (`TextRasterizer`).
- Units: mm. Axes: **Z up**, XY is the build plate. Features are authored base-on-Z=0, centred; `transform` places them. Rotations are Euler degrees applied X, then Y, then Z about the world axes — Manifold.rotate's convention, which is three.js Euler order **'ZYX'** (not 'XYZ'). Every three.js Euler in the apps must pass 'ZYX'.
- Geometry lives in Manifold objects that must be `delete()`d. Builders return a fresh Manifold; callers own it. Use `dispose()` from `geometry/manifold.ts`.
- Documents are immutable JSON validated by zod. Never mutate; return new objects. Undo is snapshot-based (`History`).
- The evaluator caches by content key (`Evaluator.keyFor`). If you add a field that changes geometry, make sure it is in the key (top-level `transform`, `name`, `visible`, `filament` are intentionally excluded).
- Worker boundary: meshes are copied before transfer because the evaluator cache keeps the originals.
- Tests: `pnpm test` runs real Manifold booleans in Node. Add a test for every new feature type or module.
- Commit style: imperative subject, body explains why.
- 3MF export (`export/threemf.ts`) targets Bambu Studio / Orca first: per-part `extruder` in `Metadata/model_settings.config` (mirrors bambulab/BambuStudio `bbs_3mf.cpp`), PrusaSlicer via `Slic3r_PE_model.config`. `Application` metadata must not start with "BambuStudio-" (that flips the importer into project mode, which expects full presets). Parts carry a 1-based `filament` slot; the document holds the `filaments` palette.
- Studio interaction model: one active tool (`state/tool.ts`): select/move slide parts on the plate by dragging them, move/rotate add the gizmo, push/pull is the only tool where faces are grabbed (a press becomes a drag after 4 px, otherwise a click picks the face for a typed distance), edges are pickable only in the Fillet tool. Sketch starts by picking a plane (plate or flat face). The hint bar under the toolbar must describe the next step for every tool state.
