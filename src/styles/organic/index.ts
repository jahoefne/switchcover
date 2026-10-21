/**
 * "organic" — soft, pebble-like cover: large corner radius, quarter-round fillet from the side
 * wall into the face, optional gentle dome, flared outlet openings.
 *
 * Body = hull of rings along the fillet's circular profile (+ dome points). The fillet would
 * thin the shell over the straight cavity prism, so `decorate().add` returns the shell fill
 * (common/profile.ts).
 */
import type { Manifold } from 'manifold-3d';
import { z } from 'zod';
import type { CoverFrame, CoverStyle, EdgeProfile, Placed, StyleCtx, Vec2 } from '../../geometry/contract';
import { OVERSHOOT } from '../../geometry/kit/kit';
import { offsetPlaced } from '../../geometry/shape2d';
import { availableEdgeRoom, bodyPlaced, edgeWidth, insideDistance, type EdgeWants } from '../common/frame';
import { NO_WALLS, offsetProfile, profileRings, shellFill, type Walls } from '../common/profile';
import { domeHeight, domePoints } from './dome';

const EDGE_R_MAX = 14;
const DOME_SAG_MAX = 3;
/** Dome sample grid (per axis, odd). */
const DOME_GRID = 25;
/** Fillet rings (the plan asks for 8–12). */
const MIN_RINGS = 8;
const MAX_RINGS = 12;
/** Pocket rim fillet (mm). */
const POCKET_FILLET = 1.5;
/** Flares narrower than this become a plain fillet. */
const MIN_FLARE = 2;
/** Flare depth cap (mm). */
const MAX_FLARE_DEPTH = 6;

const params = z.object({
  cornerR: z.number().min(4).max(30).default(14),
  edgeR: z.number().min(2).max(EDGE_R_MAX).default(8),
  domeSag: z.number().min(0).max(DOME_SAG_MAX).default(0),
  flareR: z.number().min(0).max(12).default(6),
});

export type OrganicParams = z.infer<typeof params>;
type Ctx = StyleCtx<OrganicParams>;

interface Shape {
  body: Placed;
  /** Effective fillet radius (clamped to the frame). */
  edgeR: number;
  /** Flat (or domed) part of the face: body inset by edgeR. */
  plateau: Placed;
  sag: number;
}

function shapeOf(frame: CoverFrame, p: OrganicParams): Shape {
  const body = bodyPlaced(frame, p.cornerR);
  const { w, h } = frame.outer;
  const edgeR = Math.max(0, Math.min(p.edgeR, frame.frontZ - 1, Math.min(w, h) / 2 - 1));
  return {
    body,
    edgeR,
    plateau: offsetPlaced(body, -edgeR),
    sag: Math.max(0, Math.min(p.domeSag, DOME_SAG_MAX)),
  };
}

/** Opening edge for a flare radius r: a flare, or a plain fillet when r is too small for one. */
function flareEdge(r: number): EdgeProfile {
  if (r < MIN_FLARE) return { kind: 'fillet', r };
  return { kind: 'flare', r, depth: Math.min(r, MAX_FLARE_DEPTH) };
}

/** The full-size edge profiles (what the style draws when there is room; see availableEdgeRoom). */
export function organicFullEdges(p: OrganicParams): { opening: EdgeProfile; pocket: EdgeProfile } {
  return { opening: flareEdge(p.flareR), pocket: { kind: 'fillet', r: POCKET_FILLET } };
}

const wantsOf = (p: OrganicParams): EdgeWants => {
  const e = organicFullEdges(p);
  return { opening: edgeWidth(e.opening), pocket: edgeWidth(e.pocket) };
};

/**
 * Inverse of the fillet's drop below the face: the inset beyond which the quarter round of
 * radius r is at most `drop` below frontZ (drop(d) = r − √(r² − (r − d)²) for d ≤ r).
 */
export function filletInset(r: number, drop: number): number {
  if (!(r > 0)) return 0;
  if (!(drop > 0)) return r;
  if (drop >= r) return 0;
  return r - Math.sqrt(r * r - (r - drop) * (r - drop));
}

/** Side wall from the base, then the quarter round: inset = R − R·cos θ, z = frontZ − R + R·sin θ. */
function filletChain(frontZ: number, r: number, rings: number): Vec2[] {
  const chain: Vec2[] = [[0, 0]];
  if (r <= 1e-6) return [...chain, [0, frontZ]];
  for (let i = 0; i <= rings; i++) {
    const th = ((Math.PI / 2) * i) / rings;
    chain.push([r - r * Math.cos(th), frontZ - r + r * Math.sin(th)]);
  }
  return chain;
}

/**
 * The body offset inward by `walls` (NO_WALLS → the outer body with its base at z = 0; any
 * other walls start 0.1 mm below the base). Exported for tests and the shell fill.
 */
export function organicBody({ frame, params: p, kit }: Ctx, walls: Walls): Manifold {
  const s = shapeOf(frame, p);
  const rings = Math.min(MAX_RINGS, Math.max(MIN_RINGS, Math.ceil(kit.segments(s.edgeR) / 4)));
  const outer = walls.side === 0 && walls.top === 0;
  const verts = offsetProfile(filletChain(frame.frontZ, s.edgeR, rings), walls, outer ? 0 : -OVERSHOOT);
  const pts = profileRings(kit, s.body, verts);
  if (s.sag > 0) {
    // Keep inner dome points inside the inner profile's top vertex.
    const zTop = Math.max(...verts.map((v) => v[1]));
    const dTop = Math.max(...verts.filter((v) => v[1] > zTop - 1e-7).map((v) => v[0]));
    const minInside = Math.max(0, dTop - s.edgeR);
    const dome = domePoints(s.plateau, s.sag, frame.frontZ - walls.top, DOME_GRID);
    pts.push(...(minInside > 0 ? dome.filter(([x, y]) => insideDistance(s.plateau, [x, y]) > minInside) : dome));
  }
  return kit.hull(pts);
}

export const organicStyle: CoverStyle<typeof params> = {
  id: 'organic',
  version: 1,
  label: 'Organic',
  description:
    'Soft, pebble-like cover: large rounded corners, a quarter-round fillet into the face, an optional gentle dome and flared socket openings.',
  params,
  ui: {
    cornerR: { label: 'Corner radius', min: 4, max: 30, step: 0.5, unit: 'mm' },
    edgeR: { label: 'Edge fillet radius', min: 2, max: EDGE_R_MAX, step: 0.5, unit: 'mm', clampTo: 'maxEdgeR' },
    domeSag: { label: 'Dome height', min: 0, max: DOME_SAG_MAX, step: 0.1, unit: 'mm' },
    flareR: { label: 'Socket flare', min: 0, max: 12, step: 0.5, unit: 'mm' },
  },
  // Face down suits the flat face; a domed face (domeSag > 0) would rest on its apex, so it
  // prints face up.
  printOrientation: (p) => (p.domeSag > 0 ? 'faceUp' : 'faceDown'),
  printHint:
    'Flat face (dome 0): print face down; add supports inside the pockets (their floors bridge) and, if your slicer flags it, under the first millimetres of the edge fillet. With a dome the face is curved, so the default switches to face up: support the cavity ceiling instead.',
  // A finger notch may reach into the fillet (a dimple in the pebble's rounded edge; with the
  // default fillet its rim only touches the fillet's start) instead of growing the cover.
  allowsNotchInEdge: true,
  limits: (p) => {
    const wants = wantsOf(p);
    return {
      // Pockets/openings stay on the flat face, ≥ 1 mm inside the fillet (finger notches may
      // enter it: allowsNotchInEdge).
      minFrame: p.edgeR + 1,
      minFrontZ: p.edgeR + 2,
      // The fillet may not exceed the corner radius (the plateau keeps rounded corners).
      maxEdgeR: Math.min(EDGE_R_MAX, p.cornerR),
      // Full-size socket flare and pocket fillet (the resolver spaces features by them).
      edgeAllowance: wants.opening,
      pocketEdgeAllowance: wants.pocket,
      cornerR: p.cornerR,
      // The plate stays under the part of the fillet that is high enough (the dome only adds).
      edgeInset: (drop) => filletInset(p.edgeR, drop),
    };
  },
  surfaceZ: ({ frame, params: p }, x, y) => {
    const s = shapeOf(frame, p);
    return frame.frontZ + domeHeight(s.plateau, s.sag, x, y);
  },
  outerBody: (c) => organicBody(c, NO_WALLS),
  decorate: (c) => {
    const s = shapeOf(c.frame, c.params);
    const add = shellFill(c.kit, c.frame, (w) => organicBody(c, w), c.frame.frontZ - s.edgeR - 1);
    return add ? { add } : {};
  },
  // Shrink to fit is a safety net (dx/dy, manual layouts): the resolver leaves room for full size.
  openingEdge: ({ frame, params: p }, f): EdgeProfile =>
    flareEdge(Math.min(p.flareR, availableEdgeRoom(frame, f, shapeOf(frame, p).plateau, wantsOf(p)))),
  pocketEdge: ({ frame, params: p }, f): EdgeProfile => ({
    kind: 'fillet',
    r: Math.min(POCKET_FILLET, availableEdgeRoom(frame, f, shapeOf(frame, p).plateau, wantsOf(p))),
  }),
};
