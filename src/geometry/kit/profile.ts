/**
 * Profile bodies and shell repair for styles whose outer surface is not a straight prism
 * (organic fillet, faceted bevel, stepped tiers).
 *
 * A style body is a hull of rings (`kit.ring(outline, d, z)`) at the vertices of a convex
 * PROFILE in (d, z): d = inset from the outline (0 = side wall, growing inward), z = height.
 * `offsetProfile` offsets that profile inward by wall thicknesses, which gives the body's
 * ideal inner surface (and, with tiny walls, a slightly shrunk body); `profileRings` turns the
 * vertices into hull points.
 *
 * Why styles need `shellFill`: the builder's cavity is a straight prism (frame outline inset
 * by skirtT, up to frontZ − skinT). Under a fillet, bevel or tier that prism comes closer to
 * the outer surface than the walls allow, or breaks through it (e.g. a 45° × 7 mm bevel cuts
 * 1.1 mm into the cavity; an 8 mm fillet leaves a 0.5 mm wall). `shellFill` returns the
 * material the prism removed there; styles hand it to the builder as `decorate().add`, which
 * is unioned after the cavity is subtracted.
 *
 * `plateClearZ` / `plateZone` describe the space the fill (and anything else inside the cavity)
 * must leave free over the plate.
 */
import type { Manifold } from 'manifold-3d';
import { outerPlaced } from '../../layout/resolve';
import type { CoverFrame, Kit, Placed, Vec2, Vec3 } from '../contract';
import { OVERSHOOT } from './kit';

export interface Walls {
  /** Thickness behind a vertical face. */
  side: number;
  /** Thickness under a horizontal face. */
  top: number;
}

export const NO_WALLS: Walls = { side: 0, top: 0 };
/** How far the shell fill overlaps the existing walls/ceiling (robust union). */
export const FILL_OVERLAP = 0.2;

interface Line {
  /** Outward unit normal in (d, z). */
  n: Vec2;
  /** Half-plane n · X ≤ c. */
  c: number;
}

const FAR = 1e4;
const EPS = 1e-9;

/** Wall thickness for a face with outward normal n: blends side (n = (−1, 0)) and top (n = (0, 1)). */
const thickness = (n: Vec2, w: Walls) => w.side * n[0] * n[0] + w.top * n[1] * n[1];

/**
 * Vertices of a convex profile offset inward by `walls`.
 *
 * `chain` runs from the side wall (d = 0) up/inward to the plateau edge (its last point); the
 * face continues horizontally inward from there. The profile is closed below by z ≥ zBottom,
 * which is NOT offset (the cavity is open at the base). With NO_WALLS and zBottom = 0 this
 * returns the chain itself (plus the base corner). Vertices are sorted by z, then d.
 */
export function offsetProfile(chain: Vec2[], walls: Walls, zBottom: number): Vec2[] {
  if (chain.length === 0) return [];
  const lines: Line[] = [];
  const addLine = (n: Vec2, p: Vec2, t: number) => {
    const len = Math.hypot(n[0], n[1]);
    if (len < 1e-12) return;
    const u: Vec2 = [n[0] / len, n[1] / len];
    lines.push({ n: u, c: u[0] * p[0] + u[1] * p[1] - t });
  };
  // Side wall first: an exactly vertical line through d = 0.
  addLine([-1, 0], [0, 0], walls.side);
  for (let i = 0; i + 1 < chain.length; i++) {
    const [d0, z0] = chain[i];
    const [d1, z1] = chain[i + 1];
    const n: Vec2 = [-(z1 - z0), d1 - d0];
    const len = Math.hypot(n[0], n[1]);
    if (len < 1e-12) continue;
    addLine(n, chain[i], thickness([n[0] / len, n[1] / len], walls));
  }
  addLine([0, 1], chain[chain.length - 1], walls.top); // the face
  addLine([0, -1], [0, zBottom], 0); // base, not offset
  addLine([1, 0], [FAR, 0], 0); // bound the half-plane intersection inward

  const out: Vec2[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      const det = a.n[0] * b.n[1] - a.n[1] * b.n[0];
      if (Math.abs(det) < 1e-12) continue;
      const d = (a.c * b.n[1] - b.c * a.n[1]) / det;
      const z = (a.n[0] * b.c - b.n[0] * a.c) / det;
      if (d > FAR - 1) continue;
      if (!lines.every((l) => l.n[0] * d + l.n[1] * z <= l.c + 1e-7)) continue;
      if (out.some(([od, oz]) => Math.abs(od - d) < 1e-7 && Math.abs(oz - z) < 1e-7)) continue;
      out.push([d + 0, z + 0]); // + 0 normalises −0
    }
  }
  return out.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
}

/** Rings of `outline` at every profile vertex (inset d, height z). */
export function profileRings(kit: Kit, outline: Placed, verts: Vec2[]): Vec3[] {
  const pts: Vec3[] = [];
  for (const [d, z] of verts) pts.push(...kit.ring(outline, d, z));
  return pts;
}

/**
 * Top of the space the cover must leave free over the plate: the plate + clearance, and the
 * rocker gap below every pocket floor (floorZ − floorT = plate depth + rockerGap for the
 * deepest pocket; see the resolver's height chain).
 */
export function plateClearZ(frame: CoverFrame): number {
  let z = frame.plate.protrusion + frame.plate.clearance;
  for (const f of frame.features) if (f.kind === 'pocket') z = Math.max(z, f.floorZ - frame.floorT);
  return z;
}

/** The plate grown by its clearance (in plan; see plateClearZ for its height), centred on the origin. */
export function plateZone(plate: CoverFrame['plate']): Placed {
  const c = plate.clearance;
  return {
    shape: { kind: 'roundedRect', w: plate.w + 2 * c, h: plate.h + 2 * c, r: plate.cornerR + c },
    x: 0,
    y: 0,
    rotDeg: 0,
  };
}

/** Builds the style body offset inward by `walls` (NO_WALLS = the outer body). */
export type BodyBuilder = (walls: Walls) => Manifold;

/**
 * Material the straight cavity prism wrongly removes under the styled edges (see file header):
 *   body ∩ (cavity prism grown by FILL_OVERLAP, z ∈ [zFrom, frontZ − skinT])
 *   − (plate + clearance, up to the rocker gap: plateClearZ) − (body offset inward by skirtT / skinT).
 * Where the prism pierces the skin, the fill reaches the outer surface exactly (bounded by the
 * same body), so the union closes the breach without a step.
 * `zFrom` is the lowest height at which the styled inner surface can leave the cavity wall.
 * Returns undefined when there is nothing to fill.
 */
export function shellFill(kit: Kit, frame: CoverFrame, build: BodyBuilder, zFrom: number): Manifold | undefined {
  const { skirtT, skinT, frontZ } = frame;
  const z1 = frontZ - skinT + FILL_OVERLAP;
  const z0 = Math.max(0, zFrom - FILL_OVERLAP);
  if (!(z1 > z0 + EPS)) return undefined;
  const side = Math.max(skirtT - FILL_OVERLAP, skirtT / 2);
  let band = kit.prism(outerPlaced(frame, side), z0, z1);
  const zClear = Math.min(plateClearZ(frame), z1 + OVERSHOOT);
  if (zClear > z0) band = band.subtract(kit.prism(plateZone(frame.plate), z0 - OVERSHOOT, zClear));
  const fill = build(NO_WALLS)
    .intersect(band)
    .subtract(build({ side: skirtT, top: skinT }));
  return fill.isEmpty() ? undefined : fill;
}
