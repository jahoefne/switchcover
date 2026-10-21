/**
 * Finger notches in a style's edge zone (CoverStyle.allowsNotchInEdge): the built covers of the
 * faceted, stepped and organic styles at their plate-driven sizes. The notch is off by default, so
 * every config here switches it on (notchConfig). Probes are thin columns intersected with the
 * cover (the top of the material at a point).
 */
import type { Manifold } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { presetConfig } from '../src/config/presets';
import { NOTCH_FLOOR_LIFT } from '../src/config/defaults';
import { buildCover, prepareCover } from '../src/geometry/buildCover';
import type { Kit, Placed } from '../src/geometry/contract';
import { liveObjectCount, withScope } from '../src/geometry/kit';
import { containmentMargin, insideDistance, offsetPlaced } from '../src/geometry/shape2d';
import { outerPlaced } from '../src/layout/resolve';
import { notchBreakouts } from '../src/styles/stepped';
import { getKit } from './helpers/manifold';

let kit: Kit;
beforeAll(async () => {
  kit = await getKit('preview');
});

const circle = (d: number, x: number, y: number): Placed => ({ shape: { kind: 'circle', d }, x, y, rotDeg: 0 });

/** Highest material point of `m` in a thin column at (x, y) (−Infinity if none). */
function columnTop(m: Manifold, x: number, y: number, zMax: number): number {
  const hit = m.intersect(kit.prism(circle(0.3, x, y), -1, zMax));
  return hit.isEmpty() ? -Infinity : hit.boundingBox().max[2];
}

/** A preset in a style with the finger notch switched on (it is off by default). */
function notchConfig(presetId: string, styleId: string) {
  const cfg = presetConfig(presetId);
  cfg.cover.style = styleId;
  cfg.bilresa.notch.enabled = true;
  return cfg;
}

function build(presetId: string, styleId: string) {
  const b = buildCover(kit, notchConfig(presetId, styleId));
  expect(b.warnings.filter((w) => w.severity === 'error'), `${presetId} ${styleId}`).toEqual([]);
  return b;
}

describe('faceted 1×1: the notch runs across the groove and bites the bevel foot, nothing else changes', () => {
  it('top surface = bevel / groove / plateau outside the notch rim; notch floor inside it', () => {
    const before = liveObjectCount();
    withScope(() => {
      const { manifold, frame } = build('ch-sd-1x1', 'faceted');
      expect(frame.outer).toMatchObject({ w: 96.8, h: 96.8 });
      const [p] = frame.features;
      if (p.kind !== 'pocket' || !p.notch) throw new Error('pocket with notch expected');
      const { frontZ } = frame;
      const half = frame.outer.h / 2; // 48.4; the notch is at the bottom end (y = −35.3)
      // faceted defaults: bevel 7 mm at 45°, groove 1 mm wide, 0.8 deep, 1.5 mm inside the bevel
      const analytic = (y: number) => {
        const d = half - Math.abs(y);
        if (d < 7) return frontZ - (7 - d);
        if (d >= 8.5 && d <= 9.5) return frontZ - 0.8;
        return frontZ;
      };
      expect(p.notch).toMatchObject({ x: 0, y: -35.3 });
      const rim = offsetPlaced(p.notch, 1 + 0.3); // chamfer 1 + a little
      const pocketRim = offsetPlaced(p.placed, 1 + 0.3);
      let checked = 0;
      // straight bottom side (away from the rounded corners): the bevel beyond the notch, the
      // groove gap, the groove and the plateau beside the notch
      for (const y of [-47.9, -47, -46, -45, -44, -43, -42, -41, -40.5, -39.4, -38.4, -37, -34, -30, -27.5]) {
        for (const x of [-14, -11, -9.5, -8.8, 0, 8.8, 9.5, 11, 14]) {
          if (insideDistance(rim, [x, y]) > 0 || insideDistance(pocketRim, [x, y]) > 0) continue;
          const top = columnTop(manifold, x, y, frontZ + 5);
          // a Ø0.3 column on the 45° bevel sees up to 0.15 mm more than its centre
          expect(Math.abs(top - analytic(y)), `(${x}, ${y})`).toBeLessThanOrEqual(half - Math.abs(y) < 7.2 ? 0.16 : 0.03);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(60);
      // inside the notch: cut down to its floor (floorZ + 2), also where it crosses the groove
      // and the bevel foot (the notch end at 42.3 is 0.9 mm into the 7 mm bevel)
      for (const [x, y] of [
        [0, -41.9],
        [0, -39.4],
        [3, -39],
        [-5, -36],
      ]) {
        expect(columnTop(manifold, x, y, frontZ + 5), `(${x}, ${y})`).toBeCloseTo(p.floorZ + NOTCH_FLOOR_LIFT, 3);
      }
      // the notch's far wall is solid from its floor to the bevel surface (no breach to the cavity)
      const wall = kit.prism(circle(0.3, 0, -43), p.floorZ, frontZ - 2).subtract(manifold); // bevel at −1.6 there
      expect(wall.volume()).toBeLessThan(1e-6);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });
});

describe('stepped 1×1: the notch opens into the step (no fin of top-tier wall)', () => {
  it('slot between the notch and the step down to the lower tread; the tread beyond stays untouched', () => {
    const before = liveObjectCount();
    withScope(() => {
      const { manifold, frame, style, params } = build('ch-sd-1x1', 'stepped');
      expect(frame.outer).toMatchObject({ w: 96.8, h: 96.8 });
      const [p] = frame.features;
      if (p.kind !== 'pocket' || !p.notch) throw new Error('pocket with notch expected');
      const { frontZ } = frame;
      const tread = frontZ - 2.5; // 2 tiers, step 2.5
      const tierEdge = frame.outer.h / 2 - 5; // 43.4: the top tier's edge
      // the notch wall (42.3) ends 1.1 mm inside the top tier: a fin thinner than minWall
      const tier = offsetPlaced(outerPlaced(frame), -5);
      expect(containmentMargin(p.notch, tier)).toBeCloseTo(tierEdge - 42.3, 6);
      expect(containmentMargin(p.notch, tier)).toBeLessThan(frame.minWall);
      const ctx = { frame, params, kit };
      expect(notchBreakouts(ctx as never)).toHaveLength(1);
      // where the fin was thinner than minWall (|x| < 3.4): the lower tread (the slot's floor);
      // the slot is clipped to the backing (r 9), so at the step it spans |x| ≤ 3.9
      for (const x of [-3.5, -2, 0, 2, 3.5]) {
        expect(columnTop(manifold, x, -42.85, frontZ + 5), `fin at x=${x}`).toBeCloseTo(tread, 3);
      }
      // beside the slot the top tier is intact (the wall there is ≥ 2.3 mm thick)
      for (const x of [-6, 6, -10, 10]) expect(columnTop(manifold, x, -42.85, frontZ + 5), `beside at x=${x}`).toBeCloseTo(frontZ, 3);
      // the slot's straight sides are tangent to the notch: material beside them at the notch's widest point
      for (const x of [-8.5, 8.5]) expect(columnTop(manifold, x, -37, frontZ + 5), `rim at x=${x}`).toBeCloseTo(frontZ, 3);
      // the lower tread beyond the step is untouched (the slot is clipped to the tier)
      for (const [x, y] of [
        [0, -43.5],
        [0, -45],
        [5, -46],
      ]) {
        expect(columnTop(manifold, x, y, frontZ + 5), `tread at (${x}, ${y})`).toBeCloseTo(tread, 3);
      }
      // the slot floor is solid down to the cavity ceiling's skin: no breach
      const under = kit.prism(circle(0.3, 0, -42.85), tread - frame.skinT + 0.2, tread - 0.2).subtract(manifold);
      expect(under.volume()).toBeLessThan(1e-6);
      // inside the notch: its floor
      expect(columnTop(manifold, 0, -40, frontZ + 5)).toBeCloseTo(p.floorZ + NOTCH_FLOOR_LIFT, 3);
      expect(style.id).toBe('stepped');
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });

  it('a notch that crosses the step bites into it by itself (no breakout tool)', () => {
    withScope(() => {
      const { frame, params } = prepareCover(kit, notchConfig('ch-sd-1x2v-switch-socket', 'stepped'));
      // the Ø50 socket (top at −30 + 25 = −5) keeps minWall 2 + step inset 2 + pocket chamfer 0.6
      // = 4.6 from the pocket, so the pocket spreads up to y = 34.9 (far end 70.2); its notch (top
      // 77.2) + minWall 2 + rim allowance 0.6 sets the top at 79.8, above the plate-driven 78.4:
      // the cover grows on the notch's side only, 96.8 × (78.4 + 79.8 = 158.2), centred 0.7 up
      expect(frame.outer).toMatchObject({ w: 96.8, h: 158.2 });
      expect(frame.outer.cy).toBeCloseTo(0.7, 6);
      const [p] = frame.features;
      if (p.kind !== 'pocket' || !p.notch) throw new Error('pocket with notch expected');
      expect(p.placed.y).toBeCloseTo(34.9, 6);
      expect(p.notch.y).toBeCloseTo(70.2, 6);
      // the top tier's edge (79.8 − 5 = 74.8) runs 2.4 mm inside the notch
      const tier = offsetPlaced(outerPlaced(frame), -5);
      expect(containmentMargin(p.notch, tier)).toBeLessThan(0);
      expect(containmentMargin(p.notch, tier)).toBeCloseTo(-2.4, 6);
      expect(notchBreakouts({ frame, params, kit } as never)).toHaveLength(0);
      build('ch-sd-1x2v-switch-socket', 'stepped');
      return null;
    });
  });

  it('3 tiers on the 1×1: the notch bites through the top tier; the fin in the middle tier is below the skin and stays', () => {
    withScope(() => {
      const cfg = notchConfig('ch-sd-1x1', 'stepped');
      cfg.cover.styleParams = { tiers: 3 };
      const { manifold, frame, params, warnings, expectedGenus } = buildCover(kit, cfg);
      expect(warnings.filter((w) => w.severity === 'error')).toEqual([]);
      expect(frame.outer).toMatchObject({ w: 96.8, h: 96.8 });
      expect(manifold.genus()).toBe(expectedGenus);
      // a slot through the middle tier would start at the bottom tread, 2 mm below the cavity ceiling
      expect(notchBreakouts({ frame, params, kit } as never)).toHaveLength(0);
      const { frontZ } = frame;
      // tier tops: frontZ − 5 (bottom), frontZ − 2.5 (middle, edge at 43.4), frontZ (top, edge at 38.4)
      expect(columnTop(manifold, 0, -42.85, frontZ + 5)).toBeCloseTo(frontZ - 2.5, 3); // the 1.1 mm fin
      expect(columnTop(manifold, 0, -44, frontZ + 5)).toBeCloseTo(frontZ - 5, 3); // bottom tread
      expect(columnTop(manifold, 0, -40, frontZ + 5)).toBeCloseTo(frame.features[0].kind === 'pocket' ? frame.features[0].floorZ + NOTCH_FLOOR_LIFT : NaN, 3); // the notch through the top tier's edge
      expect(columnTop(manifold, 12, -40, frontZ + 5)).toBeCloseTo(frontZ - 2.5, 3); // middle tier beside the bite
      return null;
    });
  });
});

describe('organic 1×1: the notch rim touches the fillet; the cover stays valid', () => {
  it('builds without errors at the plate-driven size', () => {
    withScope(() => {
      const { manifold, frame } = build('ch-sd-1x1', 'organic');
      expect(frame.outer).toMatchObject({ w: 101.33, h: 101.33 });
      const [p] = frame.features;
      if (p.kind !== 'pocket' || !p.notch) throw new Error('pocket with notch expected');
      // plateau = outline inset by the 8 mm fillet: the notch itself stays on it, its 1.5 mm rim
      // reaches 1.2 mm into the fillet (where the surface has dropped by < 0.1 mm)
      const plateau = offsetPlaced(outerPlaced(frame), -8);
      expect(containmentMargin(p.notch, plateau)).toBeGreaterThan(0);
      expect(containmentMargin(offsetPlaced(p.notch, 1.5), plateau)).toBeLessThan(0);
      expect(manifold.genus()).toBe(1);
      return null;
    });
  });
});

describe('every shipped preset × faceted / stepped / organic builds cleanly at the new sizes', () => {
  const ids = [
    'ch-sd-1x1',
    'ch-sd-1x2v-switch-socket',
    'ch-sd-2x1h-two-switches',
    'ch-sd-1x2v-two-switches',
    'ch-sd-1x3v-switch-two-sockets',
    'ch-sd-3x1h-three-switches',
    'ch-sd-2x2',
    'de-1x1',
    'de-1x2v',
    'de-2x1h',
  ];
  it.each(ids.flatMap((id) => ['faceted', 'stepped', 'organic'].map((s) => [id, s] as const)))('%s %s', (presetId, styleId) => {
    withScope(() => {
      const { manifold, frame, expectedGenus } = build(presetId, styleId);
      expect(manifold.decompose().length).toBe(1);
      expect(manifold.genus()).toBe(expectedGenus);
      // the notch rule never undercuts the plate-driven size, and manual = auto
      expect(frame.outer.w).toBeGreaterThanOrEqual(frame.plate.w + 2 * (frame.plate.clearance + frame.skirtT) - 1e-9);
      return null;
    });
  });
});
