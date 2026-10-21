/**
 * Local face heights under a placed outline, sampled from `style.surfaceZ` (pure TS), and
 * the face cut every recess / opening is made of.
 *
 * Flat styles return frontZ everywhere; domed styles vary, so cutting tools use
 *  - `centre` to place edge profiles (the contract: relative to the feature centre),
 *  - `max` to make sure a cut clears the face everywhere over its outline.
 */
import type { Manifold } from 'manifold-3d';
import type { EdgeProfile, Kit, Placed } from '../contract';
import { OVERSHOOT } from '../kit/kit';
import { offsetPlaced, outlineWorld, placedBounds, pointInPlaced } from '../shape2d';
import type { FeatureCtx, FeatureStyle } from './types';

export interface LocalFace {
  centre: number;
  min: number;
  max: number;
}

const OUTLINE_SAMPLES = 32;
const GRID = 6;
const MIN_TOOL = 1e-3;

export function localFace(style: Pick<FeatureStyle, 'surfaceZ'>, ctx: FeatureCtx, p: Placed): LocalFace {
  const centre = style.surfaceZ(ctx, p.x, p.y);
  let min = centre;
  let max = centre;
  const visit = (x: number, y: number) => {
    const z = style.surfaceZ(ctx, x, y);
    if (z < min) min = z;
    if (z > max) max = z;
  };
  for (const [x, y] of outlineWorld(p, 0, OUTLINE_SAMPLES)) visit(x, y);
  const b = placedBounds(p);
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = b.minX + ((i + 0.5) / GRID) * (b.maxX - b.minX);
      const y = b.minY + ((j + 0.5) / GRID) * (b.maxY - b.minY);
      if (pointInPlaced([x, y], p)) visit(x, y);
    }
  }
  return { centre, min, max };
}

/**
 * How far `kit.edgeTool` widens the outline at the face (zTop) for a tool `through` deep —
 * mirrors the kit's clamping (chamfer size ≤ through; zero-size profiles are plain prisms).
 */
export function edgeExtent(edge: EdgeProfile, through: number): number {
  switch (edge.kind) {
    case 'sharp':
      return 0;
    case 'chamfer': {
      const s = Math.min(edge.size, through);
      return s > 1e-6 ? s : 0;
    }
    case 'fillet':
    case 'flare': {
      const depth = Math.min(edge.kind === 'fillet' ? edge.r : edge.depth, through);
      return edge.r > 1e-6 && depth > 1e-6 ? edge.r : 0;
    }
    case 'step':
      return Math.min(edge.depth, through) > 1e-6 && edge.inset > 1e-6 ? edge.inset : 0;
  }
}

/**
 * Cut of outline `p` from exactly `zBottom` up through the local face, with `edge` applied at
 * the face height of the outline's centre (`kit.edgeTool`).
 *
 * The cut is upward-closed: where the face rises above the profile's top (domes), a chimney of
 * the widened outline clears everything up to the highest face point (+OVERSHOOT). Without it,
 * two neighbouring profiles that meet below a higher face would leave a bridge of face material
 * over a tunnel — an unintended through-hole. On flat faces the chimney is empty and omitted.
 */
export function faceCut(
  kit: Kit,
  style: Pick<FeatureStyle, 'surfaceZ'>,
  ctx: FeatureCtx,
  p: Placed,
  zBottom: number,
  edge: EdgeProfile,
): Manifold[] {
  const face = localFace(style, ctx, p);
  const zTop = face.centre;
  // edgeTool spans [zTop − through − OVERSHOOT, zTop + OVERSHOOT].
  const through = zTop - zBottom - OVERSHOOT;
  if (!(through > MIN_TOOL)) {
    const clear = face.max + OVERSHOOT;
    return clear > zBottom + MIN_TOOL ? [kit.prism(p, zBottom, clear)] : [];
  }
  const tools = [kit.edgeTool(p, zTop, edge, through)];
  const wide = offsetPlaced(p, edgeExtent(edge, through) + OVERSHOOT);
  const clear = localFace(style, ctx, wide).max + OVERSHOOT;
  if (clear > zTop + OVERSHOOT + MIN_TOOL) tools.push(kit.prism(wide, zTop, clear));
  return tools;
}
