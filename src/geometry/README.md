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
  one `Manifold.union(tools)` per stage and then one boolean (see "Features and stages").
- Do **not** use `levelSet`, `minkowskiSum` on non-convex inputs, or `smoothOut`/`refine`
  after booleans (they bulge flat faces and change fit dimensions).

## Features and stages

`features/*` turn each `ResolvedFeature` into tools — `(kit, frame, f, style, ctx, opts?) =>
FeatureParts`; they never touch the body themselves. `buildCover` (and `buildTestFit`, with
the same functions) applies them:

```
body   = style.outerBody(ctx)
shell  = body − (union(cavity) − union(adds))   ≡ (body − cavity) + adds, clipped to the body
shell += style.decorate().add                    (if any)
cover  = shell − union(cuts + style.decorate().subtract)
```

| feature | kind | z range |
|---|---|---|
| cavity | cut (own stage) | outer inset by skirtT, [−0.1, frontZ − skinT]; open to the wall |
| pocketWell | add | loft of the void's profile offset by minWall (concentric arc around the back fillet), [floorZ − floorT, face max + 0.1]; + slab strip + minWall under the ledges |
| pocketVoid | cut | nested: loft of pocket inset by `backFilletInset(r, h)`, [floorZ, floorZ + r] (12 arc segments); then pocket, [floorZ + r − 0.1, face], rim = `style.pocketEdge` (default chamfer 0.6) |
| stripIndent | cut | strip, [floorZ − stripDepth, floorZ + 0.1] |
| accessHoles | cut | the bridge hole, [min(floor underside, cavity ceiling) − 0.1, floorZ + holeExitHeight + 0.1] (through the floor and the foot of the fillet wall) |
| notch | add + cut | backing (circle + minWall) from notchFloor − minWall up, bridged to the skirt when 0 … minWall short of it; void [floorZ + 2, face] with the pocket rim edge. Styles with `allowsNotchInEdge` get the notch only minWall + allowance inside the outline (it may cut into their bevel / fillet / tier step; stepped opens it into the step with `notchBreakouts`) |
| opening | cut | outlet: `style.openingEdge`, passthrough: chamfer 0.6; [cavity ceiling − 0.1, face] + plain through-prism |

- Adds (wells) are carved out of the cavity instead of unioned onto the body, so they can
  never poke through a style's face or edge profile, whatever their top.
- Everything is placed relative to `style.surfaceZ` at the feature centre. `prepareCover`
  lifts each pocket's `floorZ` by `surfaceZ(centre) − frontZ` (never lowers it); the
  returned frame carries the lifted values, so the viewer's ghosts match the geometry.
- Face cuts are upward-closed (`faceCut`): where a dome rises above an edge profile's top,
  a chimney of the widened outline clears up to the highest face point. Otherwise two
  profiles meeting under a higher face leave a bridge — an unintended through-hole.

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
`genus() ===` number of through-holes (`expectedGenus(frame)`). Failures become
severity-`'error'` warnings (`geometry-*`); the mesh is still returned.

Counting through-holes: the open-bottom shell is a cup (genus 0). Pockets, strip indents
and notches are blind (floor below, wells / backing around), so they add nothing. Every
opening and every pocket's (single) bridge access hole that overlaps the cavity footprint
joins the face side to the wall side and adds exactly one handle. The check is skipped
when the resolver reports `feature-overlap` (merged cuts merge holes; already reported).

## Worker

- One build in flight; newer preview requests replace the queued one; cancel by
  terminate + respawn (`worker/client.ts`).
- Downloads rebuild at export quality — never export the preview mesh. `export` /
  `testFit` responses carry the binary STL in `config.print.orientation` (`'style'` →
  `style.printOrientation`).
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
that is correct). `export/stl.ts`: `toBinaryStl(manifold | {positions, indices},
{orientation})`, `stlTriangleCount`, `parseBinaryStl` (merges identical vertices, so a
watertight STL goes straight back into `Manifold.ofMesh`), `resolvePrintOrientation`.
