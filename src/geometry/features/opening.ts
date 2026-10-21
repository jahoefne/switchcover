/**
 * Openings through the face skin into the cavity.
 *  - outlet: `kit.edgeTool` with the style's `openingEdge`, from the local face (at the
 *    opening centre) down past the cavity ceiling. edgeTool clamps the edge depth to the skin,
 *    so the narrowest section, at the cavity ceiling, is always the outline itself. The outlet
 *    also gets a sleeve (add): the outline + minWall from `sleeveZ` (the deepest pocket's floor)
 *    up to above the local face, carved out of the cavity like a pocket well, so the opening is a
 *    walled tube instead of a hole in the skin.
 *  - passthrough: the same cut with a plain 0.6 mm chamfer, whatever the style, and no sleeve.
 * Both get a plain prism from just below the sleeve bottom (or the cavity ceiling) to above the
 * highest face point, which guarantees a through-hole even when the edge tool is shallow or the
 * face is domed. (The face cut is upward-closed, see faceCut, so neighbouring cuts never leave
 * bridges.)
 */
import type { Manifold } from 'manifold-3d';
import { OVERSHOOT } from '../kit/kit';
import { offsetPlaced } from '../shape2d';
import { cavityCeiling } from './cavity';
import { faceCut, localFace } from './face';
import { PASSTHROUGH_EDGE, type FeatureFn, type OpeningFeature } from './types';

const MIN_TOOL = 1e-3;

export const opening: FeatureFn<OpeningFeature> = (kit, frame, f, style, ctx) => {
  const ceiling = cavityCeiling(frame);
  // A sleeve only where it reaches below the skin.
  const sleeveZ = f.sleeveZ !== undefined && f.sleeveZ < ceiling - MIN_TOOL ? f.sleeveZ : undefined;
  const z0 = ceiling - OVERSHOOT;
  const edge = f.role === 'outlet' ? style.openingEdge(ctx, f) : PASSTHROUGH_EDGE;
  const clear = localFace(style, ctx, f.placed).max + OVERSHOOT;
  const add: Manifold[] = [];
  if (sleeveZ !== undefined) {
    const sleeve = offsetPlaced(f.placed, frame.minWall);
    add.push(kit.prism(sleeve, sleeveZ, localFace(style, ctx, sleeve).max + OVERSHOOT));
  }
  const through = kit.prism(f.placed, (sleeveZ ?? ceiling) - OVERSHOOT, clear);
  return { add, subtract: [...faceCut(kit, style, ctx, f.placed, z0, edge), through] };
};
