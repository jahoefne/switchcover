/**
 * Openings through the face skin into the cavity.
 *  - outlet: `kit.edgeTool` with the style's `openingEdge`, from the local face (at the
 *    opening centre) down past the cavity ceiling. edgeTool clamps the edge depth to the skin,
 *    so the narrowest section, at the cavity ceiling, is always the outline itself.
 *  - passthrough: the same with a plain 0.6 mm chamfer, whatever the style.
 * Both get a plain prism from just below the cavity ceiling to above the highest face point,
 * which guarantees a through-hole even when the edge tool is shallow or the face is domed.
 * (The face cut is upward-closed, see faceCut, so neighbouring cuts never leave bridges.)
 */
import { OVERSHOOT } from '../kit/kit';
import { cavityCeiling } from './cavity';
import { faceCut, localFace } from './face';
import { PASSTHROUGH_EDGE, type FeatureFn, type OpeningFeature } from './types';

export const opening: FeatureFn<OpeningFeature> = (kit, frame, f, style, ctx) => {
  const z0 = cavityCeiling(frame) - OVERSHOOT;
  const edge = f.role === 'outlet' ? style.openingEdge(ctx, f) : PASSTHROUGH_EDGE;
  const clear = localFace(style, ctx, f.placed).max + OVERSHOOT;
  return { subtract: [...faceCut(kit, style, ctx, f.placed, z0, edge), kit.prism(f.placed, z0, clear)] };
};
