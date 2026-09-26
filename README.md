# Forma

Browser-based 3D modeler for makers: parametric solids, booleans that always stay watertight, generator **modules** (nametag keychains, flexi toys, storage boxes…), and direct STL / 3MF export for printing.

```
pnpm install
pnpm dev          # studio on http://localhost:5173
pnpm test         # core tests (real Manifold booleans run in Node)
pnpm build
```

## Layout

| Package | What it is |
| --- | --- |
| `packages/core` (`@forma/core`) | No UI. Document model (zod-validated JSON), immutable operations + undo history, the **evaluator** on top of [Manifold](https://github.com/elalish/manifold) (WASM), surface modifiers, the module SDK, raster→outline tracing (text in any font, logos), STL/3MF writers. |
| `apps/studio` (`@forma/studio`) | React + react-three-fiber app. Geometry runs in a Web Worker; the UI only ever receives meshes. |

## Conventions

* Millimetres, **Z up**, build plate = XY plane at Z = 0 (same as every slicer).
* Every feature is authored with its base on Z = 0 and centred on the origin; `transform` places it.
* A feature is a `solid` or a `hole`. A `combine` unions its solid children and subtracts the holes, in order. Children stay editable.
* A `module` is a generator: `{ inputs, build(inputs, api) → FeatureSpec[] }`. Forma evaluates it live and can bake it into ordinary parts.

## Writing a module

```ts
import { registerModule } from '@forma/core';

export const coasterModule = {
  id: 'coaster',
  name: 'Coaster',
  description: 'Round coaster with a lip.',
  inputs: [
    { key: 'diameter', type: 'number', label: 'Diameter', default: 90, min: 40, max: 150, step: 1, unit: 'mm' },
    { key: 'lip', type: 'toggle', label: 'Lip', default: true },
  ],
  build(i, api) {
    const r = Number(i.diameter) / 2;
    const parts = [{ type: 'cylinder', name: 'Base', radius: r, height: 3, segments: 128 }];
    if (i.lip) parts.push({ type: 'tube', name: 'Lip', radius: r, innerRadius: r - 2, height: 6, segments: 128 });
    return parts;
  },
};
```

`api` gives you `roundedRect`, `circle`, `regularPolygon`, `text(str, font, capHeightMm)` and `traceRaster(...)`.

## Roadmap

1. Sketcher with lines/arcs and constraints (replaces click-to-place polygons)
2. Sculpt mode (mesh features already flow through the kernel)
3. Fillets/chamfers on selected edges via a second kernel (OpenCascade.js) behind the same document model
4. Module marketplace: load modules from a URL, sandboxed
5. Accounts and cloud projects (Supabase)
