/**
 * "stepped" — architectural, tiered cover: 2–3 concentric tiers, the widest at the base, the
 * narrowest carrying the face at frontZ; openings get a counterbore step.
 *
 * Body = union of one hull (straight prism) per tier: tier i is the outline inset by
 * i·stepInset, rising to frontZ − (tiers−1−i)·stepH. Tier i > 0 starts just below the top of
 * tier i−1 (no coplanar faces in the union). The lower tiers' treads sit below the straight
 * cavity prism's ceiling, so `decorate().add` returns the shell fill (common/profile.ts).
 *
 * Finger notches may sit in the tier zone (allowsNotchInEdge): a notch that crosses a tier's
 * edge simply bites into that step; one that ends inside a tier's edge by less than minWall would
 * leave a fin of tier wall between the notch and the step, so `decorate().subtract` opens the
 * notch into the step there (`notchBreakouts`).
 */
import type { CrossSection, Manifold } from 'manifold-3d';
import { z } from 'zod';
import type { CoverFrame, CoverStyle, EdgeProfile, Placed, ResolvedFeature, StyleCtx, Vec3 } from '../../geometry/contract';
import { OVERSHOOT } from '../../geometry/kit/kit';
import { containmentMargin, offsetPlaced, outwardDirection, shapeCore } from '../../geometry/shape2d';
import { availableEdgeRoom, bodyPlaced, edgeWidth, insideDistance, type EdgeWants } from '../common/frame';
import { NO_WALLS, shellFill, type Walls } from '../common/profile';

const TIERS_MIN = 2;
const TIERS_MAX = 3;
/** Each tier above the first starts this far below the top of the tier beneath it (mm, max). */
const TIER_OVERLAP = 1;
/** Features keep this much flat top tier around them (mm), see limits. */
const TOP_MARGIN = 2;
/** Height reserve below the lowest tread (mm), see limits. */
const BASE_RESERVE = 6;
const OPENING_STEP = { inset: 2, depth: 1.5 };
const POCKET_CHAMFER = 0.6;

const params = z.object({
  tiers: z.number().int().min(TIERS_MIN).max(TIERS_MAX).default(2),
  stepH: z.number().min(1).max(5).default(2.5),
  stepInset: z.number().min(2).max(12).default(5),
  cornerR: z.number().min(0).max(20).default(6),
});

export type SteppedParams = z.infer<typeof params>;
type Ctx = StyleCtx<SteppedParams>;

interface Tier {
  inset: number;
  top: number;
}

interface Shape {
  body: Placed;
  /** Bottom (widest) tier first. */
  tiers: Tier[];
  /** The top tier's outline (where features sit). */
  plateau: Placed;
}

function shapeOf(frame: CoverFrame, p: SteppedParams): Shape {
  const body = bodyPlaced(frame, p.cornerR);
  const n = Math.min(TIERS_MAX, Math.max(TIERS_MIN, Math.round(p.tiers)));
  const half = Math.min(frame.outer.w, frame.outer.h) / 2;
  const stepInset = Math.max(0, Math.min(p.stepInset, (half - 1) / (n - 1)));
  const stepH = Math.max(0, Math.min(p.stepH, (frame.frontZ - 2) / n));
  const tiers = Array.from({ length: n }, (_, i) => ({ inset: i * stepInset, top: frame.frontZ - (n - 1 - i) * stepH }));
  return { body, tiers, plateau: offsetPlaced(body, -tiers[n - 1].inset) };
}

/** The full-size edge profiles (what the style draws when there is room; see availableEdgeRoom). */
export function steppedFullEdges(): { opening: EdgeProfile; pocket: EdgeProfile } {
  return { opening: { kind: 'step', ...OPENING_STEP }, pocket: { kind: 'chamfer', size: POCKET_CHAMFER } };
}

const WANTS: EdgeWants = { opening: OPENING_STEP.inset, pocket: POCKET_CHAMFER };

/**
 * Inverse of the tiers' drop below the face: the inset of the first tier whose tread is at most
 * `drop` below frontZ (tier i: inset i·stepInset, drop (tiers − 1 − i)·stepH). Uses the raw
 * params; the body clamps both to the frame, which only makes the tiers shallower and narrower.
 */
export function tierInset(p: SteppedParams, drop: number): number {
  const n = Math.min(TIERS_MAX, Math.max(TIERS_MIN, Math.round(p.tiers)));
  for (let i = 0; i < n; i++) if ((n - 1 - i) * p.stepH <= drop + 1e-9) return i * p.stepInset;
  return (n - 1) * p.stepInset;
}

/**
 * The body offset inward by `walls` (NO_WALLS → the outer body with its base at z = 0; any
 * other walls start 0.1 mm below the base). Exported for tests and the shell fill.
 */
export function steppedBody({ frame, params: p, kit }: Ctx, walls: Walls): Manifold {
  const s = shapeOf(frame, p);
  const outer = walls.side === 0 && walls.top === 0;
  const parts: Manifold[] = [];
  let zLo = outer ? 0 : -OVERSHOOT;
  for (const t of s.tiers) {
    const zTop = t.top - walls.top;
    if (!(zTop > zLo + 1e-6)) break;
    const d = t.inset + walls.side;
    parts.push(kit.hull([...kit.ring(s.body, d, zLo), ...kit.ring(s.body, d, zTop)]));
    zLo = zTop - Math.min(TIER_OVERLAP, (zTop - zLo) / 2);
  }
  if (parts.length === 0) return kit.hull([]);
  return parts.length === 1 ? parts[0] : kit.wasm.Manifold.union(parts);
}

/** Pocket rim chamfer, shrunk to the room there is (a safety net for hand-placed layouts). */
function pocketEdgeOf({ frame, params: p }: Ctx, f: ResolvedFeature): EdgeProfile {
  return { kind: 'chamfer', size: Math.min(POCKET_CHAMFER, availableEdgeRoom(frame, f, shapeOf(frame, p).plateau, WANTS)) };
}

/** Slots shorter than this (mm) are not worth a tool. */
const MIN_SLOT = 0.3;

/**
 * Finger notches that end inside an upper tier's edge by less than minWall (see the file header):
 * the fin of tier wall between the notch and the step is cut away, so the notch opens into the
 * step. The slot is the strip of the notch's width running from its centre outward, clipped to
 * the notch's backing footprint (notch + minWall) and to the tier, from the tread below up
 * through the tier's top, with the notch's rim chamfer continued along its whole boundary. Clipped
 * like that it only removes wall thinner than ≈ minWall, its floor rests on the backing and the
 * tread beyond the step stays untouched. It is cut only where the tread below is at or above the
 * cavity ceiling (the solid skin), so it can never meet the hollow; deeper fins (tall steps,
 * three tiers) are left standing. A notch that crosses the edge bites into the step by itself.
 * Exported for tests.
 */
export function notchBreakouts(c: Ctx, s: Shape = shapeOf(c.frame, c.params)): Manifold[] {
  const { frame, kit } = c;
  const ceiling = frame.frontZ - frame.skinT;
  const tools: Manifold[] = [];
  for (const f of frame.features) {
    if (f.kind !== 'pocket' || !f.notch) continue;
    const R = shapeCore(f.notch.shape).r;
    if (!(R > 0)) continue;
    const chamfer = edgeWidth(pocketEdgeOf(c, f));
    const backing = offsetPlaced(f.notch, frame.minWall);
    for (let i = 1; i < s.tiers.length; i++) {
      const tier = offsetPlaced(s.body, -s.tiers[i].inset);
      const m = containmentMargin(f.notch, tier);
      if (!(m > 1e-6 && m < frame.minWall - 1e-6)) continue;
      const zTop = s.tiers[i].top;
      const zBottom = s.tiers[i - 1].top;
      if (zBottom < ceiling - 1e-6 || !(zTop - zBottom > MIN_SLOT)) continue;
      const [ux, uy] = outwardDirection(tier, [f.notch.x, f.notch.y]);
      const reach = 2 * R + frame.minWall; // past the step; the clips bound it
      const strip: Placed = {
        shape: { kind: 'roundedRect', w: 2 * R, h: reach, r: 0 },
        x: f.notch.x + (ux * reach) / 2,
        y: f.notch.y + (uy * reach) / 2,
        rotDeg: (Math.atan2(uy, ux) * 180) / Math.PI - 90,
      };
      const region = kit.cross(strip).intersect(kit.cross(backing)).intersect(kit.cross(tier));
      if (region.isEmpty()) continue;
      const ring = (cs: CrossSection, z: number): Vec3[] => cs.toPolygons().flat().map(([x, y]) => [x, y, z]);
      const cz = Math.min(chamfer, zTop - zBottom - MIN_SLOT);
      const pts = ring(region, zBottom);
      if (cz > 1e-6) {
        pts.push(...ring(region, zTop - cz));
        pts.push(...ring(region.offset(cz + OVERSHOOT, 'Round', 2, kit.segments(cz + OVERSHOOT)), zTop + OVERSHOOT));
      } else {
        pts.push(...ring(region, zTop + OVERSHOOT));
      }
      tools.push(kit.hull(pts)); // the region is convex (rectangle ∩ disc ∩ rounded rect)
    }
  }
  return tools;
}

export const steppedStyle: CoverStyle<typeof params> = {
  id: 'stepped',
  version: 1,
  label: 'Stepped',
  description:
    'Architectural, tiered cover: two or three concentric steps rising to the face, with counterbored socket openings.',
  params,
  ui: {
    tiers: { label: 'Tiers', min: TIERS_MIN, max: TIERS_MAX, step: 1 },
    stepH: { label: 'Step height', min: 1, max: 5, step: 0.1, unit: 'mm' },
    stepInset: { label: 'Step inset', min: 2, max: 12, step: 0.5, unit: 'mm' },
    cornerR: { label: 'Corner radius', min: 0, max: 20, step: 0.5, unit: 'mm' },
  },
  printOrientation: 'faceUp',
  printHint:
    'Print face up: face down, every tier above the first would start in mid-air. The pockets then open upwards and need no supports; support the cavity ceiling from the build plate (tree supports work well).',
  // A finger notch may open into the step (see notchBreakouts) instead of growing the cover.
  allowsNotchInEdge: true,
  limits: (p) => ({
    // Pockets and openings stay on the top tier with a 2 mm flat margin (finger notches may
    // enter the tier zone: allowsNotchInEdge).
    minFrame: (p.tiers - 1) * p.stepInset + TOP_MARGIN,
    minFrontZ: p.tiers * p.stepH + BASE_RESERVE,
    // Edges are square steps, not rounded.
    maxEdgeR: 0,
    // Full-size counterbore step and pocket chamfer (the resolver spaces features by them).
    edgeAllowance: OPENING_STEP.inset,
    pocketEdgeAllowance: POCKET_CHAMFER,
    cornerR: p.cornerR,
    // The plate stays under the tiers that are high enough.
    edgeInset: (drop) => tierInset(p, drop),
  }),
  surfaceZ: ({ frame, params: p }, x, y) => {
    const s = shapeOf(frame, p);
    for (let i = s.tiers.length - 1; i > 0; i--) {
      if (insideDistance(offsetPlaced(s.body, -s.tiers[i].inset), [x, y]) >= -1e-9) return s.tiers[i].top;
    }
    return s.tiers[0].top;
  },
  outerBody: (c) => steppedBody(c, NO_WALLS),
  decorate: (c) => {
    const s = shapeOf(c.frame, c.params);
    const add = shellFill(c.kit, c.frame, (w) => steppedBody(c, w), s.tiers[0].top - c.frame.skinT - 1);
    const slots = notchBreakouts(c, s);
    const subtract = slots.length === 0 ? undefined : slots.length === 1 ? slots[0] : c.kit.wasm.Manifold.union(slots);
    return { ...(add ? { add } : {}), ...(subtract ? { subtract } : {}) };
  },
  // Shrink to fit is a safety net (dx/dy, manual layouts): the resolver leaves room for full size.
  openingEdge: ({ frame, params: p }, f): EdgeProfile => ({
    kind: 'step',
    inset: Math.min(OPENING_STEP.inset, availableEdgeRoom(frame, f, shapeOf(frame, p).plateau, WANTS)),
    depth: OPENING_STEP.depth,
  }),
  pocketEdge: pocketEdgeOf,
};
