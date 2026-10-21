/**
 * Test-fit part: one pocket (well with a 3 mm rim + all pocket cuts), base at z = 0, built
 * with the same feature functions as the cover. Genus = its access holes (each pierces the
 * standalone floor); the void, strip indent and notch are blind.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { BILRESA_VARIANTS } from '../src/config/defaults';
import { presetConfig } from '../src/config/presets';
import { buildCover } from '../src/geometry/buildCover';
import { buildTestFit, TEST_FIT_RIM } from '../src/geometry/buildTestFit';
import type { Kit } from '../src/geometry/contract';
import type { PocketFeature } from '../src/geometry/features';
import { liveObjectCount, withScope } from '../src/geometry/kit';
import { offsetPlaced, placedBounds } from '../src/geometry/shape2d';
import { layoutConfig } from './helpers/configs';
import { getKit, getWasm } from './helpers/manifold';
import { column, intersectionVolume, plainFloorPoint, seatedBilresa, topOfIntersection } from './helpers/probes';

let kit: Kit;
let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await getWasm();
  kit = await getKit('preview');
});

const PLA_G_PER_MM3 = 1.24e-3;

describe.each([
  ['ch-sd-1x1', 'minimal'],
  ['ch-sd-1x1', 'box'],
  ['ch-sd-1x2v-two-switches', 'minimal'],
  ['x-passthrough-wheel', 'minimal'],
  ['x-rect-outlet-shallow', 'box'],
] as const)('test fit %s × %s', (layoutId, styleId) => {
  it('is a small valid part with the pocket at the cover heights, shifted to z = 0', () => {
    const before = liveObjectCount();
    withScope(() => {
      const config = layoutConfig(layoutId, styleId);
      const t = buildTestFit(kit, config);
      const m = t.manifold;
      const f = t.feature;
      const { floorT } = t.frame;
      expect(m.status()).toBe('NoError');
      expect(m.decompose().length).toBe(1);
      expect(t.expectedGenus).toBe(f.holes.length);
      expect(m.genus()).toBe(f.holes.length);
      expect(t.warnings.filter((w) => w.severity === 'error')).toEqual([]);

      // base at z = 0, top at the face: floorT + pocket depth
      const box = m.boundingBox();
      expect(box.min[2]).toBe(0);
      expect(box.max[2]).toBeCloseTo(t.frame.frontZ - f.floorZ + floorT, 6);
      expect(t.zOffset).toBeCloseTo(-(f.floorZ - floorT), 9);
      // footprint: the pocket + rim (the notch backing may stick out at one end)
      const rim = placedBounds(offsetPlaced(f.placed, TEST_FIT_RIM));
      expect(box.min[0]).toBeLessThanOrEqual(rim.minX + 0.05);
      expect(box.max[0]).toBeGreaterThanOrEqual(rim.maxX - 0.05);
      expect(box.min[1]).toBeLessThanOrEqual(rim.minY + 0.05);
      expect(box.max[1]).toBeGreaterThanOrEqual(rim.maxY - 0.05);
      expect(box.max[0] - box.min[0]).toBeLessThan(rim.maxX - rim.minX + 12);
      expect(box.max[1] - box.min[1]).toBeLessThan(rim.maxY - rim.minY + 12);

      // tens of grams at most
      const grams = m.volume() * PLA_G_PER_MM3;
      expect(grams).toBeGreaterThan(3);
      expect(grams).toBeLessThan(30);

      // same floor / strip / holes as the cover
      const dz = t.zOffset;
      const [px, py] = plainFloorPoint(f);
      expect(topOfIntersection(m, column(kit, px, py, -1, 40))).toBeCloseTo(f.floorZ + dz, 4);
      expect(topOfIntersection(m, column(kit, f.strip.x, f.strip.y, -1, 40))).toBeCloseTo(f.floorZ - f.stripDepth + dz, 4);
      for (const h of f.holes) expect(intersectionVolume(m, kit.prism(offsetPlaced(h, -0.2), -1, 40))).toBeLessThan(1e-6);

      // the real Bilresa fits
      const file = BILRESA_VARIANTS[f.variant].model.split('/').pop()!;
      const device = seatedBilresa(wasm, { ...f, floorZ: f.floorZ + dz }, file);
      expect(intersectionVolume(m, device)).toBeLessThan(1e-3);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });
});

describe('test fit selection', () => {
  it('uses the first pocket by default and the requested one by id', () => {
    withScope(() => {
      const config = presetConfig('ch-sd-3x1h-three-switches');
      const cover = buildCover(kit, config);
      const ids = cover.frame.features.filter((f): f is PocketFeature => f.kind === 'pocket').map((f) => f.id);
      expect(ids).toEqual(['c0r0', 'c1r0', 'c2r0']);
      expect(buildTestFit(kit, config).feature.id).toBe('c0r0');
      const last = buildTestFit(kit, config, 'c2r0');
      expect(last.feature.id).toBe('c2r0');
      const b = last.manifold.boundingBox();
      expect((b.min[0] + b.max[0]) / 2).toBeGreaterThan(30); // stays at its cover x position
      expect(() => buildTestFit(kit, config, 'c9r9')).toThrow(/No Bilresa pocket "c9r9"/);
      return null;
    });
  });

  it('the real Bilresa collides with a deliberately shallow seat (probe sanity check)', () => {
    withScope(() => {
      const t = buildTestFit(kit, presetConfig('ch-sd-1x1'));
      const f = { ...t.feature, floorZ: t.feature.floorZ + t.zOffset };
      const device = seatedBilresa(wasm, f, 'Bilresa_twobutton.stl', -0.5); // sunk 0.5 mm into the floor
      expect(intersectionVolume(t.manifold, device)).toBeGreaterThan(100);
      return null;
    });
  });
});
