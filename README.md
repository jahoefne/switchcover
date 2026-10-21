# switchcover

Turn dumb Swiss light switches into smart ones without an electrician.

switchcover is a fully client-side web app that generates printable `.stl` covers for
existing light-switch plates. A cover is a hollow cap glued to the wall over the old plate.
Its face carries recessed pockets for IKEA **Bilresa** smart switches (held by IKEA's
magnetic metal strip), cut-outs for power outlets sharing the plate, and hidden access
holes behind each Bilresa so the old switch stays reachable. Pick a preset (Swiss Feller
STANDARDdue first, DE/EU frames as secondary data), choose a style, tweak parameters,
preview in 3D, download the STL and share the configuration via the URL.

Live: <https://jahoefne.github.io/switchcover/>

> Status: Phase 0 (scaffold, contracts, geometry kit). The preview shows only the outer
> body and cavity; pockets, openings, the STL export and the real styles land in Phase 1.

## Development

Requires Node ≥ 20.19.

```sh
npm install
npm run dev        # Vite dev server → http://localhost:5173/switchcover/
npm test           # vitest (Node; manifold-3d WASM runs in-process)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ → http://localhost:4173/switchcover/
```

Pushing to `main` runs `.github/workflows/deploy.yml`: tests, build, deploy to GitHub Pages.

### Layout

```
src/config/    zod schema (CoverConfig v1), defaults (ONE place for measurements), presets,
               migrate, URL codec (#v1.<lz-string>)
src/layout/    resolveLayout: config → CoverFrame (pure TS, no WASM)
src/geometry/  contract.ts (all shared types), shape2d.ts, kit/ (manifold-3d helpers +
               memory scopes), buildCover.ts; rules in src/geometry/README.md
src/styles/    style registry + styles
src/worker/    geometry worker + client (one build in flight, newest wins)
src/ui/        React app + three.js viewer
test/          vitest suites; test/helpers/manifold.ts initialises WASM once per file
```

## Coordinate conventions

Identical in config, layout, geometry and viewer:

- Millimetres and degrees. **X** right, **Y** up along the wall, **Z** out of the wall.
  Origin = plate centre on the wall. The cover occupies z ∈ [0, frontZ]; z = 0 is the
  glued base. This matches three.js (Y up, camera at +Z), so the viewer needs no conversion.
- Grid rows are numbered top → bottom, columns left → right. Module (c, r) anchor:
  `x = (c − (cols−1)/2)·pitchX`, `y = ((rows−1)/2 − r)·pitchY`. The anchor is the physical
  rocker/socket centre; a feature's centre is anchor + dx/dy (+dy is up) + automatic
  spreading. Rotations are counter-clockwise about +Z; an unrotated Bilresa has its long
  axis along Y.
- Only `resolveLayout` converts conventions. Never feed DOM/screen coordinates into geometry.
- Height chain: `frontZ = plate.depth + rockerGap + floorT + pocketDepth`
  (≈ 12 + 2 + 2.4 + 9 mm), with `floorT ≥ strip.protrusion + print.tolerance + 1.2`.
- Face-down export is a **rotation** of 180° about Y, (x, y, z) → (−x, y, −z), then a
  translation to min z = 0 — never a mirror. Seen from above in the slicer the layout
  therefore looks mirrored; that is correct (the left switch is still on the left when the
  cover hangs on the wall).

## Magnet strip: placeholder dimensions

The Bilresa is held by IKEA's metal strip, which sits in an indent in the pocket floor and
in the Bilresa's own back recess. **Its real dimensions have not been measured yet.** The
defaults assume a stadium 44 × 7 mm centred on the Bilresa's long axis, protruding 1.0 mm
(`DEFAULT_BILRESA.strip` in `src/config/defaults.ts`). Before printing a full cover,
measure a real strip (or print the test-fit ring once it exists) and correct the values in
that one place; they are also exposed in the advanced settings.

## Adding a style

1. Create `src/styles/<id>/index.ts` exporting a `CoverStyle` (see `src/geometry/contract.ts`;
   `src/styles/box/index.ts` is the smallest example):
   - `params`: a zod object whose fields **all have defaults** (`params.parse({})` must work),
     plus optional `ui` slider metadata per param.
   - `limits(params, plate)`: `minFrame`, `minFrontZ`, `maxEdgeR` — the resolver honours the
     first two, the UI clamps sliders with them.
   - `outerBody(ctx)`: build it as `kit.hull(...)` of `kit.ring(...)`s; flat base exactly at
     z = 0, top at `surfaceZ`.
   - `surfaceZ(ctx, x, y)`: local face height (return `ctx.frame.frontZ` for flat faces).
   - `openingEdge` / `pocketEdge`: return an `EdgeProfile` (data); the features build the
     cutting tools with `kit.edgeTool`.
   - `printOrientation` and `printHint`.
2. Import it in `src/styles/index.ts` and append it to `STYLES`.
3. Add tests: defaults parse, `outerBody` is valid (`status() === 'NoError'`) with the
   expected bounding box for every preset frame, body height matches `surfaceZ`.

Follow the Manifold rules in `src/geometry/README.md` (hulls of rings, no `levelSet` /
`smoothOut` after booleans, everything inside `withScope`).

## Credits

`model/Bilresa_*.stl` are community models of the IKEA Bilresa, used for measurements and
the ghost preview (`public/models/`).
