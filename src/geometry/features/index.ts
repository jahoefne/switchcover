/**
 * Cover features: ResolvedFeature → cutting / filling tools (see ./types.ts for the rules).
 */
import type { CoverFrame, FeatureParts, Kit, ResolvedFeature } from '../contract';
import { opening } from './opening';
import { pocketParts } from './pocket';
import type { FeatureCtx, FeatureOptions, FeatureStyle } from './types';

export { cavity, cavityCeiling } from './cavity';
export { edgeExtent, faceCut, localFace, type LocalFace } from './face';
export { opening } from './opening';
export { POCKET_FEATURES, accessHoles, floorBottom, notch, pocketParts, pocketVoid, pocketWell, stripIndent } from './pocket';
export * from './types';

/** Tools of one resolved feature (pocket: well, void, strip, holes, notch; opening: cut). */
export function featureParts(
  kit: Kit,
  frame: CoverFrame,
  f: ResolvedFeature,
  style: FeatureStyle,
  ctx: FeatureCtx,
  opts: FeatureOptions = {},
): FeatureParts[] {
  return f.kind === 'pocket' ? pocketParts(kit, frame, f, style, ctx, opts) : [opening(kit, frame, f, style, ctx)];
}
