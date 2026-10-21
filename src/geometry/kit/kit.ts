/**
 * The geometry kit: small, well-tested helpers on top of manifold-3d that every feature
 * and style uses. See src/geometry/README.md for the rules they encode.
 *
 * Every helper deletes its own intermediates and returns a fresh object that is tracked by
 * the active scope (kit/scope.ts), so callers only manage what they get back.
 */
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { EdgeProfile, Kit, LoftSlice, Placed, Quality, Vec2, Vec3 } from '../contract';
import { outlineWorld, offsetPlaced, shapeCore } from '../shape2d';
import { keep } from './scope';

/** Every cutting tool overshoots the surfaces it cuts by this much (mm). */
export const OVERSHOOT = 0.1;

/** Global circular resolution per quality (manifold-3d's setMinCircularAngle / EdgeLength). */
export const QUALITY_PRESETS: Record<Quality, { minAngle: number; minEdgeLength: number }> = {
  preview: { minAngle: 10, minEdgeLength: 1 },
  export: { minAngle: 3, minEdgeLength: 0.4 },
};

/** Quality currently applied to manifold-3d's global circular defaults (per WASM instance). */
const activeQuality = new WeakMap<ManifoldToplevel, Quality>();

/**
 * Set manifold-3d's GLOBAL circular resolution. Kits re-apply their own quality lazily
 * before computing segment counts, so several kits with different qualities can coexist.
 */
export function applyQuality(wasm: ManifoldToplevel, quality: Quality): void {
  const q = QUALITY_PRESETS[quality];
  wasm.setMinCircularAngle(q.minAngle);
  wasm.setMinCircularEdgeLength(q.minEdgeLength);
  activeQuality.set(wasm, quality);
}

/** One profile point of an edge tool: OUTWARD offset of the outline at height z. */
type ProfilePoint = LoftSlice;

/**
 * Outward-offset profile of an edge tool from the bottom (zTop − through − OVERSHOOT) to
 * the top (zTop + OVERSHOOT), strictly increasing in z. `null` = straight (sharp) cut.
 * 'step' is not monotone and is handled separately.
 */
function edgeProfile(edge: EdgeProfile, zTop: number, through: number, arcSegments: (r: number) => number): ProfilePoint[] | null {
  const zb = zTop - through - OVERSHOOT;
  const zt = zTop + OVERSHOOT;
  switch (edge.kind) {
    case 'sharp':
      return null;
    case 'chamfer': {
      const s = Math.min(edge.size, through);
      if (s <= 1e-6) return null;
      return [
        { z: zb, offset: 0 },
        { z: zTop - s, offset: 0 },
        { z: zt, offset: s + OVERSHOOT },
      ];
    }
    case 'fillet':
    case 'flare': {
      const r = edge.r;
      const depth = Math.min(edge.kind === 'fillet' ? edge.r : edge.depth, through);
      if (r <= 1e-6 || depth <= 1e-6) return null;
      // Quarter ellipse: radial semi-axis r, vertical semi-axis depth (fillet: depth = r).
      const n = Math.max(2, Math.ceil(arcSegments(Math.max(r, depth)) / 4));
      const pts: ProfilePoint[] = [{ z: zb, offset: 0 }];
      for (let i = 0; i <= n; i++) {
        const phi = ((Math.PI / 2) * i) / n;
        pts.push({ z: zTop - depth + depth * Math.sin(phi), offset: r - r * Math.cos(phi) });
      }
      pts.push({ z: zt, offset: r + OVERSHOOT });
      return pts;
    }
    case 'step':
      throw new Error('edgeProfile: step is handled separately');
  }
}

function assertIncreasing(slices: LoftSlice[]): void {
  if (slices.length < 2) throw new RangeError('loft needs at least two slices');
  for (let i = 1; i < slices.length; i++) {
    if (!(slices[i].z > slices[i - 1].z)) throw new RangeError('loft slices must have strictly increasing z');
  }
}

export function createKit(wasm: ManifoldToplevel, quality: Quality = 'preview'): Kit {
  applyQuality(wasm, quality);
  const { Manifold, CrossSection } = wasm;

  const segments = (r: number): number => {
    if (activeQuality.get(wasm) !== quality) applyQuality(wasm, quality);
    if (!(r > 1e-6)) return 4;
    const n = wasm.getCircularSegments(r);
    return Math.max(4, Math.ceil(n / 4) * 4);
  };

  /** Segments for an outline at inset (consistent for all insets with the same max radius). */
  const segmentsFor = (p: Placed, inset: number): number => {
    const r = shapeCore(p.shape).r;
    return segments(Math.max(r, r - inset));
  };

  const ring = (p: Placed, inset: number, z: number, n?: number): Vec3[] =>
    outlineWorld(p, inset, n ?? segmentsFor(p, inset)).map(([x, y]) => [x, y, z] as Vec3);

  const crossOf = (poly: Vec2[]): CrossSection =>
    poly.length < 3 ? CrossSection.square(0) : new CrossSection([poly]);

  const cross = (p: Placed): CrossSection => keep(crossOf(outlineWorld(p, 0, segmentsFor(p, 0))));

  const hull = (pts: Vec3[]): Manifold => keep(Manifold.hull(pts));

  const prism = (p: Placed, z0: number, z1: number): Manifold => {
    if (!(z1 > z0)) throw new RangeError(`prism: z1 (${z1}) must be > z0 (${z0})`);
    const cs = cross(p);
    const ext = cs.extrude(z1 - z0);
    const out = ext.translate([0, 0, z0]);
    cs.delete();
    ext.delete();
    return keep(out);
  };

  const loft = (p: Placed, slices: LoftSlice[]): Manifold => {
    assertIncreasing(slices);
    const r = shapeCore(p.shape).r;
    const n = segments(Math.max(r, ...slices.map((s) => r + s.offset)));
    const rings = slices.map((s) => ring(p, -s.offset, s.z, n));
    const parts: Manifold[] = [];
    for (let i = 0; i + 1 < rings.length; i++) parts.push(Manifold.hull([...rings[i], ...rings[i + 1]]));
    if (parts.length === 1) return keep(parts[0]);
    const out = Manifold.union(parts);
    for (const m of parts) m.delete();
    return keep(out);
  };

  /** Revolve an (offset, z) profile around the circle's centre. */
  const revolveCircle = (p: Placed, radius: number, profile: Vec2[]): Manifold => {
    const cs = new CrossSection([profile]);
    const rev = cs.revolve(segments(radius));
    const out = rev.translate([p.x, p.y, 0]);
    cs.delete();
    rev.delete();
    return keep(out);
  };

  const edgeTool = (p: Placed, zTop: number, edge: EdgeProfile, through: number): Manifold => {
    if (!(through > 0)) throw new RangeError('edgeTool: through must be > 0');
    const zb = zTop - through - OVERSHOOT;
    const zt = zTop + OVERSHOOT;
    const isCircle = p.shape.kind === 'circle';
    const R = isCircle ? (p.shape as { d: number }).d / 2 : 0;

    if (edge.kind === 'step') {
      const depth = Math.min(edge.depth, through);
      const inset = edge.inset;
      if (depth <= 1e-6 || inset <= 1e-6) return prism(p, zb, zt);
      if (isCircle) {
        return revolveCircle(p, R + inset, [
          [0, zb],
          [R, zb],
          [R, zTop - depth],
          [R + inset, zTop - depth],
          [R + inset, zt],
          [0, zt],
        ]);
      }
      const a = prism(p, zb, zt);
      const b = prism(offsetPlaced(p, inset), zTop - depth, zt);
      const out = a.add(b);
      a.delete();
      b.delete();
      return keep(out);
    }

    const profile = edgeProfile(edge, zTop, through, segments);
    if (!profile) return prism(p, zb, zt);
    if (isCircle) {
      const pts: Vec2[] = [[0, zb], ...profile.map((s) => [R + s.offset, s.z] as Vec2), [0, zt]];
      return revolveCircle(p, R, pts);
    }
    return loft(p, profile);
  };

  return { wasm, quality, keep, segments, cross, hull, ring, loft, edgeTool, prism };
}
