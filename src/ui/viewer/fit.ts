/** Camera refit rule of the viewer (pure, no three.js, so it is testable in Node). */
import type { CoverFrame } from '../../geometry/contract';

/**
 * Whether the camera should refit for a new outline: never fitted yet, the size changed by more
 * than 15 %, or the (possibly off-centre, see CoverFrame.outer) centre moved by more than 15 % of
 * the size.
 */
export function needsRefit(
  [fw, fh, fcx, fcy]: readonly [number, number, number, number],
  outer: Pick<CoverFrame['outer'], 'w' | 'h' | 'cx' | 'cy'>,
): boolean {
  if (fw === 0) return true;
  const changed = (a: number, b: number) => Math.abs(a - b) > 0.15 * b;
  return changed(outer.w, fw) || changed(outer.h, fh) || Math.abs(outer.cx - fcx) > 0.15 * fw || Math.abs(outer.cy - fcy) > 0.15 * fh;
}
