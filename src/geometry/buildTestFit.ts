/**
 * Test-fit part: one pocket of the cover as a small standalone print (~10–20 g), to check the
 * Bilresa fit (nested pocket), the magnet-strip indent and its glue ledges before printing the
 * whole cover.
 *
 *   body = nested pocket well with a TEST_FIT_RIM wall (+ strip-ledge slab, notch backing),
 *          floor underside → local face
 *   part = body − (pocket void, strip indent, bridge access hole, notch), base moved to z = 0
 *
 * It is built with the SAME feature functions as the cover (only the wall width, the well top
 * and the skirt bridge, which needs a skirt, differ), so whatever fits here fits in the cover.
 * x/y stay in cover coordinates (the pocket keeps its position); only z is shifted.
 */
import type { Manifold } from 'manifold-3d';
import type { CoverConfig } from '../config/schema';
import type { AnyCoverStyle } from '../styles';
import { collectParts, prepareCover, unionTools, validateSolid, type BuildOptions } from './buildCover';
import type { CoverFrame, Kit, Warning } from './contract';
import { floorBottom, localFace, pocketParts, type PocketFeature } from './features';
import { withScope } from './kit/scope';

/** Rim around the pocket of the test-fit part (mm). */
export const TEST_FIT_RIM = 3;

export interface TestFitBuild {
  /** The test-fit part, base at z = 0 (tracked by the caller's scope). */
  manifold: Manifold;
  /** The cover's resolved frame (warnings incl. test-fit validation). */
  frame: CoverFrame;
  /** The pocket the part was made from. */
  feature: PocketFeature;
  /** z shift applied to the pocket geometry (cover z = part z − zOffset). */
  zOffset: number;
  style: AnyCoverStyle;
  params: Record<string, unknown>;
  warnings: Warning[];
  expectedGenus: number;
}

export function buildTestFit(kit: Kit, config: CoverConfig, featureId?: string, options: BuildOptions = {}): TestFitBuild {
  const { style, params, frame: prepared, ctx } = prepareCover(kit, config, options);
  const pockets = prepared.features.filter((f): f is PocketFeature => f.kind === 'pocket');
  const feature = featureId === undefined ? pockets[0] : pockets.find((f) => f.id === featureId);
  if (!feature) {
    throw new Error(featureId === undefined ? 'The layout has no Bilresa pocket to test-fit.' : `No Bilresa pocket "${featureId}".`);
  }
  const top = Math.max(prepared.frontZ, localFace(style, ctx, feature.placed).centre);
  const zOffset = -floorBottom(prepared, feature);
  // Every access hole pierces the floor of the standalone part: one handle each.
  const genus = feature.holes.length;

  const { manifold, validation } = withScope(() => {
    const parts = collectParts(pocketParts(kit, prepared, feature, style, ctx, { wall: TEST_FIT_RIM, top, skirtMerge: false }));
    const body = unionTools(kit, parts.add);
    if (!body) throw new Error('Test-fit body is empty.');
    const cuts = unionTools(kit, parts.subtract);
    const part = (cuts ? body.subtract(cuts) : body).translate([0, 0, zOffset]);
    return { manifold: kit.keep(part), validation: validateSolid(part, genus, 'test-fit part') };
  });

  const warnings = [...prepared.warnings, ...validation];
  return {
    manifold,
    frame: { ...prepared, warnings },
    feature,
    zOffset,
    style,
    params,
    warnings,
    expectedGenus: genus,
  };
}
