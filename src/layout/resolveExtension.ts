/**
 * resolveExtension: a config with `part.kind: 'extension'` → CoverFrame. Pure TS, like resolve.ts
 * (which dispatches here from resolveLayout and shares its steps through steps.ts).
 *
 * The extension is a SOLID, flat slab glued to the wall beside the existing plate, which stays in
 * use (its switch cannot be replaced by a Bilresa). It sits on `part.side` of the plate, `part.gap`
 * mm from its edge, with its face flush with the plate's (frontZ = plate.depth, at least
 * MIN_EXTENSION_FACE) and the plate's corner radius, so plate + extension look like one longer
 * plate. There is no cavity, skin, skirt or access hole; the slicer's infill keeps it light.
 *
 * Pockets: the module grid is centred on the slab (frame.part.origin), one cell per module. Each
 * Bilresa pocket is the same nested pocket as in a cap (features/pocket.ts) with the strip indent
 * on a full floor. Its floor sits as low as the floor thickness allows (floorZ = max(floorT,
 * frontZ − depth)), so with the default 14 mm pocket in a 12 mm slab the rim (rimZ = floorZ +
 * depth, 16.4 mm) stands `rise` = 4.4 mm above the face: around the pocket the face curves up
 * through a concave cove `part.flare` mm wide to a rim `minWall` wide (the extension style builds
 * it, see src/styles/extension). A pocket shallower than the slab is simply sunk into it.
 * Outlet / passthrough modules are ignored with a warning (nothing sits behind the slab).
 *
 * Outline (world mm): the union of
 *  - the grid cells (cols · pitchX × rows · pitchY, shifted by the grid offset): the extension
 *    covers one module cell per Bilresa by default (90 × 60 for a Swiss module);
 *  - each pocket offset by minWall + max(flare + the slab's edge chamfer, cover.margin) + the rim
 *    chamfer (EXTENSION_RIM_CHAMFER): the cove's foot stays off the edge chamfer;
 *  - each finger notch offset by minWall + the rim chamfer (world coordinates, at the pocket end
 *    farthest from the plate);
 *  - the plate's extent along the shared edge, so the slab is as wide as the plate (wider only
 *    when a pocket needs it: extension-wider-than-plate, info).
 * The box is moved so its inner side lies `gap` mm outside the plate's edge; a manual size
 * (cover.size ≥ auto) grows it symmetrically along the plate's edge and away from the plate on
 * the other axis (the inner edge stays).
 *
 * Styles do not apply (the extension style is fixed, src/styles/extension), so the `style`
 * argument of resolveLayout is ignored here: the rim chamfer the resolver leaves room for is the
 * same constant the style cuts.
 */
import { BILRESA_VARIANTS, EXTENSION_EDGE_CHAMFER, EXTENSION_RIM_CHAMFER, MAX_PRINT_SIZE, MIN_EXTENSION_FACE } from '../config/defaults';
import type { CoverConfig, ExtensionSide } from '../config/schema';
import type { CoverFrame, Placed, ResolvedFeature, Vec2, Warning } from '../geometry/contract';
import { offsetPlaced } from '../geometry/shape2d';
import {
  EPS,
  WARNING_CODES,
  ceil2,
  floorChain,
  fmt,
  growToContain,
  moduleDrafts,
  notchCentre,
  placedOf,
  pocketDepthOf,
  spreadDrafts,
  stripIndentOf,
  type Box2D,
  type ResolveStyle,
} from './steps';

type PocketFeature = Extract<ResolvedFeature, { kind: 'pocket' }>;

/** Axes of an extension side: `along` the shared plate edge, `away` from the plate (`outward` = its sign). */
export function sideAxes(side: ExtensionSide): { along: 'x' | 'y'; away: 'x' | 'y'; outward: 1 | -1 } {
  switch (side) {
    case 'top':
      return { along: 'x', away: 'y', outward: 1 };
    case 'bottom':
      return { along: 'x', away: 'y', outward: -1 };
    case 'right':
      return { along: 'y', away: 'x', outward: 1 };
    case 'left':
      return { along: 'y', away: 'x', outward: -1 };
  }
}

const moved = (p: Placed, dx: number, dy: number): Placed => ({ ...p, x: p.x + dx, y: p.y + dy });

/** How far the pocket rim rises above the slab's face for a pocket of `depth` (0 when it fits). */
export function rimRise(faceZ: number, floorT: number, depth: number): number {
  return Math.max(0, floorT + depth - faceZ);
}

export function resolveExtension(config: CoverConfig, _style?: ResolveStyle): CoverFrame {
  const { plate, grid, cover, part } = config;
  const warnings: Warning[] = [];

  // 1. Heights: the face is the plate's face --------------------------------------------
  const { stripDepth, floorT } = floorChain(config, warnings);
  let faceZ = plate.depth;
  if (faceZ < MIN_EXTENSION_FACE - EPS) {
    warnings.push({
      code: WARNING_CODES.frontRaised,
      severity: 'info',
      message: `Extension face raised from ${fmt(faceZ)} to ${fmt(MIN_EXTENSION_FACE)} mm (the slab cannot be thinner).`,
    });
    faceZ = MIN_EXTENSION_FACE;
  }

  // 2. Modules → drafts (pockets only) ------------------------------------------------
  const drafts = moduleDrafts(config, warnings).filter((d) => {
    if (d.kind === 'pocket') return true;
    warnings.push({
      code: WARNING_CODES.extensionOpening,
      severity: 'warning',
      featureId: d.id,
      message: `Module ${d.id} (${d.module.role}) was ignored: an extension plate holds Bilresa pockets only (nothing sits behind it).`,
    });
    return false;
  });

  // 3. Spreading: no access holes, so pockets may move as far as they need ------------
  const allow = { opening: 0, pocket: EXTENSION_RIM_CHAMFER };
  spreadDrafts(config, drafts, allow, () => null, warnings);

  // 4. Pockets, in grid coordinates ----------------------------------------------------
  let pockets: PocketFeature[] = drafts.map((d) => {
    const placed = placedOf(d);
    const depth = pocketDepthOf(config, d);
    const floorZ = Math.max(floorT, faceZ - depth);
    const variant = d.module.bilresa?.variant ?? '2button';
    return {
      kind: 'pocket',
      id: d.id,
      anchor: d.anchor,
      placed,
      variant,
      floorZ,
      backFilletR: BILRESA_VARIANTS[variant].backFilletR,
      strip: stripIndentOf(config, placed),
      stripDepth,
      holes: [],
      rimZ: floorZ + depth,
    };
  });

  // 5. Outline in grid coordinates ------------------------------------------------------
  const { along, away, outward } = sideAxes(part.side);
  const cornerR = plate.cornerR;
  const gx = grid.offsetX ?? 0;
  const gy = grid.offsetY ?? 0;
  let box: Box2D = {
    minX: gx - (grid.cols * grid.pitchX) / 2,
    maxX: gx + (grid.cols * grid.pitchX) / 2,
    minY: gy - (grid.rows * grid.pitchY) / 2,
    maxY: gy + (grid.rows * grid.pitchY) / 2,
  };
  const reach = cover.minWall + Math.max(part.flare + EXTENSION_EDGE_CHAMFER, cover.margin) + allow.pocket;
  for (const f of pockets) box = growToContain(box, cornerR, offsetPlaced(f.placed, reach));
  // As wide as the plate along the shared edge.
  const plateAlong = along === 'x' ? plate.w / 2 : plate.h / 2;
  if (along === 'x') {
    box.minX = Math.min(box.minX, -plateAlong);
    box.maxX = Math.max(box.maxX, plateAlong);
  } else {
    box.minY = Math.min(box.minY, -plateAlong);
    box.maxY = Math.max(box.maxY, plateAlong);
  }

  // 6. Beside the plate: the inner side lies `gap` outside the plate's edge --------------
  const plateAway = away === 'x' ? plate.w / 2 : plate.h / 2;
  const edge = outward * (plateAway + part.gap);
  const inner = away === 'x' ? (outward > 0 ? box.minX : box.maxX) : outward > 0 ? box.minY : box.maxY;
  const shift = edge - inner;
  const origin: Vec2 = away === 'x' ? [shift, 0] : [0, shift];
  box =
    away === 'x'
      ? { ...box, minX: box.minX + shift, maxX: box.maxX + shift }
      : { ...box, minY: box.minY + shift, maxY: box.maxY + shift };
  pockets = pockets.map((f) => ({
    ...f,
    anchor: [f.anchor[0] + origin[0], f.anchor[1] + origin[1]],
    placed: moved(f.placed, origin[0], origin[1]),
    strip: moved(f.strip, origin[0], origin[1]),
  }));

  // 7. Finger notches, at the pocket end farthest from the plate (world coordinates) -----
  const notchMargin = cover.minWall + allow.pocket;
  pockets = pockets.map((f) => {
    const d = drafts.find((x) => x.id === f.id)!;
    const notchOn = d.module.bilresa?.notch ?? config.bilresa.notch.enabled;
    if (!notchOn) return f;
    const [nx, ny] = notchCentre(f.placed);
    const notch: Placed = { shape: { kind: 'circle', d: config.bilresa.notch.d }, x: nx, y: ny, rotDeg: 0 };
    box = growToContain(box, cornerR, offsetPlaced(notch, notchMargin));
    return { ...f, notch };
  });

  // 8. Size: auto, or manual ≥ auto (centred along the edge, growing away from the plate) --
  const autoW = ceil2(box.maxX - box.minX);
  const autoH = ceil2(box.maxY - box.minY);
  let w = autoW;
  let h = autoH;
  if (cover.size !== 'auto') {
    w = Math.max(cover.size.w, autoW);
    h = Math.max(cover.size.h, autoH);
    if (cover.size.w < autoW - EPS || cover.size.h < autoH - EPS) {
      warnings.push({
        code: WARNING_CODES.sizeClamped,
        severity: 'warning',
        message: `Requested extension size ${fmt(cover.size.w)} × ${fmt(cover.size.h)} mm is too small; using ${fmt(w)} × ${fmt(h)} mm.`,
      });
    }
  }
  const cx = away === 'x' ? edge + (outward * w) / 2 : (box.minX + box.maxX) / 2 + 0;
  const cy = away === 'y' ? edge + (outward * h) / 2 : (box.minY + box.maxY) / 2 + 0;

  // 9. Global warnings -------------------------------------------------------------------
  if (Math.max(w, h) > MAX_PRINT_SIZE) {
    warnings.push({
      code: WARNING_CODES.coverTooLarge,
      severity: 'warning',
      message: `Extension is ${fmt(w)} × ${fmt(h)} mm; sides over ${MAX_PRINT_SIZE} mm may not fit your print bed.`,
    });
  }
  const alongAuto = along === 'x' ? autoW : autoH;
  if (alongAuto > 2 * plateAlong + EPS) {
    warnings.push({
      code: WARNING_CODES.extensionWide,
      severity: 'info',
      message: `The extension is ${fmt(alongAuto)} mm along the plate's ${fmt(2 * plateAlong)} mm edge: a pocket with its rim, cove and margin needs the room.`,
    });
  }
  const rise = pockets.reduce((r, f) => Math.max(r, f.rimZ! - faceZ), 0);

  return {
    part: { kind: 'extension', side: part.side, gap: part.gap, origin, flare: part.flare, rise },
    outer: { w, h, cx, cy, cornerR: Math.min(cornerR, w / 2, h / 2), autoW, autoH },
    plate: { w: plate.w, h: plate.h, protrusion: plate.depth, cornerR: plate.cornerR, clearance: cover.clearance },
    frontZ: faceZ,
    skinT: cover.skinT,
    skirtT: cover.skirtT,
    minWall: cover.minWall,
    floorT,
    features: pockets,
    warnings,
  };
}
