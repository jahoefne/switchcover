/**
 * "stepped" — architectural, tiered cover: 2–3 concentric tiers, the widest at the base, the
 * narrowest carrying the face at frontZ; openings get a counterbore step.
 *
 * Body = union of one hull (straight prism) per tier: tier i is the outline inset by
 * i·stepInset, rising to frontZ − (tiers−1−i)·stepH. Tier i > 0 starts just below the top of
 * tier i−1 (no coplanar faces in the union). The lower tiers' treads sit below the straight
 * cavity prism's ceiling, so `decorate().add` returns the shell fill (common/profile.ts).
 */
import type { Manifold } from 'manifold-3d';
import { z } from 'zod';
import type { CoverFrame, CoverStyle, EdgeProfile, Placed, StyleCtx } from '../../geometry/contract';
import { OVERSHOOT } from '../../geometry/kit/kit';
import { offsetPlaced } from '../../geometry/shape2d';
import { bodyPlaced, cornerFrame, edgeRoom, insideDistance } from '../common/frame';
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
  limits: (p, plate) => ({
    // Features stay on the top tier with a 2 mm flat margin; corners as round as asked.
    minFrame: Math.max((p.tiers - 1) * p.stepInset + TOP_MARGIN, cornerFrame(p.cornerR, plate)),
    minFrontZ: p.tiers * p.stepH + BASE_RESERVE,
    // Edges are square steps, not rounded.
    maxEdgeR: 0,
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
    return add ? { add } : {};
  },
  openingEdge: ({ frame, params: p }, f): EdgeProfile => ({
    kind: 'step',
    inset: Math.min(OPENING_STEP.inset, edgeRoom(frame, f, shapeOf(frame, p).plateau)),
    depth: OPENING_STEP.depth,
  }),
  pocketEdge: ({ frame, params: p }, f): EdgeProfile => ({
    kind: 'chamfer',
    size: Math.min(POCKET_CHAMFER, edgeRoom(frame, f, shapeOf(frame, p).plateau)),
  }),
};
