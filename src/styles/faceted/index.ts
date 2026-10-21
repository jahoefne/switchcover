/**
 * "faceted" — crisp, futuristic cover: an exact mitred bevel frame (width × angle) around a
 * flat plateau, an optional thin shadow groove on the plateau, chamfered openings.
 *
 * Body = hull of three rings: base (inset 0), bevel foot (inset 0, z = frontZ − bevelW·tan A)
 * and plateau edge (inset bevelW, z = frontZ). The bevel would cut into the straight cavity
 * prism, so `decorate().add` returns the shell fill (common/profile.ts); the groove is
 * `decorate().subtract`.
 */
import type { Manifold } from 'manifold-3d';
import { z } from 'zod';
import type { CoverFrame, CoverStyle, EdgeProfile, Placed, StyleCtx, Vec2 } from '../../geometry/contract';
import { OVERSHOOT } from '../../geometry/kit/kit';
import { offsetPlaced } from '../../geometry/shape2d';
import { bodyPlaced, cornerFrame, edgeRoom } from '../common/frame';
import { NO_WALLS, offsetProfile, profileRings, shellFill, type Walls } from '../common/profile';

const DEG = Math.PI / 180;
/** The groove starts this far inside the plateau edge (mm). */
const GROOVE_GAP = 1.5;
/** Skin left under the groove (mm). */
const GROOVE_MIN_SKIN = 1;
/** Shallower grooves are skipped (mm). */
const GROOVE_MIN_DEPTH = 0.2;
/** Vertical side wall kept below the bevel (mm). */
const MIN_SIDE = 3;
const OPENING_CHAMFER = 3;
const POCKET_CHAMFER = 1;

const params = z.object({
  bevelW: z.number().min(3).max(15).default(7),
  bevelAngleDeg: z.number().min(25).max(60).default(45),
  /** Boolean: no `ui` entry (the contract's ui metadata is numeric). */
  groove: z.boolean().default(true),
  grooveW: z.number().min(0.6).max(3).default(1),
  grooveD: z.number().min(0.3).max(2).default(0.8),
  cornerR: z.number().min(0).max(20).default(3),
});

export type FacetedParams = z.infer<typeof params>;
type Ctx = StyleCtx<FacetedParams>;

interface Shape {
  body: Placed;
  bevelW: number;
  /** Effective bevel angle (rad) from the face plane. */
  angle: number;
  /** z of the bevel's foot on the side wall. */
  zFoot: number;
  /** Groove ring (outer edge inset, inner edge inset, depth) or null. */
  groove: { d0: number; d1: number; depth: number } | null;
  /** Where features may widen to: inside the groove (or the plateau without one). */
  plateau: Placed;
}

function shapeOf(frame: CoverFrame, p: FacetedParams): Shape {
  const body = bodyPlaced(frame, p.cornerR);
  const half = Math.min(frame.outer.w, frame.outer.h) / 2;
  const bevelW = Math.max(0, Math.min(p.bevelW, half - 1));
  const drop = Math.min(bevelW * Math.tan(p.bevelAngleDeg * DEG), frame.frontZ - 1);
  const angle = bevelW > 0 ? Math.atan2(drop, bevelW) : Math.PI / 2; // effective (after clamping)
  const d0 = bevelW + GROOVE_GAP;
  const d1 = d0 + p.grooveW;
  const depth = Math.min(p.grooveD, frame.skinT - GROOVE_MIN_SKIN);
  const groove = p.groove && depth >= GROOVE_MIN_DEPTH && d1 < half - 1 ? { d0, d1, depth } : null;
  return {
    body,
    bevelW,
    angle,
    zFoot: frame.frontZ - drop,
    groove,
    plateau: offsetPlaced(body, -(groove ? groove.d1 : bevelW)),
  };
}

const chainOf = (frame: CoverFrame, s: Shape): Vec2[] => [
  [0, 0],
  [0, s.zFoot],
  [s.bevelW, frame.frontZ],
];

/**
 * The body offset inward by `walls` (NO_WALLS → the outer body with its base at z = 0; any
 * other walls start 0.1 mm below the base). Exported for tests and the shell fill.
 */
export function facetedBody({ frame, params: p, kit }: Ctx, walls: Walls): Manifold {
  const s = shapeOf(frame, p);
  const outer = walls.side === 0 && walls.top === 0;
  const verts = offsetProfile(chainOf(frame, s), walls, outer ? 0 : -OVERSHOOT);
  return kit.hull(profileRings(kit, s.body, verts));
}

export const facetedStyle: CoverStyle<typeof params> = {
  id: 'faceted',
  version: 1,
  label: 'Faceted',
  description:
    'Crisp, futuristic cover: a mitred bevel frame around a flat face, an optional thin shadow groove and chamfered socket openings.',
  params,
  ui: {
    bevelW: { label: 'Bevel width', min: 3, max: 15, step: 0.5, unit: 'mm' },
    bevelAngleDeg: { label: 'Bevel angle', min: 25, max: 60, step: 1, unit: '°' },
    grooveW: { label: 'Groove width', min: 0.6, max: 3, step: 0.1, unit: 'mm' },
    grooveD: { label: 'Groove depth', min: 0.3, max: 2, step: 0.1, unit: 'mm' },
    cornerR: { label: 'Corner radius', min: 0, max: 20, step: 0.5, unit: 'mm' },
  },
  printOrientation: 'faceDown',
  printHint:
    'Print face down. Bevels of 45° and steeper print cleanly; shallower bevels overhang and need supports along the outer edge. Add supports inside the pockets (their floors bridge).',
  limits: (p, plate) => ({
    // Features stay clear of the bevel and the groove (constant, so toggling the groove keeps the size).
    minFrame: Math.max(p.bevelW + p.grooveW + 3, cornerFrame(p.cornerR, plate)),
    minFrontZ: p.bevelW * Math.tan(p.bevelAngleDeg * DEG) + MIN_SIDE,
    // Edges are mitred, not rounded.
    maxEdgeR: 0,
  }),
  surfaceZ: ({ frame }) => frame.frontZ,
  outerBody: (c) => facetedBody(c, NO_WALLS),
  decorate: (c) => {
    const { frame, kit } = c;
    const s = shapeOf(frame, c.params);
    // Lowest point where the inner bevel leaves the side wall (see offsetProfile).
    const tb = frame.skirtT * Math.sin(s.angle) ** 2 + frame.skinT * Math.cos(s.angle) ** 2;
    const zFrom = s.zFoot + frame.skirtT * Math.tan(s.angle) - tb / Math.cos(s.angle) - 1;
    const add = shellFill(kit, frame, (w) => facetedBody(c, w), zFrom);
    let subtract: Manifold | undefined;
    if (s.groove) {
      const { d0, d1, depth } = s.groove;
      const top = frame.frontZ + OVERSHOOT;
      subtract = kit
        .prism(offsetPlaced(s.body, -d0), frame.frontZ - depth, top)
        .subtract(kit.prism(offsetPlaced(s.body, -d1), frame.frontZ - depth - OVERSHOOT, top + OVERSHOOT));
    }
    return { ...(add ? { add } : {}), ...(subtract ? { subtract } : {}) };
  },
  openingEdge: ({ frame, params: p }, f): EdgeProfile => ({
    kind: 'chamfer',
    size: Math.min(OPENING_CHAMFER, edgeRoom(frame, f, shapeOf(frame, p).plateau)),
  }),
  pocketEdge: ({ frame, params: p }, f): EdgeProfile => ({
    kind: 'chamfer',
    size: Math.min(POCKET_CHAMFER, edgeRoom(frame, f, shapeOf(frame, p).plateau)),
  }),
};
