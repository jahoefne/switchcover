/**
 * "minimal" — the reference style: a rounded-rect block with a 45° chamfer around the top
 * edge, flat face, chamfered opening and pocket edges. Printed face down.
 *
 * Body = hull of three rings of the outer outline (with the style's corner radius):
 *   z = 0 (full outline) · z = frontZ − chamfer (full outline) · z = frontZ (inset by chamfer).
 */
import { z } from 'zod';
import type { CoverFrame, CoverStyle, EdgeProfile, Placed, StyleLimits } from '../../geometry/contract';
import { outerPlaced } from '../../layout/resolve';

const params = z.object({
  /** Corner radius of the cover outline (mm). Large radii grow the frame just enough for the plate to fit the cavity's corner. */
  cornerR: z.number().min(0).max(40).default(4),
  /** 45° chamfer around the top edge (mm). */
  chamfer: z.number().min(0).max(3).default(1),
});

type MinimalParams = z.infer<typeof params>;

/** Largest top chamfer the body honours (also the slider max). */
const MAX_CHAMFER = 3;
/** Material kept (mm, measured at 45°) between the chamfer and the cavity's top outer edge. */
const CHAMFER_KEEP = 0.8;

/** Opening (outlet) and pocket rim chamfers (mm). */
const OPENING_CHAMFER = 1;
const POCKET_CHAMFER = 0.6;

/** The edge profiles (constant: the resolver leaves room for them, see limits). */
export function minimalFullEdges(): { opening: EdgeProfile; pocket: EdgeProfile } {
  return { opening: { kind: 'chamfer', size: OPENING_CHAMFER }, pocket: { kind: 'chamfer', size: POCKET_CHAMFER } };
}

/** Outer outline with the style's corner radius (never rounder than the frame's own outline). */
function outline(frame: CoverFrame, p: MinimalParams): Placed {
  const o = outerPlaced(frame);
  const r = Math.min(p.cornerR, frame.outer.cornerR, Math.min(frame.outer.w, frame.outer.h) / 2);
  return { ...o, shape: { kind: 'roundedRect', w: frame.outer.w, h: frame.outer.h, r } };
}

/** Effective chamfer: keeps CHAMFER_KEEP mm between the chamfer plane and the cavity corner. */
function chamferFor(frame: CoverFrame, p: MinimalParams): number {
  const keep = frame.skirtT + frame.skinT - CHAMFER_KEEP * Math.SQRT2;
  return Math.max(0, Math.min(p.chamfer, MAX_CHAMFER, keep, frame.frontZ / 2));
}

export const minimalStyle: CoverStyle<typeof params> = {
  id: 'minimal',
  version: 1,
  label: 'Minimal',
  description: 'Clean rounded block with a crisp chamfered top edge and chamfered cut-outs.',
  params,
  ui: {
    cornerR: { label: 'Corner radius', min: 0, max: 40, step: 0.5, unit: 'mm' },
    chamfer: { label: 'Top edge chamfer', min: 0, max: MAX_CHAMFER, step: 0.1, unit: 'mm', clampTo: 'maxEdgeR' },
  },
  printOrientation: 'faceDown',
  printHint:
    'Print face down: the flat face gives a clean finish and the pockets need no support. ' +
    'Enable supports for the pocket floors (bridges) if your printer bridges poorly.',
  limits: (p): StyleLimits => ({
    minFrame: 0,
    minFrontZ: 0,
    maxEdgeR: MAX_CHAMFER,
    // Keep minWall between the chamfered cut-outs at the face, not just below it.
    edgeAllowance: OPENING_CHAMFER,
    pocketEdgeAllowance: POCKET_CHAMFER,
    cornerR: p.cornerR,
  }),
  surfaceZ: (c) => c.frame.frontZ,
  outerBody: ({ frame, kit, params: p }) => {
    const o = outline(frame, p);
    const c = chamferFor(frame, p);
    const n = kit.segments(Math.max(o.shape.kind === 'roundedRect' ? o.shape.r : 0, 0));
    const top = frame.frontZ;
    if (c <= 1e-6) return kit.hull([...kit.ring(o, 0, 0, n), ...kit.ring(o, 0, top, n)]);
    return kit.hull([...kit.ring(o, 0, 0, n), ...kit.ring(o, 0, top - c, n), ...kit.ring(o, c, top, n)]);
  },
  openingEdge: () => minimalFullEdges().opening,
  pocketEdge: () => minimalFullEdges().pocket,
};
