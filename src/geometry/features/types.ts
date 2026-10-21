/**
 * Shared types for the cover features (src/geometry/features/*).
 *
 * A feature turns one ResolvedFeature into cutting / filling tools:
 *   (kit, frame, feature, style, styleCtx, options?) => FeatureParts
 * Features never apply booleans to the body themselves; buildCover / buildTestFit collect
 * the tools of every feature and apply them stage by stage (one union per stage).
 *
 *  - `add` tools are material that must exist INSIDE the body (pocket wells, notch backing).
 *    buildCover carves them out of the cavity tool instead of adding them to the body, which
 *    is equivalent but can never protrude through a style's face or edge profile.
 *    buildTestFit unions them as the part's body.
 *  - `subtract` tools are cuts (pocket voids, strip indents, access holes, notches, openings).
 *
 * Every tool is placed relative to `style.surfaceZ(x, y)` at the feature centre (flat styles
 * return frontZ) and overshoots the surfaces it cuts by OVERSHOOT (0.1 mm).
 */
import type { z } from 'zod';
import type { CoverFrame, CoverStyle, EdgeProfile, FeatureParts, Kit, ResolvedFeature, StyleCtx } from '../contract';

export type StyleParams = Record<string, unknown>;

/** The parts of a style the features need (any registered style satisfies it). */
export type FeatureStyle = Pick<CoverStyle<z.ZodObject, StyleParams>, 'surfaceZ' | 'openingEdge' | 'pocketEdge'>;

export type FeatureCtx = StyleCtx<StyleParams>;

export type PocketFeature = Extract<ResolvedFeature, { kind: 'pocket' }>;
export type OpeningFeature = Extract<ResolvedFeature, { kind: 'opening' }>;

export interface FeatureOptions {
  /** Wall around wells (default frame.minWall; the test fit uses its rim width). */
  wall?: number;
  /** Top of wells (default: highest local face over the well + OVERSHOOT). */
  top?: number;
}

/** The uniform feature signature (features may ignore trailing arguments). */
export type FeatureFn<F extends ResolvedFeature> = (
  kit: Kit,
  frame: CoverFrame,
  f: F,
  style: FeatureStyle,
  ctx: FeatureCtx,
  opts?: FeatureOptions,
) => FeatureParts;

/** Pocket rim (and finger notch rim) edge when the style has no `pocketEdge`. */
export const DEFAULT_POCKET_EDGE: EdgeProfile = { kind: 'chamfer', size: 0.6 };

/** Passthrough openings are plain cuts with a small chamfer, whatever the style. */
export const PASSTHROUGH_EDGE: EdgeProfile = { kind: 'chamfer', size: 0.6 };
