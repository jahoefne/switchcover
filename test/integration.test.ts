/**
 * Integration: every preset × every registered style through the real builder, and the finger-
 * notch backing probe (no thin air slot between the backing and the skirt).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { listPresets, presetConfig } from '../src/config/presets';
import type { CoverConfig } from '../src/config/schema';
import { buildCover, type CoverBuild } from '../src/geometry/buildCover';
import type { Kit } from '../src/geometry/contract';
import { cavityCeiling, type PocketFeature } from '../src/geometry/features';
import { withScope } from '../src/geometry/kit';
import { containmentMargin, offsetPlaced, shapeCore } from '../src/geometry/shape2d';
import { outerPlaced } from '../src/layout/resolve';
import { listStyles } from '../src/styles';
import { getKit } from './helpers/manifold';
import { column, intersectionVolume } from './helpers/probes';

let kit: Kit;
beforeAll(async () => {
  kit = await getKit('preview');
});

const PRESETS = listPresets().map((p) => p.id);
const STYLES = listStyles().map((s) => s.id);

function configFor(presetId: string, styleId: string): CoverConfig {
  const c = presetConfig(presetId);
  c.cover.style = styleId;
  c.cover.styleParams = {};
  return c;
}

describe.each(STYLES)('%s style, every preset', (styleId) => {
  it.each(PRESETS)('%s: valid cover, no errors, clear of the plate, features inside the frame', (presetId) => {
    withScope(() => {
      const cfg = configFor(presetId, styleId);
      const b = buildCover(kit, cfg);
      expect(b.style.id).toBe(styleId);
      expect(b.warnings.filter((w) => w.severity === 'error')).toEqual([]);
      expect(b.manifold.genus()).toBe(b.expectedGenus);
      // the plate (+clearance, + rocker gap) stays free
      const { plate } = b.frame;
      const c = plate.clearance;
      const box = kit.prism(
        { shape: { kind: 'roundedRect', w: plate.w + 2 * c - 0.02, h: plate.h + 2 * c - 0.02, r: plate.cornerR + c - 0.01 }, x: 0, y: 0, rotDeg: 0 },
        0,
        plate.protrusion + cfg.cover.rockerGap - 0.01,
      );
      expect(intersectionVolume(b.manifold, box)).toBeLessThan(1e-6);
      // every feature keeps at least minWall to the outer edge
      const outer = outerPlaced(b.frame);
      for (const f of b.frame.features) expect(containmentMargin(f.placed, outer), f.id).toBeGreaterThanOrEqual(b.frame.minWall - 1e-6);
      return null;
    });
  });
});

/**
 * Material along the notch axis (pocket centre → notch centre, outwards), from just outside the
 * notch to the outer edge, at heights between the floor underside and the cavity ceiling: the
 * runs of air and material, in mm along the axis.
 */
function notchAxisRuns(b: CoverBuild, f: PocketFeature, step = 0.1): Array<{ air: boolean; from: number; to: number }> {
  const n = f.notch!;
  const dx = n.x - f.placed.x;
  const dy = n.y - f.placed.y;
  const len = Math.hypot(dx, dy);
  const [ux, uy] = [dx / len, dy / len];
  const z0 = f.floorZ - b.frame.floorT + 0.3;
  const z1 = cavityCeiling(b.frame) - 0.3;
  const r = shapeCore(n.shape).r;
  // distance from the notch centre to the outer edge along the axis
  const outer = outerPlaced(b.frame);
  let tMax = r;
  while (containmentMargin({ shape: { kind: 'circle', d: 0.02 }, x: n.x + ux * tMax, y: n.y + uy * tMax, rotDeg: 0 }, outer) > 0.05) tMax += step;
  const runs: Array<{ air: boolean; from: number; to: number }> = [];
  for (let t = r + 0.1; t <= tMax; t += step) {
    const air = intersectionVolume(b.manifold, column(kit, n.x + ux * t, n.y + uy * t, z0, z1, 0.2)) < 1e-9;
    const last = runs[runs.length - 1];
    if (last && last.air === air) last.to = t;
    else runs.push({ air, from: t, to: t });
  }
  return runs;
}

describe('finger-notch backing vs skirt: merged or ≥ minWall apart, never a thin slot', () => {
  const cases = [
    ['ch-sd-1x1', 'minimal', 'auto'],
    ['ch-sd-1x1', 'minimal', 'manual'],
    ['ch-sd-1x1', 'box', 'auto'],
    ['ch-sd-1x1', 'box', 'manual'],
    ['ch-sd-1x1', 'organic', 'auto'],
    ['ch-sd-1x2v-switch-socket', 'minimal', 'auto'],
    ['ch-sd-1x2v-switch-socket', 'box', 'manual'],
  ] as const;
  it.each(cases)('%s × %s, size %s', (presetId, styleId, size) => {
    withScope(() => {
      const cfg = configFor(presetId, styleId);
      if (size === 'manual') {
        const auto = buildCover(kit, cfg).frame.outer;
        cfg.cover.size = { w: auto.autoW, h: auto.autoH }; // exactly the automatic minimum
      }
      const b = buildCover(kit, cfg);
      const pockets = b.frame.features.filter((f): f is PocketFeature => f.kind === 'pocket');
      expect(pockets.length).toBeGreaterThan(0);
      for (const f of pockets) {
        const runs = notchAxisRuns(b, f);
        // starts with the backing (material), ends in the skirt (material)
        expect(runs[0].air, `${f.id} backing`).toBe(false);
        expect(runs[runs.length - 1].air, `${f.id} skirt`).toBe(false);
        const gaps = runs.filter((r) => r.air);
        expect(gaps.length).toBeLessThanOrEqual(1);
        for (const g of gaps) expect(g.to - g.from + 0.1, `${f.id} air gap`).toBeGreaterThanOrEqual(b.frame.minWall - 0.15);
        // the former sliver location (0.35 mm beyond the plain backing): material, or ≥ minWall of air around it
        const backing = offsetPlaced(f.notch!, b.frame.minWall);
        const t = shapeCore(backing.shape).r + 0.35;
        const at = runs.find((r) => r.from - 0.05 <= t && t <= r.to + 0.05)!;
        expect(at.air ? at.to - at.from + 0.1 >= b.frame.minWall - 0.15 : true, `${f.id} at the old sliver`).toBe(true);
      }
      return null;
    });
  });
});
