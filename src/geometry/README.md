# Geometry rules (manifold-3d)

Everything under `src/geometry/` and `src/styles/` follows these rules. They come from the
design review; breaking them causes slow builds, bad fits or WASM memory leaks.

## Data flow

```
CoverConfig ──resolveLayout()──▶ CoverFrame ──buildCover(kit, config)──▶ Manifold ──getMesh()──▶ worker → viewer / STL
                (pure TS)                       (WASM, inside withScope)
```

`contract.ts` is the authority for every type crossing these boundaries. Coordinates: mm,
X right, Y up the wall, Z out of the wall, origin = plate centre, cover in z ∈ [0, frontZ].

## Bodies and tools

- All v1 outlines are convex, so outer bodies are `Manifold.hull(points)` of computed rings
  (`kit.ring`) at chosen heights/insets (1–3k points, < 10 ms, exactly flat base).
  - Stepped = union of one hull per tier.
  - Faceted = hull of a few rings (exact bevels).
  - Dome = hull including sampled surface points `z = frontZ + sag·(1−u²)(1−v²)`, sag ≤ 3 mm.
- Fillet/flare tools are trumpet-shaped (not convex): `revolve` a 2D profile for circles;
  union of `hull(slice_i, slice_i+1)` over offset slices (`kit.loft`) for stadiums and
  rounded rects. `kit.edgeTool` does both. Used for pocket rims and opening edges.
- Every cutting tool overshoots the surfaces it cuts by 0.1 mm (`OVERSHOOT`).
- Build in stages, never one giant subtract: `outerBody − cavity + additions − cuts`, with
  one `Manifold.union(tools)` per stage and then one boolean.
- Do **not** use `levelSet`, `minkowskiSum` on non-convex inputs, or `smoothOut`/`refine`
  after booleans (they bulge flat faces and change fit dimensions).

## Resolution

- Global `setMinCircularAngle` / `setMinCircularEdgeLength`: preview 10° / 1 mm, export
  3° / 0.4 mm (`createKit(wasm, quality)` applies them).
- Own ring code uses `kit.segments(r)` (= `getCircularSegments`), so all slices agree.
- Expect < 40k triangles, STL < 2 MB, 100–400 ms per export build.

## Memory

- Run all geometry inside `withScope(fn)` (`kit/scope.ts`). Every Manifold/CrossSection
  created while a scope is active is tracked automatically (constructors, statics and
  methods are instrumented by `initManifold`), including intermediates such as
  `a.subtract(b).translate(...)`. When the scope ends, everything is deleted except what
  `fn` returns (directly, or inside returned arrays / plain objects).
- `kit.keep(o)` tracks explicitly (idempotent) — use it for objects you build in ways the
  instrumentation cannot see.
- `liveObjectCount()` must return to its baseline after a build; tests assert it.
- Dispose old three.js geometries in the viewer.

## Validity after build

`status() === 'NoError'`, `!isEmpty()`, `decompose().length === 1`,
`genus() ===` number of through-holes.

## Worker

- One build in flight; newer preview requests replace the queued one; cancel by
  terminate + respawn (`worker/client.ts`).
- Downloads rebuild at export quality — never export the preview mesh.
- Copy `getMesh()` buffers into fresh typed arrays and transfer them.

## WASM init

- `import wasmUrl from 'manifold-3d/manifold.wasm?url'` only in the worker entry →
  `initManifold(() => Module({ locateFile: () => wasmUrl }))`, which calls `setup()`.
- Node tests call `initManifold()` (plain `Module()`).
- Vite: `base: '/switchcover/'`, `worker.format: 'es'`, `build.target: 'es2022'`,
  `optimizeDeps.exclude: ['manifold-3d']`,
  `new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })`.
  No COOP/COEP needed (single-threaded; Pages cannot set headers anyway).

## STL

80-byte header must not start with `solid`; little-endian; normals from winding.
Face-down export = rotation 180° about Y, (x, y, z) → (−x, y, −z), then translate to
min z = 0. Never mirror / negative scale (the slicer's top view then looks mirrored —
that is correct).
