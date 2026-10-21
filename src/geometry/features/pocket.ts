/**
 * Bilresa pocket features: well (material), nested void, strip indent, bridge access hole,
 * finger notch.
 *
 * The Bilresa sits back-first: its flat back rests on the floor (floorZ), its R8 back fillet
 * curves up into the full outline 8 mm higher, its front faces out of the wall. The pocket is
 * NESTED: the void follows the fillet (+ pocketClearance, horizontally) and then runs straight
 * to the face; the well around it follows the same profile offset outward by the wall, so the
 * wall is uniform and no material is wasted inside the cavity. Section through the pocket
 * (h = height above floorZ, r = f.backFilletR):
 *
 *   face ───────┐                       ┌─────── local face (style.surfaceZ)
 *               │   void (straight)     │        rim edge = style.pocketEdge
 *   floorZ + r  │                       │        ← fillet ends, full outline (placed)
 *                ╲                     ╱         void: placed inset by backFilletInset(r, h)
 *          notch  ╲___   hole    ___ ╱  ← notch floor at floorZ + NOTCH_FLOOR_LIFT (far end)
 *   floorZ ═ledge═══  ╲_________╱  ═══ledge═     strip indent: [floorZ − stripDepth, floorZ + 0.1]
 *   floorZ − floorT ═══            ═══           well bottom; the bridge hole goes through the
 *   (cavity below, open to the wall)               floor and the lower part of the fillet wall
 *
 * The metal strip is glued onto the two end ledges of its indent and spans the hole.
 */
import type { Manifold } from 'manifold-3d';
import { NOTCH_FLOOR_LIFT, backFilletInset } from '../../config/defaults';
import { backingGap } from '../../layout/resolve';
import type { CoverFrame, FeatureParts, Kit, LoftSlice, Placed } from '../contract';
import { OVERSHOOT } from '../kit/kit';
import { containmentMargin, offsetPlaced, outwardDirection, shapeCore } from '../shape2d';
import { cavityCeiling } from './cavity';
import { faceCut, localFace } from './face';
import {
  DEFAULT_POCKET_EDGE,
  type FeatureCtx,
  type FeatureFn,
  type FeatureOptions,
  type FeatureStyle,
  type PocketFeature,
} from './types';

const MIN_TOOL = 1e-3;
/**
 * Arc segments of the fillet profiles (void and well). 12 equal-angle segments keep the chord
 * error of the R8 arc at 8·(1 − cos 3.75°) ≈ 0.017 mm, well inside the clearance; the chords lie
 * inside the arc, so the lofted void is never larger than the true one.
 */
export const FILLET_SEGMENTS = 12;
/** Extra containment the bridge hole needs before it may end inside the void (≥ chord error). */
const HOLE_EXIT_MARGIN = 0.05;

/** Underside of the pocket floor. */
export function floorBottom(frame: CoverFrame, f: PocketFeature): number {
  return f.floorZ - frame.floorT;
}

/** Floor of the finger notch. */
export function notchFloor(f: PocketFeature): number {
  return f.floorZ + NOTCH_FLOOR_LIFT;
}

/** Void outline at height h above floorZ (the Bilresa's back fillet + clearance). */
export function voidOutlineAt(f: PocketFeature, h: number): Placed {
  return offsetPlaced(f.placed, -backFilletInset(f.backFilletR, h));
}

/**
 * Pocket well (add): the void's profile offset outward by `wall` — a concentric arc of radius
 * r + wall around the fillet's centre line, the full outline + wall above floorZ + r — from the
 * floor underside to above the local face, so the pocket hangs from the face skin into the
 * cavity (and also works under domes). Plus a slab of strip + wall under the strip indent, so
 * the glue ledges keep a full wall where the fillet wall curves in.
 */
export function pocketWell(
  kit: Kit,
  frame: CoverFrame,
  f: PocketFeature,
  style: FeatureStyle,
  ctx: FeatureCtx,
  opts: FeatureOptions = {},
): FeatureParts {
  const wall = opts.wall ?? frame.minWall;
  const r = f.backFilletR;
  const z0 = floorBottom(frame, f);
  const z1 = opts.top ?? localFace(style, ctx, offsetPlaced(f.placed, wall)).max + OVERSHOOT;
  if (!(z1 > z0 + MIN_TOOL)) return {};
  const R = r + wall;
  const slices: LoftSlice[] = [];
  const push = (z: number, offset: number) => {
    if (z < z1 - MIN_TOOL && (slices.length === 0 || z > slices[slices.length - 1].z + 1e-6)) slices.push({ z, offset });
  };
  // Outward offset of the well (relative to placed) at height h above floorZ, for h ∈ [−wall, r].
  const hBottom = z0 - f.floorZ; // = −floorT
  const phi0 = hBottom <= -wall ? 0 : Math.acos(Math.min(1, (r - hBottom) / R));
  if (hBottom <= -wall) push(z0, -r); // vertical below the arc's foot (floorT > wall)
  for (let i = 0; i <= FILLET_SEGMENTS; i++) {
    const phi = phi0 + ((Math.PI / 2 - phi0) * i) / FILLET_SEGMENTS;
    push(Math.max(z0, f.floorZ + r - R * Math.cos(phi)), R * Math.sin(phi) - r);
  }
  slices.push({ z: z1, offset: wall });
  const add: Manifold[] = [r > 0 && slices.length >= 2 ? kit.loft(f.placed, slices) : kit.prism(offsetPlaced(f.placed, wall), z0, z1)];
  if (f.stripDepth > MIN_TOOL && f.floorZ > z0 + MIN_TOOL) add.push(kit.prism(offsetPlaced(f.strip, wall), z0, f.floorZ));
  return { add };
}

/**
 * Pocket void (subtract): the nested part (loft of the fillet profile, floorZ → floorZ + r) and
 * the straight part (faceCut from just below floorZ + r up through the face, rim profile =
 * style.pocketEdge, default chamfer 0.6).
 */
export function pocketVoid(
  kit: Kit,
  _frame: CoverFrame,
  f: PocketFeature,
  style: FeatureStyle,
  ctx: FeatureCtx,
): FeatureParts {
  const edge = style.pocketEdge?.(ctx, f) ?? DEFAULT_POCKET_EDGE;
  const r = f.backFilletR;
  if (!(r > MIN_TOOL)) return { subtract: faceCut(kit, style, ctx, f.placed, f.floorZ, edge) };
  const slices: LoftSlice[] = [];
  for (let i = 0; i <= FILLET_SEGMENTS; i++) {
    const phi = ((Math.PI / 2) * i) / FILLET_SEGMENTS;
    slices.push({ z: f.floorZ + r - r * Math.cos(phi), offset: r * Math.sin(phi) - r });
  }
  // The straight part starts OVERSHOOT below the fillet's top, so the two tools overlap.
  return { subtract: [kit.loft(f.placed, slices), ...faceCut(kit, style, ctx, f.placed, f.floorZ + r - OVERSHOOT, edge)] };
}

/** Strip indent (subtract): the strip outline from floorZ − stripDepth to floorZ + 0.1. */
export function stripIndent(kit: Kit, _frame: CoverFrame, f: PocketFeature): FeatureParts {
  if (!(f.stripDepth > MIN_TOOL)) return {};
  return { subtract: [kit.prism(f.strip, f.floorZ - f.stripDepth, f.floorZ + OVERSHOOT)] };
}

/**
 * Height above floorZ where the access hole has left the fillet wall: from there on the void
 * contains the hole (with HOLE_EXIT_MARGIN for the lofted chords). ≤ backFilletR.
 */
export function holeExitHeight(f: PocketFeature, hole: Placed): number {
  const r = f.backFilletR;
  const inside = (h: number) => containmentMargin(hole, voidOutlineAt(f, h)) >= HOLE_EXIT_MARGIN;
  if (!(r > 0) || inside(0)) return 0;
  if (!inside(r)) return r;
  let lo = 0;
  let hi = r;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Access (bridge) hole (subtract): from below the floor underside (or below the cavity ceiling, if
 * a thick skin puts the floor above the cavity) up to where it leaves the fillet wall (+0.1), so
 * it cuts through the floor and the lower part of the sloped wall and is one through-hole.
 */
export function accessHoles(kit: Kit, frame: CoverFrame, f: PocketFeature): FeatureParts {
  const z0 = Math.min(floorBottom(frame, f), cavityCeiling(frame)) - OVERSHOOT;
  return { subtract: f.holes.map((h) => kit.prism(h, z0, f.floorZ + holeExitHeight(f, h) + OVERSHOOT)) };
}

/**
 * Bridge from a notch backing to the skirt when the backing would end 0 … minWall short of it
 * (a thin air slot that prints badly): the backing swept towards the nearest skirt point, half a
 * skirt deep into it (adds are clipped to the body). null when no bridge is needed.
 */
export function skirtBridge(frame: CoverFrame, backing: Placed): Placed | null {
  const gap = backingGap(frame.outer, frame.skirtT, backing);
  if (!(gap > 1e-6 && gap < frame.minWall - 1e-6)) return null;
  const { w, h, cx, cy, cornerR } = frame.outer;
  const cav = offsetPlaced({ shape: { kind: 'roundedRect', w, h, r: cornerR }, x: cx, y: cy, rotDeg: 0 }, -frame.skirtT);
  const [ux, uy] = outwardDirection(cav, [backing.x, backing.y]);
  const reach = gap + frame.skirtT / 2;
  const R = shapeCore(backing.shape).r;
  return {
    shape: { kind: 'stadium', w: 2 * R, h: 2 * R + reach },
    x: backing.x + (ux * reach) / 2,
    y: backing.y + (uy * reach) / 2,
    rotDeg: (Math.atan2(uy, ux) * 180) / Math.PI - 90,
  };
}

/**
 * Finger notch: the circle from notchFloor (floorZ + NOTCH_FLOOR_LIFT; it exposes the Bilresa's
 * rounded edge and never cuts the floor) up through the face, with the pocket rim profile, plus a
 * backing well (circle + wall, add, from notchFloor − wall) so the part of the notch outside the
 * pocket does not open into the cavity. In the cover (opts.skirtMerge ≠ false) a backing that
 * ends less than minWall short of the skirt is bridged to it (skirtBridge).
 */
export function notch(
  kit: Kit,
  frame: CoverFrame,
  f: PocketFeature,
  style: FeatureStyle,
  ctx: FeatureCtx,
  opts: FeatureOptions = {},
): FeatureParts {
  if (!f.notch) return {};
  const wall = opts.wall ?? frame.minWall;
  const backing = offsetPlaced(f.notch, wall);
  const zFloor = notchFloor(f);
  const z0 = Math.max(floorBottom(frame, f), zFloor - wall);
  const z1 = opts.top ?? localFace(style, ctx, backing).max + OVERSHOOT;
  const edge = style.pocketEdge?.(ctx, f) ?? DEFAULT_POCKET_EDGE;
  const add: Manifold[] = [];
  if (z1 > z0 + MIN_TOOL) {
    add.push(kit.prism(backing, z0, z1));
    const bridge = opts.skirtMerge === false ? null : skirtBridge(frame, backing);
    if (bridge) add.push(kit.prism(bridge, z0, z1));
  }
  return { add, subtract: faceCut(kit, style, ctx, f.notch, zFloor, edge) };
}

/** The pocket features, in build order. */
export const POCKET_FEATURES = [pocketWell, pocketVoid, stripIndent, accessHoles, notch] satisfies FeatureFn<PocketFeature>[];

/** Every tool of one pocket. */
export function pocketParts(
  kit: Kit,
  frame: CoverFrame,
  f: PocketFeature,
  style: FeatureStyle,
  ctx: FeatureCtx,
  opts: FeatureOptions = {},
): FeatureParts[] {
  return POCKET_FEATURES.map((feature: FeatureFn<PocketFeature>) => feature(kit, frame, f, style, ctx, opts));
}
