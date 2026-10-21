/**
 * Cover builder.
 *
 * TODO WP1: replace this Phase-0 stub with the staged build from the plan:
 *   outerBody(style) − cavity + additions (pocket wells, decorations)
 *   − cuts (pocket voids, strip indents, access holes, notches, openings, passthroughs)
 * using src/geometry/features/*, one Manifold.union per stage, then one boolean.
 *
 * The stub only does `style.outerBody − cavity` (cavity = outer outline inset by skirtT,
 * z ∈ [0, frontZ − skinT]) so the worker, viewer and tests have real geometry.
 */
import type { Manifold } from 'manifold-3d';
import type { CoverConfig } from '../config/schema';
import { outerPlaced, resolveLayout } from '../layout/resolve';
import { parseStyleParams, resolveStyle, type AnyCoverStyle } from '../styles';
import type { CoverFrame, Kit } from './contract';
import { OVERSHOOT } from './kit/kit';

export interface CoverBuild {
  /** The finished cover (tracked by the caller's scope). */
  manifold: Manifold;
  /** Resolved layout; `warnings` include style/param warnings. */
  frame: CoverFrame;
  style: AnyCoverStyle;
  params: Record<string, unknown>;
}

export function buildCover(kit: Kit, config: CoverConfig): CoverBuild {
  const { style, warnings: styleWarnings } = resolveStyle(config.cover.style);
  const { params, warnings: paramWarnings } = parseStyleParams(style, config.cover.styleParams);
  const plate = {
    w: config.plate.w,
    h: config.plate.h,
    protrusion: config.plate.depth,
    cornerR: config.plate.cornerR,
    clearance: config.cover.clearance,
  };
  const limits = style.limits(params, plate);
  const resolved = resolveLayout(config, { limits });
  const frame: CoverFrame = { ...resolved, warnings: [...styleWarnings, ...paramWarnings, ...resolved.warnings] };
  const ctx = { frame, params, kit };

  const body = style.outerBody(ctx);
  // TODO WP1: move into features/cavity.ts.
  const cavity = kit.prism(outerPlaced(frame, frame.skirtT), -OVERSHOOT, frame.frontZ - frame.skinT);
  const manifold = kit.keep(body.subtract(cavity));
  body.delete();
  cavity.delete();
  return { manifold, frame, style, params };
}
