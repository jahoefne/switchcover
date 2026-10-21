# switchcover

Turn dumb Swiss light switches into smart ones without an electrician.

switchcover is a fully client-side web app that generates printable `.stl` covers for
existing light-switch plates. A cover is a hollow cap glued to the wall over the old plate.
Its face carries recessed pockets for IKEA **Bilresa** smart switches (seated back-first and
held by IKEA's magnetic metal strip), cut-outs for power outlets sharing the plate, and a
hidden access hole behind each Bilresa so the old switch stays reachable. Pick a preset (Swiss Feller
STANDARDdue first, DE/EU frames as secondary data), choose a style, tweak parameters,
preview in 3D, download the STL and share the configuration via the URL.

Live: <https://jahoefne.github.io/switchcover/>

## What works

- **Presets** for Swiss Feller STANDARDdue plates (1×1, 1×2 switch + socket, 2×1, 1×2 two
  switches, 1×3 switch + two sockets, 3×1, 2×2), approximate DE/EU frames and a free
  `custom` layout. Plate size, depth, corner radius and the module grid are editable.
- **Modules**: click a grid cell to make it a Bilresa pocket (two-button or scroll wheel,
  rotation, dx/dy, own pocket depth, finger notch on/off), a socket opening (round, rounded
  rect or stadium, any size), a passthrough or blank. Pockets that would collide are spread
  apart automatically (with a note), and every pocket gets a hidden access hole to the old
  rocker underneath (see "Bilresa pocket and magnet strip").
- **Styles** (see below) with their own parameters; the cover size follows the plate, the
  features and the style (or a manual size ≥ the automatic one).
- **Live 3D preview** (three.js) with translucent ghosts of the plate and the Bilresa, a
  checks list (warnings with the module they refer to), height and weight estimates.
- **Download STL** (rebuilt at export quality, binary STL in the print orientation) and a
  **test-fit STL**: one pocket with a 3 mm rim, built from the same feature code (nested
  pocket, strip indent and ledges, access hole, finger notch), for checking the Bilresa fit
  and the magnet strip with 10–20 g of filament before printing the whole cover.
- **Share links**: the whole configuration lives in the URL hash (`#v2.…`; older `#v1.`
  links still open and are migrated).

## Styles and print orientation

| Style | Look | Prints |
|---|---|---|
| Minimal (default) | rounded block, crisp top chamfer, chamfered cut-outs | face down |
| Organic | large corners, quarter-round fillet into the face, optional dome, flared sockets | face down; with a dome switch to face up |
| Faceted | mitred bevel frame, thin shadow groove, chamfered sockets | face down (bevels under 45° need edge supports) |
| Stepped | two or three tiers, counterbored sockets | face up (tiers would start mid-air face down) |
| Plain box (sharp edges) | the simplest possible style | face down |

The export panel shows each style's print hint; the orientation can be overridden there.
Face-down exports are **rotated** 180° about Y, not mirrored, so the face lies flat on the
bed. Seen from above in the slicer the layout therefore looks mirrored — that is correct: the
left switch is still on the left once the cover hangs on the wall.

Face down, a pocket opens onto the bed: its straight wall and the nested fillet wall above it
lean in gradually and print without support. Only what is left of the pocket floor beside the
access hole (the strip's glue ledges) bridges across the pocket; enable supports inside the
pockets if your printer bridges poorly.

Print the test-fit part first, check that the Bilresa seats, that the strip sits on its
ledges and that the Bilresa comes out with the finger notch, then print the cover.

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
src/config/    zod schema (CoverConfig v2), defaults (ONE place for measurements), presets,
               migrate (v1 → v2), URL codec (#v2.<lz-string>, reads #v1.)
src/layout/    resolveLayout: config → CoverFrame (pure TS, no WASM)
src/geometry/  contract.ts (all shared types), shape2d.ts, kit/ (manifold-3d helpers +
               memory scopes), features/ (pockets, openings, cavity), buildCover.ts,
               buildTestFit.ts, export/stl.ts; rules in src/geometry/README.md
src/styles/    style registry + styles (minimal, organic, faceted, stepped, box; common/ helpers)
src/worker/    geometry worker + client (one build in flight, newest wins)
src/ui/        React app + three.js viewer (viewer/ghost.ts: where the Bilresa ghost goes)
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
  (≈ 12 + 2 + 2.4 + 10 = 26.4 mm), with `floorT ≥ strip.protrusion + print.tolerance + 1.2`.
  The Bilresa's back rests on the floor (`floorZ = frontZ − pocketDepth`), its front stands
  18.5 − pocketDepth proud of the face (8.5 mm by default).
- Face-down export is a **rotation** of 180° about Y, (x, y, z) → (−x, y, −z), then a
  translation to min z = 0 — never a mirror. Seen from above in the slicer the layout
  therefore looks mirrored; that is correct (the left switch is still on the left when the
  cover hangs on the wall).

## Bilresa pocket and magnet strip

Measured from `model/*.stl` (long axis along Y). The STL's flat z = 0 face, with the two
buttons, is the Bilresa's **front**; the rounded end is its **back**, which faces the wall.
The body keeps its full outline (40 × 70 two-button, 45 × 70 wheel) for 10 mm from the front,
then rounds off with an exact R8 quarter round into a flat back 18.5 mm behind the front
(24 × 54 / 29 × 54). On the back flat sits a 1 mm proud stadium rim, the recess of IKEA's
glue-on metal strip (≈ 22 × 51 mm, ≈ 1 mm proud once in place). All of it lives in
`BILRESA_VARIANTS` / `DEFAULT_BILRESA` in `src/config/defaults.ts`.

- **Nested pocket.** The Bilresa sits back-first. From the floor up, the pocket wall follows
  its R8 back fillet (+ `pocketClearance`), then runs straight to the face; the default depth
  10 mm is 8 mm of fillet + 2 mm of straight engagement (minimum 8.5). The well around it
  follows the same profile offset by `minWall`, so the wall is uniform and no material hangs
  uselessly in the cavity.
- **Magnet strip and glue ledges.** The floor has an indent of strip + 2 · tolerance,
  protrusion + tolerance deep (22.4 × 51.4 × 1.2 mm by default). Glue the strip onto the two
  end ledges of that indent (`stripLedge`, ≥ 4 mm each); it spans the access hole between them.
- **Access hole.** One hole per pocket, centred on the pocket and oriented with it: as wide as
  `access.w` (34 mm) but never closer than `hiddenMargin` to the pocket outline, as long as the
  strip minus both ledges, shortened if needed so it stays hidden behind the Bilresa (39 mm by
  default, so the ledges are ≈ 6 mm). It cuts through the floor and the foot of the fillet
  wall. The ≈ 6 mm gaps beside the strip are the access: press the old rocker with a thin tool
  (the checks list notes gaps under 8 mm). The rocker centre must lie inside the hole (error
  otherwise).
- **Finger notch.** Ø 14 mm at the pocket's end farthest from the plate centre, cut from the
  face down to 2 mm above the floor so a fingertip reaches the Bilresa's rounded edge to lift
  it out. Its backing is merged into the skirt when it would end less than `minWall` short of it.
- **Ghost.** The viewer shows the STL without tilting it: moved to (pocket x, y,
  floorZ + 18.5) and turned with the pocket.

Note: in the STL the strip rim is 52 mm long (with a small flat at one end), while the default
strip is 51 mm, so the rim's tips touch the indent's ends by ~0.3 mm. If your strip measures
more than 51 mm, raise the strip length (the test-fit part shows it).

## Adding a style

1. Create `src/styles/<id>/index.ts` exporting a `CoverStyle` (see `src/geometry/contract.ts`;
   `src/styles/box/index.ts` is the smallest example, `src/styles/minimal/index.ts` the
   reference):
   - `params`: a zod object whose fields **all have defaults** (`params.parse({})` must work),
     plus optional `ui` metadata per param: `{ label, min, max, step, unit?, clampTo? }` for
     numbers (sliders; `clampTo: 'maxEdgeR'` lowers the max to that limit) or
     `{ kind: 'boolean', label }` for checkboxes.
   - `limits(params, plate)`: what the resolver must leave room for —
     `minFrame` (features ↔ outer edge), `minFrontZ`, `maxEdgeR` (UI clamp), and optionally
     `edgeAllowance` / `pocketEdgeAllowance` (how far your opening / pocket edges widen the
     cut at the face; features are spaced and framed so these fit at full size), `cornerR`
     (your outer corner radius; the frame grows just enough for the plate to fit the cavity's
     corner) and `edgeInset(drop)` (your edge profile inverted, if it drops deep enough to
     come near the plate).
   - `outerBody(ctx)`: build it as `kit.hull(...)` of `kit.ring(...)`s; flat base exactly at
     z = 0, top at `surfaceZ`. Use a corner radius ≤ `frame.outer.cornerR`.
   - `surfaceZ(ctx, x, y)`: local face height (return `ctx.frame.frontZ` for flat faces).
   - `openingEdge` / `pocketEdge`: return an `EdgeProfile` (data); the features build the
     cutting tools with `kit.edgeTool`. `availableEdgeRoom` in `src/styles/common/frame.ts`
     shrinks them safely when features were placed by hand closer than the allowances.
   - `decorate` (optional): extra material / cuts; `src/styles/common/profile.ts` has the
     shell fill that restores wall thickness under bevels, fillets and tiers.
   - `printOrientation` and `printHint`.
2. Import it in `src/styles/index.ts` and add it to `STYLES` (default first, plain box last).
3. Add it to the specs in `test/styles.test.ts` (defaults parse, `outerBody` valid with the
   expected bounding box for every preset frame, body height matches `surfaceZ`, walls,
   full-size edges); `test/integration.test.ts` builds every preset with every registered
   style automatically.

Follow the Manifold rules in `src/geometry/README.md` (hulls of rings, no `levelSet` /
`smoothOut` after booleans, everything inside `withScope`).

## Credits

`model/Bilresa_*.stl` are community models of the IKEA Bilresa, used for measurements and
the ghost preview (`public/models/`).
