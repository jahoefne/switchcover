import type { CoverFrame, FeatureParts, Kit } from '../contract';
import { OVERSHOOT } from '../kit/kit';
import { outerPlaced } from '../../layout/resolve';

/** Top of the hollow cavity (underside of the face skin). */
export function cavityCeiling(frame: CoverFrame): number {
  return frame.frontZ - frame.skinT;
}

/**
 * The hollow shell: outer outline inset by skirtT, z ∈ [−OVERSHOOT, frontZ − skinT]. It is
 * open at the wall side (the base stays flat at z = 0 and only the skirt touches the wall).
 * The plate (+ clearance) fits inside it; that is a collision check, not the cavity itself,
 * so auto-grown covers stay hollow.
 */
export function cavity(kit: Kit, frame: CoverFrame): FeatureParts {
  return { subtract: [kit.prism(outerPlaced(frame, frame.skirtT), -OVERSHOOT, cavityCeiling(frame))] };
}
