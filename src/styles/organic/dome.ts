/**
 * Dome of the organic style's face.
 *
 * The plan asks for z = frontZ + sag·(1−u²)(1−v²) over the plateau (u, v ∈ [−1, 1]). That
 * product is NOT concave towards the plateau corners (Hessian indefinite once
 * (1−u²)(1−v²) < 4u²v²), so a convex hull of samples cannot follow it: the hull fills the
 * dips and ends up to 0.11·sag higher than the formula (0.32 mm at sag 3, around u = v = 0.8).
 * The dome therefore uses the formula's exact CONCAVE ENVELOPE (the smallest concave function
 * ≥ it), which is what a hull of the formula's points converges to anyway:
 *
 *   a = 1−|u|, b = 1−|v|;  E = a·b·T·(2 − T·a)·(2 − T·b),
 *   T = max(1, t*),  t* = 2·((a+b) − √(a² − ab + b²)) / (3ab).
 *
 * With T = 1 this IS (1−u²)(1−v²) (the middle of the plateau). Where t* > 1 the envelope is a
 * cone from the nearest plateau corner: E(q) = max_t f(c + t(q − c))/t, maximised in closed
 * form. Concavity is affine-invariant, so E holds for any plateau aspect ratio. Sampling E and
 * hulling reproduces it to the chord error, and `surfaceZ` returns the same E, so the two agree.
 * Near the plateau's rounded corners the hull dips slightly below E (the true corner is cut
 * off), i.e. surfaceZ errs on the high side there, which is the safe side for cutting tools.
 */
import type { Placed, Vec3 } from '../../geometry/contract';
import { insideDistance } from '../common/frame';

/** Normalised dome height in [0, 1] at (u, v) ∈ [−1, 1]² (0 on and outside the boundary). */
export function domeEnvelope(u: number, v: number): number {
  const a = 1 - Math.min(1, Math.abs(u));
  const b = 1 - Math.min(1, Math.abs(v));
  if (a <= 0 || b <= 0) return 0;
  const tStar = (2 * (a + b - Math.sqrt(a * a - a * b + b * b))) / (3 * a * b);
  const t = Math.max(1, tStar);
  return a * b * t * (2 - t * a) * (2 - t * b);
}

/** Half extents of the dome's (u, v) normalisation: the plateau's bounding box. */
export function domeExtents(plateau: Placed): { hx: number; hy: number } {
  if (plateau.shape.kind !== 'roundedRect') throw new Error('dome plateau must be a rounded rect');
  return { hx: plateau.shape.w / 2, hy: plateau.shape.h / 2 };
}

/** Dome height above frontZ at world (x, y) for a plateau and sag (0 outside the plateau box). */
export function domeHeight(plateau: Placed, sag: number, x: number, y: number): number {
  if (!(sag > 0)) return 0;
  const { hx, hy } = domeExtents(plateau);
  if (!(hx > 0 && hy > 0)) return 0;
  return sag * domeEnvelope((x - plateau.x) / hx, (y - plateau.y) / hy);
}

/**
 * Grid of dome points strictly inside the plateau at z = baseZ + dome height (n × n, n odd so
 * the apex is sampled exactly).
 */
export function domePoints(plateau: Placed, sag: number, baseZ: number, n: number): Vec3[] {
  const { hx, hy } = domeExtents(plateau);
  const pts: Vec3[] = [];
  if (!(sag > 0 && hx > 0 && hy > 0)) return pts;
  const m = n % 2 === 1 ? n : n + 1;
  for (let i = 0; i < m; i++) {
    const u = -1 + (2 * i) / (m - 1);
    for (let j = 0; j < m; j++) {
      const v = -1 + (2 * j) / (m - 1);
      const x = plateau.x + u * hx;
      const y = plateau.y + v * hy;
      if (insideDistance(plateau, [x, y]) <= 1e-6) continue; // the top ring covers the boundary
      pts.push([x, y, baseZ + sag * domeEnvelope(u, v)]);
    }
  }
  return pts;
}
