/**
 * Cover builder: CoverConfig → one valid Manifold, built in stages (never one giant boolean):
 *
 *   1. body    = style.outerBody(ctx)                      flat base exactly at z = 0
 *   2. hollow  = union(cavity) − union(feature adds)        pocket wells, ledge slabs, notch backings
 *      shell   = body − hollow                              ≡ (body − cavity) + adds, clipped
 *                                                           to the body (wells can never poke
 *                                                           through a style's face or edges)
 *   3. shell  += style.decorate().add                       (only if the style decorates)
 *   4. cover   = shell − union(feature cuts + decorate().subtract)
 *
 * Each stage is one Manifold.union(...) of its tools followed by one boolean. Intermediates are
 * freed in a private scope; only the result escapes to the caller's scope.
 *
 * Validity (pushed as severity-'error' warnings, never thrown, so the UI still shows the
 * mesh): status() === 'NoError', !isEmpty(), decompose().length === 1 and
 * genus() === expectedGenus(frame). See expectedGenus for what counts as a through-hole; the
 * genus check is skipped when the resolver reported overlapping features (merged cuts merge
 * holes, and the overlap is already reported).
 */
import type { Manifold } from 'manifold-3d';
import type { CoverConfig } from '../config/schema';
import { WARNING_CODES, outerPlaced, resolveLayout } from '../layout/resolve';
import { parseStyleParams, resolveStyle, type AnyCoverStyle } from '../styles';
import type { CoverFrame, FeatureParts, Kit, StyleCtx, Warning } from './contract';
import { cavity, featureParts } from './features';
import { withScope } from './kit/scope';
import { placedDistance } from './shape2d';

export interface PreparedCover {
  style: AnyCoverStyle;
  params: Record<string, unknown>;
  /** Resolved layout with pocket floors placed on the local face; warnings incl. style ones. */
  frame: CoverFrame;
  ctx: StyleCtx<Record<string, unknown>>;
}

export interface CoverBuild {
  /** The finished cover (tracked by the caller's scope). */
  manifold: Manifold;
  /**
   * Resolved layout as built: pocket `floorZ`s include the lift onto a domed face, and
   * `warnings` holds every warning (style, params, layout, build validation).
   */
  frame: CoverFrame;
  style: AnyCoverStyle;
  params: Record<string, unknown>;
  /** Same list as frame.warnings. */
  warnings: Warning[];
  /**
   * Number of through-holes the cover should have (= expected genus), or null when it cannot
   * be predicted because the layout has overlapping features (merged cuts merge holes; the
   * resolver already reports that as 'feature-overlap'), in which case genus is not checked.
   */
  expectedGenus: number | null;
}

/** Warning codes emitted by the builders (in addition to resolve.ts' WARNING_CODES). */
export const BUILD_WARNING_CODES = {
  invalid: 'geometry-invalid',
  empty: 'geometry-empty',
  pieces: 'geometry-pieces',
  genus: 'geometry-genus',
} as const;

/**
 * Lift each pocket onto the local face: floorZ += surfaceZ(centre) − frontZ. A pocket under a
 * dome keeps its configured depth below the face it is cut into. The lift is never negative,
 * so a face lower than frontZ never pushes the floor towards the plate (the rocker gap from
 * the height chain is preserved; the pocket just gets shallower).
 */
export function placeFeaturesOnFace(frame: CoverFrame, style: AnyCoverStyle, ctx: StyleCtx<Record<string, unknown>>): CoverFrame {
  return {
    ...frame,
    features: frame.features.map((f) => {
      if (f.kind !== 'pocket') return f;
      const lift = Math.max(0, style.surfaceZ(ctx, f.placed.x, f.placed.y) - frame.frontZ);
      return lift > 1e-9 ? { ...f, floorZ: f.floorZ + lift } : f;
    }),
  };
}

export interface BuildOptions {
  /**
   * Use this style instead of looking up config.cover.style in the registry (tests, style
   * development). The config's styleParams are still parsed with its schema.
   */
  style?: AnyCoverStyle;
}

/** Style lookup, params, style limits → resolveLayout, pocket placement. Pure TS (no WASM). */
export function prepareCover(kit: Kit, config: CoverConfig, options: BuildOptions = {}): PreparedCover {
  const { style, warnings: styleWarnings } = options.style
    ? { style: options.style, warnings: [] }
    : resolveStyle(config.cover.style);
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
  const raw: CoverFrame = { ...resolved, warnings: [...styleWarnings, ...paramWarnings, ...resolved.warnings] };
  const frame = placeFeaturesOnFace(raw, style, { frame: raw, params, kit });
  return { style, params, frame, ctx: { frame, params, kit } };
}

/**
 * Number of through-holes (= genus of the finished cover). The base is open (the cavity
 * reaches below z = 0), so the plain shell is a cup: genus 0. A (nested) pocket is a blind
 * recess (well walls + floor), a strip indent is blind (floorT ≥ stripDepth + 1.2) and a finger
 * notch is blind (it stops above the floor and has its own backing well, bridged to the skirt
 * when close to it), so none of them add handles. A through-hole connects the face side to the
 * wall side and adds exactly one:
 *  - every opening (outlet / passthrough) whose outline overlaps the cavity footprint, since
 *    it cuts the skin into the cavity;
 *  - every access (bridge) hole whose outline overlaps the cavity footprint, since it pierces
 *    the pocket floor and the foot of the fillet wall (pocket side = face side) into the cavity
 *    below (open to the wall). The strip later spans it, but that is not part of the print.
 * Holes/openings entirely over the skirt would be blind and are not counted (the resolver's
 * margins make that impossible with sane settings).
 */
export function expectedGenus(frame: CoverFrame): number {
  const cav = outerPlaced(frame, frame.skirtT);
  const pierces = (p: Parameters<typeof placedDistance>[0]) => placedDistance(p, cav) < -1e-6;
  let n = 0;
  for (const f of frame.features) {
    if (f.kind === 'opening') n += pierces(f.placed) ? 1 : 0;
    else n += f.holes.filter(pierces).length;
  }
  return n;
}

/** Union of a stage's tools (one Manifold.union call), or null if there are none. */
export function unionTools(kit: Kit, tools: Manifold[]): Manifold | null {
  if (tools.length === 0) return null;
  if (tools.length === 1) return tools[0];
  return kit.wasm.Manifold.union(tools);
}

/** Flatten FeatureParts into add / subtract tool lists. */
export function collectParts(parts: FeatureParts[]): { add: Manifold[]; subtract: Manifold[] } {
  const add: Manifold[] = [];
  const subtract: Manifold[] = [];
  for (const p of parts) {
    if (p.add) add.push(...p.add);
    if (p.subtract) subtract.push(...p.subtract);
  }
  return { add, subtract };
}

/**
 * Validity checks shared by buildCover / buildTestFit; returns severity-'error' warnings.
 * `expected` = expected genus, or null to skip the genus check.
 */
export function validateSolid(m: Manifold, expected: number | null, what: string): Warning[] {
  const status = m.status();
  if (status !== 'NoError') {
    return [{ code: BUILD_WARNING_CODES.invalid, severity: 'error', message: `The ${what} mesh is invalid (${status}).` }];
  }
  if (m.isEmpty()) {
    return [{ code: BUILD_WARNING_CODES.empty, severity: 'error', message: `The ${what} came out empty.` }];
  }
  const out: Warning[] = [];
  const pieces = m.decompose().length;
  if (pieces !== 1) {
    out.push({
      code: BUILD_WARNING_CODES.pieces,
      severity: 'error',
      message: `The ${what} falls apart into ${pieces} pieces (check overlapping features).`,
    });
  }
  const genus = m.genus();
  if (expected !== null && genus !== expected) {
    out.push({
      code: BUILD_WARNING_CODES.genus,
      severity: 'error',
      message: `The ${what} has ${genus} through-holes, expected ${expected} (a cut breaks through somewhere it should not).`,
    });
  }
  return out;
}

export function buildCover(kit: Kit, config: CoverConfig, options: BuildOptions = {}): CoverBuild {
  const { style, params, frame: prepared, ctx } = prepareCover(kit, config, options);
  const overlapping = prepared.warnings.some((w) => w.code === WARNING_CODES.featureOverlap);
  const genus = overlapping ? null : expectedGenus(prepared);

  const { manifold, validation } = withScope(() => {
    const parts = collectParts(prepared.features.flatMap((f) => featureParts(kit, prepared, f, style, ctx)));

    // 1–2. body − (cavity − adds)
    const body = style.outerBody(ctx);
    let hollow = unionTools(kit, cavity(kit, prepared).subtract ?? []);
    const adds = unionTools(kit, parts.add);
    if (hollow && adds) hollow = hollow.subtract(adds);
    let shell = hollow ? body.subtract(hollow) : body;

    // 3–4. decorations, cuts
    const deco = style.decorate?.(ctx);
    if (deco?.add) shell = shell.add(deco.add);
    const cuts = unionTools(kit, deco?.subtract ? [...parts.subtract, deco.subtract] : parts.subtract);
    const result = cuts ? shell.subtract(cuts) : shell;
    return { manifold: kit.keep(result), validation: validateSolid(result, genus, 'cover') };
  });

  const warnings = [...prepared.warnings, ...validation];
  const frame: CoverFrame = { ...prepared, warnings };
  return { manifold, frame, style, params, warnings, expectedGenus: genus };
}
