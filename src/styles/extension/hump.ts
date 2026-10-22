/**
 * The raised rim of an extension plate's pocket (pure TS, shared by the style's body and its
 * surfaceZ, so the two agree exactly).
 *
 * Section through the slab and one pocket (rise = rimZ − faceZ, flare = part.flare):
 *
 *                 ┌── rim (minWall wide) ──┐
 *   rimZ    ──────┤                        ├──────╮
 *                 │  pocket void           │       ╲   cove: quarter ellipse, vertical at the
 *                 │  (features/pocket.ts)  │        ╲  rim, horizontal at its foot on the face
 *   faceZ   ══════╪════════════════════════╪═════════╲═══════════════ slab face
 *                 │                        │          ← flare →
 *   floorZ  ──────┴────────────────────────┴──────
 *                        strip indent
 *   0       ════════════════════════════════════════════════════════ wall
 *
 * Measured outward from the pocket outline: 0 … minWall is the rim top (rimZ); minWall … minWall +
 * flare is the cove, z = faceZ + rise · (1 − sin θ) with the outward offset flare · (1 − cos θ)
 * (θ = 0 at the rim, π/2 at the foot); beyond it the face (faceZ). Where humps overlap, the
 * higher one wins (the lofts are unioned).
 */
import type { CoverFrame, LoftSlice, Placed } from '../../geometry/contract';
import { insideDistance } from '../../geometry/shape2d';

/** Height of the cove `t` mm outside the rim (0 ≤ t ≤ flare) for a rim `rise` above faceZ. */
export function coveZ(faceZ: number, rise: number, flare: number, t: number): number {
  if (!(rise > 0) || t >= flare) return faceZ;
  if (t <= 0) return faceZ + rise;
  const c = 1 - t / flare; // cos θ
  return faceZ + rise * (1 - Math.sqrt(1 - c * c));
}

/** The local face over (x, y): the highest rim or cove there, else the slab's face (frontZ). */
export function humpSurfaceZ(frame: CoverFrame, x: number, y: number): number {
  const faceZ = frame.frontZ;
  if (frame.part.kind !== 'extension') return faceZ;
  const { flare } = frame.part;
  let z = faceZ;
  for (const f of frame.features) {
    if (f.kind !== 'pocket' || f.rimZ === undefined || f.rimZ <= faceZ + 1e-9) continue;
    const outside = -insideDistance(f.placed, [x, y]); // ≤ 0 inside the pocket outline
    const t = outside - frame.minWall;
    const h = t <= 0 ? f.rimZ : coveZ(faceZ, f.rimZ - faceZ, flare, t);
    if (h > z) z = h;
  }
  return z;
}

/**
 * Loft slices (outward offsets of the pocket outline) of one rim + cove: a vertical foot `foot`
 * mm into the slab, the cove in `segments` steps, the rim top. Strictly increasing in z.
 */
export function humpSlices(faceZ: number, rimZ: number, minWall: number, flare: number, segments: number, foot: number): LoftSlice[] {
  const rise = rimZ - faceZ;
  const slices: LoftSlice[] = [{ z: faceZ - foot, offset: minWall + flare }];
  if (flare > 1e-6 && rise > 1e-6) {
    for (let i = 1; i < segments; i++) {
      const th = (Math.PI / 2) * (1 - i / segments); // π/2 (foot) → 0 (rim)
      slices.push({ z: faceZ + rise * (1 - Math.sin(th)), offset: minWall + flare * (1 - Math.cos(th)) });
    }
  }
  slices.push({ z: rimZ, offset: minWall });
  return slices;
}

/** Outline of a pocket's cove foot (pocket + rim + flare): what the rim needs on the face. */
export function humpFoot(frame: CoverFrame, placed: Placed): Placed {
  const flare = frame.part.kind === 'extension' ? frame.part.flare : 0;
  const { shape } = placed;
  const grow = frame.minWall + flare;
  return {
    ...placed,
    shape:
      shape.kind === 'circle'
        ? { kind: 'circle', d: shape.d + 2 * grow }
        : shape.kind === 'stadium'
          ? { kind: 'stadium', w: shape.w + 2 * grow, h: shape.h + 2 * grow }
          : { kind: 'roundedRect', w: shape.w + 2 * grow, h: shape.h + 2 * grow, r: shape.r + grow },
  };
}
