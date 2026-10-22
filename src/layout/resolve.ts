/**
 * resolveLayout: CoverConfig → CoverFrame. Pure TypeScript (no WASM), deterministic, cheap
 * enough to run on the main thread on every edit.
 *
 * This file resolves CAPS (hollow covers over the plate); `resolveLayout` hands configs with
 * `part.kind: 'extension'` to resolveExtension.ts (a flat slab beside the plate). The steps the
 * two share (height chain, drafts, spreading, bridge hole, notch position, box growth) live in
 * steps.ts and are re-exported here.
 *
 * Together they are the ONLY place where config conventions (rows top→bottom, module grid)
 * become geometry coordinates (mm, X right, Y up, origin = plate centre). See README
 * "Coordinate conventions".
 *
 * Steps (cap):
 *  1. Height chain: stripDepth, floorT clamp, frontZ.
 *  2. Module anchors (row 0 on top, grid shifted by grid.offsetX/Y) and feature centres
 *     (anchor + dx/dy).
 *  3. Automatic spreading of pockets that are closer than minWall + the two features' edge
 *     allowances (StyleLimits.edgeAllowance / pocketEdgeAllowance) to a neighbour along a grid
 *     axis. Pocket↔pocket conflicts move both symmetrically; pocket↔opening conflicts move only
 *     the pocket (outlets must stay on their socket). A pocket is never pushed so far that its
 *     rocker (anchor) leaves its access hole unless minWall itself needs it: the allowances are
 *     cosmetic, reaching the old switch is not; the edges between the two then shrink
 *     (edge-reduced note).
 *  4. Per-pocket strip, access holes (policy below) and finger notch; per-outlet sleeve bottom
 *     (sleeveZ = frontZ − the deepest pocket depth).
 *  5. Outer size (auto or manual ≥ auto) and centre; see "Outer size".
 *  6. Warnings.
 *
 * Outer size (all containments exact, see growToContain / containmentMargin): the automatic
 * outline is the UNION of the requirement boxes below — each side goes only as far out as
 * something needs it — so outer.cx / outer.cy may leave the plate centre (a Bilresa above the
 * plate grows the cover upwards only). Content that is symmetric about the plate centre keeps a
 * centred outline. A manual size ≥ auto is centred on the automatic outline's centre. The plate
 * (and its collision box) always stays at the origin.
 *  - corners: where a requirement pokes out of the outline's corner arc, the two sides of that
 *    corner grow by the same amount (growCorners).
 *
 *  - corner radius R = StyleLimits.cornerR, clamped to ≥ rp + skirtT (rp = plate.cornerR +
 *    clearance, the plate zone's corner) and ≤ half the smaller side; default rp + skirtT.
 *  - plate: the plate zone (plate + clearance) offset by s = max(skirtT, edgeInset(budget)) must
 *    fit inside the outer outline (corner R). For s = skirtT that is exactly "the plate fits the
 *    cavity" (outer inset by skirtT, corner Rc = R − skirtT). On the straight sides that needs a
 *    frame f ≥ 0 between the cavity and the plate zone; in the corners the core corners are
 *    (Rc − rp − f) apart on both axes, so the plate's corner arc stays inside the cavity's iff
 *    √2·(Rc − rp − f) ≤ Rc − rp, i.e.
 *        f ≥ (Rc − rp)·(1 − 1/√2)        (and f ≥ 0; nothing extra when rp ≥ Rc).
 *    With R = 14, rp = 4, skirtT = 2.4 that is 2.23 mm per side (+ ≤ 0.1 mm in tight corners
 *    for the meshed arc's chord error, so the preview mesh clears the plate box too).
 *  - features: outline offset by max(minWall + margin, minFrame) + the feature's edge allowance.
 *  - finger notches: the notch circle offset by max(minWall, minFrame) + the pocket edge
 *    allowance, so the notch (and its rim edge) never cuts into a style's bevel / fillet and its
 *    backing (notch + minWall) always fits. (minWall + margin, as for pockets, would grow plate-
 *    sized covers for a small dimple.) A backing that ends 0 … minWall short of the skirt is
 *    merged into the skirt by features/pocket.ts — the cover does not grow for it.
 *    Styles that allow notches in their edge zone (CoverStyle.allowsNotchInEdge: faceted,
 *    stepped, organic) drop minFrame for the notch: minWall + allowance keeps the backing and the
 *    rim edge inside the outline, and the notch's opening may cut into the bevel / fillet / tier
 *    step. A Ø14 notch then fits the plate-driven size of every 1×1 preset with every style;
 *    where a spread pocket's notch still sets the size (faceted and stepped switch + socket, with
 *    the notch switched on) the cover grows by minWall + the rim allowance only, and only on the
 *    notch's side.
 *
 * Access-hole policy (one "bridge" hole per pocket, in the pocket's own unrotated frame):
 *   a rounded rect (corner ACCESS_HOLE_CORNER_R) centred on the POCKET centre,
 *     width  = min(access.w, pocket outline width − 2 · hiddenMargin)
 *     length = strip.l − 2 · stripLedge − 2 · |strip.dy|   (both glue ledges keep ≥ stripLedge)
 *   shortened (never narrowed) until it lies inside the pocket outline inset by hiddenMargin,
 *   i.e. hidden behind the Bilresa. The metal strip is glued onto the two end ledges and spans
 *   the hole; the gaps beside the strip are the tool access. Warnings: no hole → access-none;
 *   the strip covers the whole width → access-none; a gap narrower than MIN_ACCESS_GAP →
 *   access-narrow (info); the anchor (rocker centre) outside the hole → access-uncovered (error).
 */
import { BILRESA_VARIANTS, MAX_OPENING_TUNNEL, MAX_PRINT_SIZE } from '../config/defaults';
import type { CoverConfig } from '../config/schema';
import type { CoverFrame, Placed, ResolvedFeature, Warning } from '../geometry/contract';
import { offsetPlaced, placedBounds, shapeCore } from '../geometry/shape2d';
import { resolveExtension } from './resolveExtension';
import {
  DEFAULT_LIMITS,
  EPS,
  ORIGIN_BOX,
  WARNING_CODES,
  bridgeHole,
  bridgeHoleShape,
  ceil2,
  edgeAllowances,
  floorChain,
  fmt,
  growCorners,
  growToContain,
  moduleDrafts,
  notchCentre,
  placedOf,
  pocketDepthOf,
  spreadDrafts,
  stripIndentOf,
  type Draft,
  type ResolveStyle,
} from './steps';

export {
  DEFAULT_LIMITS,
  WARNING_CODES,
  backingGap,
  bridgeHoleShape,
  edgeAllowances,
  featureId,
  moduleAnchor,
  openingShape,
  outerPlaced,
  type AnchorGrid,
  type Box2D,
  type ResolveStyle,
} from './steps';

/**
 * Resolve a validated config into concrete geometry inputs: a cap (below) or, for
 * `part.kind: 'extension'`, an extension plate (resolveExtension.ts).
 * @param style optional style limits (from `style.limits(params, plate)`) and notch rule.
 */
export function resolveLayout(config: CoverConfig, style?: ResolveStyle): CoverFrame {
  return config.part.kind === 'extension' ? resolveExtension(config, style) : resolveCap(config, style);
}

/** The cap: a hollow cover over the plate (see the file header). */
export function resolveCap(config: CoverConfig, style?: ResolveStyle): CoverFrame {
  const { plate, cover, bilresa } = config;
  const limits = style?.limits ?? DEFAULT_LIMITS;
  const warnings: Warning[] = [];

  // 1. Height chain ---------------------------------------------------------------
  const { stripDepth, floorT } = floorChain(config, warnings);

  // 2. Modules → drafts -----------------------------------------------------------
  const drafts = moduleDrafts(config, warnings);

  // 3. Spreading (a pocket never leaves its rocker's access hole) -------------------
  const allow = edgeAllowances(limits);
  const holeOf = (d: Draft): Placed | null => {
    const h = bridgeHoleShape(config, placedOf(d));
    return 'hole' in h ? h.hole : null;
  };
  spreadDrafts(config, drafts, allow, holeOf, warnings);

  // Heights ---------------------------------------------------------------------------
  const depthOf = (d: Draft) => pocketDepthOf(config, d);
  const pocketDrafts = drafts.filter((d) => d.kind === 'pocket');
  const maxDepth = pocketDrafts.length ? Math.max(...pocketDrafts.map(depthOf)) : bilresa.pocketDepth;
  let frontZ = plate.depth + cover.rockerGap + floorT + maxDepth;
  if (limits.minFrontZ > frontZ + EPS) {
    warnings.push({
      code: WARNING_CODES.frontRaised,
      severity: 'info',
      message: `Face raised from ${fmt(frontZ)} to ${fmt(limits.minFrontZ)} mm for this style.`,
    });
    frontZ = limits.minFrontZ;
  }

  // 4. Features ---------------------------------------------------------------------
  const features: ResolvedFeature[] = drafts.map((d): ResolvedFeature => {
    const placed = placedOf(d);
    if (d.kind === 'opening') {
      if (d.module.role === 'passthrough') return { kind: 'opening', id: d.id, role: 'passthrough', anchor: d.anchor, placed };
      // The outlet's sleeve reaches as deep as the deepest pocket (its floor top).
      return { kind: 'opening', id: d.id, role: 'outlet', anchor: d.anchor, placed, sleeveZ: frontZ - maxDepth };
    }
    const stripPlaced = stripIndentOf(config, placed);
    const { holes, warnings: hw } = bridgeHole(config, d.id, d.anchor, placed);
    warnings.push(...hw);
    const variant = d.module.bilresa?.variant ?? '2button';
    const notchOn = d.module.bilresa?.notch ?? bilresa.notch.enabled;
    const [nx, ny] = notchCentre(placed);
    return {
      kind: 'pocket',
      id: d.id,
      anchor: d.anchor,
      placed,
      variant,
      floorZ: frontZ - depthOf(d),
      backFilletR: BILRESA_VARIANTS[variant].backFilletR,
      strip: stripPlaced,
      stripDepth,
      holes,
      notch: notchOn ? { shape: { kind: 'circle', d: bilresa.notch.d }, x: nx, y: ny, rotDeg: 0 } : undefined,
    };
  });

  // 5. Outer size (see the file header) -----------------------------------------------
  const plateZone: Placed = {
    shape: { kind: 'roundedRect', w: plate.w + 2 * cover.clearance, h: plate.h + 2 * cover.clearance, r: plate.cornerR + cover.clearance },
    x: 0,
    y: 0,
    rotDeg: 0,
  };
  const rp = shapeCore(plateZone.shape).r;
  let zClear = plate.depth + cover.clearance;
  for (const f of features) if (f.kind === 'pocket') zClear = Math.max(zClear, f.floorZ - floorT);
  const dropBudget = frontZ - zClear - cover.skinT - cover.skirtT;
  const plateFrame = Math.max(cover.skirtT, limits.edgeInset ? Math.max(0, limits.edgeInset(dropBudget)) : 0);
  const plateContent = offsetPlaced(plateZone, plateFrame);
  const contentBox = placedBounds(plateContent);
  // R ≥ rp + skirtT keeps the skirt ≥ skirtT at the corners; R ≤ the content's half extents keeps
  // the rounded rect well formed while it grows (it only grows, so R stays ≤ half the side).
  const cornerR = Math.min(
    Math.max(limits.cornerR ?? 0, rp + cover.skirtT),
    Math.min(contentBox.maxX - contentBox.minX, contentBox.maxY - contentBox.minY) / 2,
  );
  let box = growToContain(ORIGIN_BOX, cornerR, plateContent);
  // Where the plate's corner is tangent to the cavity's, the meshed arcs (chords inside the true
  // arc) would cut into the plate box: leave the largest chord error of the cavity's corner arc
  // at preview quality (10° segments, see kit/init.ts) as extra room in the corners only.
  const chordTol = Math.max(0, cornerR - cover.skirtT) * (1 - Math.cos((5 * Math.PI) / 180)) + 0.01;
  box = growCorners(box, cornerR, offsetPlaced(plateContent, chordTol));
  const baseMargin = Math.max(cover.minWall + cover.margin, limits.minFrame);
  for (const f of features) {
    const a = f.kind === 'pocket' ? allow.pocket : f.role === 'outlet' ? allow.opening : 0;
    box = growToContain(box, cornerR, offsetPlaced(f.placed, baseMargin + a));
  }
  // Finger notches (see the file header): keep the notch and its rim edge off the style's edge,
  // or, when the style allows notches in its edge zone, just the backing and the rim inside.
  const notchFrame = style?.allowsNotchInEdge ? cover.minWall : Math.max(cover.minWall, limits.minFrame);
  const notchMargin = notchFrame + allow.pocket;
  for (const f of features) {
    if (f.kind === 'pocket' && f.notch) box = growToContain(box, cornerR, offsetPlaced(f.notch, notchMargin));
  }
  // The outline is the requirement box (each side only as far out as something needs it), so
  // its centre may leave the plate centre; sizes are ceiled to 0.01 around that centre.
  const autoW = ceil2(box.maxX - box.minX);
  const autoH = ceil2(box.maxY - box.minY);
  const cx = (box.minX + box.maxX) / 2 + 0;
  const cy = (box.minY + box.maxY) / 2 + 0;
  let w = autoW;
  let h = autoH;
  if (cover.size !== 'auto') {
    w = Math.max(cover.size.w, autoW);
    h = Math.max(cover.size.h, autoH);
    if (cover.size.w < autoW - EPS || cover.size.h < autoH - EPS) {
      warnings.push({
        code: WARNING_CODES.sizeClamped,
        severity: 'warning',
        message: `Requested cover size ${fmt(cover.size.w)} × ${fmt(cover.size.h)} mm is too small; using ${fmt(w)} × ${fmt(h)} mm.`,
      });
    }
  }

  // 6. Global warnings --------------------------------------------------------------
  if (Math.max(w, h) > MAX_PRINT_SIZE) {
    warnings.push({
      code: WARNING_CODES.coverTooLarge,
      severity: 'warning',
      message: `Cover is ${fmt(w)} × ${fmt(h)} mm; sides over ${MAX_PRINT_SIZE} mm may not fit your print bed.`,
    });
  }
  const tunnel = frontZ - plate.depth;
  if (features.some((f) => f.kind === 'opening') && tunnel > MAX_OPENING_TUNNEL + EPS) {
    warnings.push({
      code: WARNING_CODES.openingDeep,
      severity: 'warning',
      message: `Openings are ${fmt(tunnel)} mm deep (face to plate); plugs may not seat beyond ~${MAX_OPENING_TUNNEL} mm.`,
    });
  }
  if (frontZ - cover.skinT < plate.depth + cover.clearance - EPS) {
    warnings.push({
      code: WARNING_CODES.cavityLow,
      severity: 'error',
      message: `The cavity (${fmt(frontZ - cover.skinT)} mm) is lower than the plate + clearance (${fmt(plate.depth + cover.clearance)} mm).`,
    });
  }

  return {
    part: { kind: 'cap' },
    outer: { w, h, cx, cy, cornerR: Math.min(cornerR, w / 2, h / 2), autoW, autoH },
    plate: { w: plate.w, h: plate.h, protrusion: plate.depth, cornerR: plate.cornerR, clearance: cover.clearance },
    frontZ,
    skinT: cover.skinT,
    skirtT: cover.skirtT,
    minWall: cover.minWall,
    floorT,
    features,
    warnings,
  };
}
