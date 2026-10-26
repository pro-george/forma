# Forma — working notes for agents and humans

- pnpm monorepo. `packages/core` has no DOM dependency and must stay that way (it runs in Node tests and in a Web Worker). Anything that needs a canvas goes through an injected provider (`TextRasterizer`).
- Units: mm. Axes: **Z up**, XY is the build plate. Features are authored base-on-Z=0, centred; `transform` places them. Rotations are Euler degrees applied X, then Y, then Z about the world axes — Manifold.rotate's convention, which is three.js Euler order **'ZYX'** (not 'XYZ'). Every three.js Euler in the apps must pass 'ZYX'.
- Geometry lives in Manifold objects that must be `delete()`d. Builders return a fresh Manifold; callers own it. Use `dispose()` from `geometry/manifold.ts`.
- Documents are immutable JSON validated by zod. Never mutate; return new objects. Undo is snapshot-based (`History`).
- The evaluator caches by content key (`Evaluator.keyFor`). If you add a field that changes geometry, make sure it is in the key (top-level `transform`, `name`, `visible` are intentionally excluded).
- Worker boundary: meshes are copied before transfer because the evaluator cache keeps the originals.
- Tests: `pnpm test` runs real Manifold booleans in Node. Add a test for every new feature type or module.
- Commit style: imperative subject, body explains why.
