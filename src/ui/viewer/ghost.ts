/**
 * Where the Bilresa ghost goes (pure, no three.js, shared with the geometry tests).
 *
 * The reference STLs (model/*.stl) have the FRONT face at z = 0 and the rounded body towards −z,
 * the back flat at z = −depth (−18.5) and the strip-recess rim 1 mm below it. That is already the
 * mounting orientation (back towards the wall), so the STL is NOT rotated about X/Y: it is moved
 * so its back flat lands on the pocket floor, i.e. by (pocket.x, pocket.y, floorZ + depth), and
 * turned by the pocket's rotDeg about +Z around the pocket centre.
 */
import { BILRESA_VARIANTS } from '../../config/defaults';
import type { ResolvedFeature, Vec3 } from '../../geometry/contract';

type Pocket = Extract<ResolvedFeature, { kind: 'pocket' }>;

export interface GhostPlacement {
  /** Translation applied after the rotation (mm). */
  position: Vec3;
  /** Rotation about +Z (degrees, CCW), applied first, about the STL origin (= the pocket centre). */
  rotZDeg: number;
}

export function bilresaGhostPlacement(f: Pick<Pocket, 'placed' | 'floorZ' | 'variant'>): GhostPlacement {
  return { position: [f.placed.x, f.placed.y, f.floorZ + BILRESA_VARIANTS[f.variant].depth], rotZDeg: f.placed.rotDeg };
}

/** A point of the reference STL, placed like the ghost. */
export function placeGhostPoint(g: GhostPlacement, [x, y, z]: Vec3): Vec3 {
  const a = (g.rotZDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s + g.position[0], x * s + y * c + g.position[1], z + g.position[2]];
}
