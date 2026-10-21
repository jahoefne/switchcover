/**
 * Bilresa pocket features: well (material), void, strip indent, access holes, finger notch.
 *
 * Heights (all relative to the pocket's floorZ, which buildCover has already lifted onto a
 * domed face, see placeFeaturesOnFace):
 *
 *   face ─────────┐      ┌───────── local face (style.surfaceZ)
 *                 │ void │            pocket void: floorZ → face (+0.1), rim edge profile
 *   floorZ ───────┴──────┘            strip indent: floorZ − stripDepth → floorZ + 0.1
 *   floorZ − floorT ═══════           well bottom (floor underside); access holes go through
 *   (cavity below, open to the wall)
 */
import type { CoverFrame, FeatureParts, Kit } from '../contract';
import { OVERSHOOT } from '../kit/kit';
import { offsetPlaced } from '../shape2d';
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

/** Underside of the pocket floor. */
export function floorBottom(frame: CoverFrame, f: PocketFeature): number {
  return f.floorZ - frame.floorT;
}

/**
 * Pocket well (add): pocket outline + wall, from the floor underside up to above the local
 * face, so the pocket hangs from the face skin into the cavity and also works under domes.
 */
export function pocketWell(
  kit: Kit,
  frame: CoverFrame,
  f: PocketFeature,
  style: FeatureStyle,
  ctx: FeatureCtx,
  opts: FeatureOptions = {},
): FeatureParts {
  const outline = offsetPlaced(f.placed, opts.wall ?? frame.minWall);
  const z0 = floorBottom(frame, f);
  const z1 = opts.top ?? localFace(style, ctx, outline).max + OVERSHOOT;
  return z1 > z0 + MIN_TOOL ? { add: [kit.prism(outline, z0, z1)] } : {};
}

/** Pocket void (subtract): floorZ → above the face, rim profile = style.pocketEdge (default chamfer 0.6). */
export function pocketVoid(
  kit: Kit,
  _frame: CoverFrame,
  f: PocketFeature,
  style: FeatureStyle,
  ctx: FeatureCtx,
): FeatureParts {
  const edge = style.pocketEdge?.(ctx, f) ?? DEFAULT_POCKET_EDGE;
  return { subtract: faceCut(kit, style, ctx, f.placed, f.floorZ, edge) };
}

/** Strip indent (subtract): the strip outline from floorZ − stripDepth to floorZ + 0.1. */
export function stripIndent(kit: Kit, _frame: CoverFrame, f: PocketFeature): FeatureParts {
  if (!(f.stripDepth > MIN_TOOL)) return {};
  return { subtract: [kit.prism(f.strip, f.floorZ - f.stripDepth, f.floorZ + OVERSHOOT)] };
}

/**
 * Access holes (subtract): every hole through the floor, from below its underside (or below
 * the cavity ceiling, if a thick skin puts the floor above the cavity) to floorZ + 0.1, so
 * each one is a through-hole into the cavity.
 */
export function accessHoles(kit: Kit, frame: CoverFrame, f: PocketFeature): FeatureParts {
  const z0 = Math.min(floorBottom(frame, f), cavityCeiling(frame)) - OVERSHOOT;
  const z1 = f.floorZ + OVERSHOOT;
  return { subtract: f.holes.map((h) => kit.prism(h, z0, z1)) };
}

/**
 * Finger notch: the circle from floorZ (it must not cut the floor) up through the face, with
 * the pocket rim profile, plus a backing well (circle + wall, add) so the part of the notch
 * outside the pocket outline does not open into the cavity.
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
  const backing = offsetPlaced(f.notch, opts.wall ?? frame.minWall);
  const z0 = floorBottom(frame, f);
  const z1 = opts.top ?? localFace(style, ctx, backing).max + OVERSHOOT;
  const edge = style.pocketEdge?.(ctx, f) ?? DEFAULT_POCKET_EDGE;
  return {
    add: z1 > z0 + MIN_TOOL ? [kit.prism(backing, z0, z1)] : [],
    subtract: faceCut(kit, style, ctx, f.notch, f.floorZ, edge),
  };
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
