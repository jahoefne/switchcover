import { describe, expect, it } from 'vitest';
import { presetConfig } from '../src/config/presets';
import type { CoverConfig, ModuleConfig } from '../src/config/schema';
import type { CoverFrame, Placed, ResolvedFeature } from '../src/geometry/contract';
import {
  offsetPlaced,
  outlineWorld,
  placedBounds,
  placedDistance,
  pointInPlaced,
  pointsInPlaced,
  rectCornersWorld,
  toLocal,
} from '../src/geometry/shape2d';
import { WARNING_CODES, moduleAnchor, outerPlaced, resolveLayout } from '../src/layout/resolve';

type Pocket = Extract<ResolvedFeature, { kind: 'pocket' }>;
type Opening = Extract<ResolvedFeature, { kind: 'opening' }>;

const pockets = (f: CoverFrame) => f.features.filter((x): x is Pocket => x.kind === 'pocket');
const openings = (f: CoverFrame) => f.features.filter((x): x is Opening => x.kind === 'opening');
const codes = (f: CoverFrame) => f.warnings.map((w) => w.code);
const bilresa = (col: number, row: number, extra: Partial<ModuleConfig> = {}): ModuleConfig => ({
  col,
  row,
  role: 'bilresa',
  rot: 0,
  dx: 0,
  dy: 0,
  bilresa: { variant: '2button' },
  ...extra,
});

function withGrid(cols: number, rows: number, modules: ModuleConfig[]): CoverConfig {
  const c = presetConfig('custom');
  c.grid = { cols, rows, pitchX: 60, pitchY: 60 };
  c.plate.w = 90 + 60 * (cols - 1);
  c.plate.h = 90 + 60 * (rows - 1);
  c.modules = modules;
  return c;
}

describe('anchors', () => {
  const grid = (cols: number, rows: number) => ({ cols, rows, pitchX: 60, pitchY: 60 });

  it('1×1 → origin', () => {
    expect(moduleAnchor(grid(1, 1), 0, 0)).toEqual([0, 0]);
  });
  it('1×2 (vertical): row 0 is on top', () => {
    expect(moduleAnchor(grid(1, 2), 0, 0)).toEqual([0, 30]);
    expect(moduleAnchor(grid(1, 2), 0, 1)).toEqual([0, -30]);
  });
  it('2×1 (horizontal): column 0 is on the left', () => {
    expect(moduleAnchor(grid(2, 1), 0, 0)).toEqual([-30, 0]);
    expect(moduleAnchor(grid(2, 1), 1, 0)).toEqual([30, 0]);
  });
  it('1×3 (vertical)', () => {
    expect([0, 1, 2].map((r) => moduleAnchor(grid(1, 3), 0, r))).toEqual([
      [0, 60],
      [0, 0],
      [0, -60],
    ]);
  });

  it('features sit on their anchors (+dx/dy) with ids cXrY', () => {
    const f = resolveLayout(withGrid(3, 1, [bilresa(0, 0), bilresa(1, 0, { dx: 2, dy: -3 }), bilresa(2, 0)]));
    expect(pockets(f).map((p) => [p.id, p.anchor, p.placed.x, p.placed.y])).toEqual([
      ['c0r0', [-60, 0], -60, 0],
      ['c1r0', [0, 0], 2, -3],
      ['c2r0', [60, 0], 60, 0],
    ]);
  });

  it('ignores modules outside the grid and duplicates, with warnings', () => {
    const f = resolveLayout(withGrid(1, 1, [bilresa(0, 0), bilresa(0, 0), bilresa(3, 0)]));
    expect(pockets(f)).toHaveLength(1);
    expect(codes(f)).toContain(WARNING_CODES.moduleDuplicate);
    expect(codes(f)).toContain(WARNING_CODES.moduleOutsideGrid);
  });
});

describe('spreading', () => {
  it('spreads the unrotated pocket of the vertical switch+socket preset upwards; the outlet stays', () => {
    const f = resolveLayout(presetConfig('ch-sd-1x2v-switch-socket'));
    const [p] = pockets(f);
    const [o] = openings(f);
    expect(o.placed.x).toBe(0);
    expect(o.placed.y).toBe(-30); // outlets never move off their socket
    expect(p.placed.x).toBe(0);
    // 70.6 mm pocket + Ø46 outlet on a 60 mm pitch: 35.3 + 23 + 2 − 60 = 0.3 mm
    expect(p.placed.y).toBeCloseTo(30.3, 6);
    expect(placedDistance(p.placed, o.placed)).toBeCloseTo(2, 4);
    expect(codes(f)).toContain(WARNING_CODES.pocketSpread);
    expect(codes(f)).not.toContain(WARNING_CODES.featureOverlap);
  });

  it('spreads two unrotated vertical pockets symmetrically until minWall remains', () => {
    const c = presetConfig('ch-sd-1x2v-two-switches');
    c.modules = c.modules.map((m) => ({ ...m, rot: 0 }));
    const f = resolveLayout(c);
    const [top, bottom] = pockets(f);
    // 70.6 + 2 − 60 = 12.6 mm, half each
    expect(top.placed.y).toBeCloseTo(36.3, 6);
    expect(bottom.placed.y).toBeCloseTo(-36.3, 6);
    expect(placedDistance(top.placed, bottom.placed)).toBeCloseTo(2, 4);
    expect(f.warnings.filter((w) => w.code === WARNING_CODES.pocketSpread)).toHaveLength(2);
  });

  it('does NOT spread when the two-switch vertical preset is rotated (as shipped)', () => {
    const f = resolveLayout(presetConfig('ch-sd-1x2v-two-switches'));
    const [top, bottom] = pockets(f);
    expect(top.placed).toMatchObject({ x: 0, y: 30, rotDeg: 90 });
    expect(bottom.placed).toMatchObject({ x: 0, y: -30, rotDeg: 90 });
    expect(codes(f)).not.toContain(WARNING_CODES.pocketSpread);
  });

  it('spreads three pockets in a column symmetrically (middle stays)', () => {
    const c = withGrid(1, 3, [bilresa(0, 0), bilresa(0, 1), bilresa(0, 2)]);
    const ys = pockets(resolveLayout(c)).map((p) => p.placed.y);
    expect(ys[0]).toBeCloseTo(60 + 12.6, 4);
    expect(ys[1]).toBeCloseTo(0, 4);
    expect(ys[2]).toBeCloseTo(-60 - 12.6, 4);
  });

  it('reports remaining overlaps (diagonal neighbours are not spread)', () => {
    const c = withGrid(2, 2, [bilresa(0, 0, { dx: 20, dy: -20 }), bilresa(1, 1, { dx: -20, dy: 20 })]);
    expect(codes(resolveLayout(c))).toContain(WARNING_CODES.featureOverlap);
  });
});

describe('height chain', () => {
  it('frontZ = plate.depth + rockerGap + floorT + pocketDepth', () => {
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.floorT = 3;
    const f = resolveLayout(c);
    expect(f.floorT).toBe(3);
    expect(f.frontZ).toBeCloseTo(12 + 2 + 3 + 9, 9);
    expect(pockets(f)[0].floorZ).toBeCloseTo(f.frontZ - 9, 9);
    expect(pockets(f)[0].stripDepth).toBeCloseTo(1 + 0.2, 9);
  });

  it('clamps floorT to stripDepth + 1.2 with a warning', () => {
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.strip.protrusion = 2;
    c.bilresa.floorT = 2.2;
    const f = resolveLayout(c);
    expect(f.floorT).toBeCloseTo(2 + 0.2 + 1.2, 9);
    expect(codes(f)).toContain(WARNING_CODES.floorClamped);
    expect(f.frontZ).toBeCloseTo(12 + 2 + 3.4 + 9, 9);
    // the shipped defaults (floorT 2.2, strip 1.0 + tol 0.2) are clamped to 2.4
    expect(resolveLayout(presetConfig('ch-sd-1x1')).floorT).toBeCloseTo(2.4, 9);
  });

  it('uses the deepest per-module pocket and the style minimum', () => {
    const c = withGrid(2, 1, [bilresa(0, 0), bilresa(1, 0, { bilresa: { variant: 'wheel', pocketDepth: 11 } })]);
    c.bilresa.floorT = 3;
    const f = resolveLayout(c);
    expect(f.frontZ).toBeCloseTo(12 + 2 + 3 + 11, 9);
    expect(pockets(f).map((p) => p.floorZ)).toEqual([f.frontZ - 9, f.frontZ - 11]);
    const raised = resolveLayout(c, { limits: { minFrame: 0, minFrontZ: 40, maxEdgeR: 5 } });
    expect(raised.frontZ).toBe(40);
    expect(codes(raised)).toContain(WARNING_CODES.frontRaised);
  });
});

describe('outer size', () => {
  it('auto size wraps the plate (+clearance +skirt), symmetric about the plate centre', () => {
    const f = resolveLayout(presetConfig('ch-sd-1x1'));
    expect(f.outer).toMatchObject({ w: 96.8, h: 96.8, cx: 0, cy: 0, cornerR: 6.4, autoW: 96.8, autoH: 96.8 });
  });

  it('grows symmetrically to keep minWall + margin around shifted pockets', () => {
    const c = presetConfig('ch-sd-1x1');
    c.modules[0].dx = 20;
    // pocket half width 20.3 + 20 shift + minWall 2 + margin 4 = 46.3 < 48.4 (plate wins)
    expect(resolveLayout(c).outer.w).toBe(96.8);
    c.modules[0].dx = 30;
    const g = resolveLayout(c);
    expect(g.outer.w).toBeCloseTo(2 * (30 + 20.3 + 6), 2);
    expect(g.outer.h).toBe(96.8);
    expect(g.outer.cx).toBe(0);
    const b = placedBounds(offsetPlaced(pockets(g)[0].placed, 6));
    expect(b.maxX).toBeLessThanOrEqual(g.outer.w / 2 + 1e-6);
    expect(-b.minX).toBeLessThan(g.outer.w / 2); // symmetric: the far side has slack
  });

  it('grows past the rounded outer corner when a sharp opening sits in it', () => {
    const c = presetConfig('ch-sd-1x1');
    c.plate.cornerR = 30; // cover corner radius 33.4
    c.modules[0] = {
      col: 0,
      row: 0,
      role: 'passthrough',
      rot: 0,
      dx: 25,
      dy: 25,
      opening: { shape: 'roundedRect', w: 40, h: 40, cornerR: 0 },
    };
    const f = resolveLayout(c);
    const outer = outerPlaced(f);
    const grown = offsetPlaced(openings(f)[0].placed, 6);
    const pts = outlineWorld(grown, 0, 64);
    expect(pts.every((v) => pointInPlaced(v, outer, 1e-3))).toBe(true);
    // bounding-box sizing alone (2 · 51) would have clipped the corner
    expect(f.outer.w).toBeGreaterThan(102 + 1);
    expect(f.outer.w).toBe(f.outer.h);
  });

  it('manual size is used when ≥ auto and clamped (with a warning) when smaller', () => {
    const c = presetConfig('ch-sd-1x1');
    c.cover.size = { w: 120, h: 110 };
    const big = resolveLayout(c);
    expect([big.outer.w, big.outer.h, big.outer.autoW]).toEqual([120, 110, 96.8]);
    expect(codes(big)).not.toContain(WARNING_CODES.sizeClamped);
    c.cover.size = { w: 50, h: 110 };
    const small = resolveLayout(c);
    expect([small.outer.w, small.outer.h]).toEqual([96.8, 110]);
    expect(codes(small)).toContain(WARNING_CODES.sizeClamped);
  });

  it('style minFrame widens the frame', () => {
    const f = resolveLayout(presetConfig('ch-sd-1x1'), { limits: { minFrame: 10, minFrontZ: 0, maxEdgeR: 5 } });
    expect(f.outer.w).toBeCloseTo(90 + 2 * (1 + 10), 6);
  });
});

describe('access holes', () => {
  function checkHoles(p: Pocket, c: CoverConfig) {
    const inset = offsetPlaced(p.placed, -c.bilresa.hiddenMargin);
    const band = offsetPlaced(p.strip, c.bilresa.stripMargin);
    for (const h of p.holes) {
      const corners = rectCornersWorld(h);
      // fully under the Bilresa (inside the pocket inset by hiddenMargin)
      expect(pointsInPlaced(corners, inset, 1e-6)).toBe(true);
      // inside the access rect centred on the ANCHOR (not the shifted pocket centre)
      for (const v of corners) {
        const [lx, ly] = toLocal({ ...p.placed, x: p.anchor[0], y: p.anchor[1] }, v);
        expect(Math.abs(lx)).toBeLessThanOrEqual(c.bilresa.access.w / 2 + 1e-6);
        expect(Math.abs(ly)).toBeLessThanOrEqual(c.bilresa.access.h / 2 + 1e-6);
      }
      // clear of the strip (+ margin)
      expect(placedDistance(h, band)).toBeGreaterThanOrEqual(-1e-6);
    }
  }

  it('default pocket: two holes left/right of the strip, mirrored, wide enough for a fingertip', () => {
    const c = presetConfig('ch-sd-1x1');
    const f = resolveLayout(c);
    const [p] = pockets(f);
    expect(p.holes).toHaveLength(2);
    expect(p.holes[0].x).toBeCloseTo(-p.holes[1].x, 9);
    checkHoles(p, c);
    // 34 mm access rect − 2·(3.5 + 0.2 + 2.5) band → 10.8 mm per side (≥ MIN_ACCESS_WIDTH)
    expect((p.holes[0].shape as { w: number }).w).toBeCloseTo(10.8, 9);
    expect(codes(f)).not.toContain(WARNING_CODES.accessNarrow);
  });

  it.each([
    [0, 0, 0],
    [5, 0, 0],
    [-7, 3, 0],
    [0, 9, 0],
    [4, -6, 90],
    [-3, 5, 90],
  ])('holes stay covered after dx=%d dy=%d rot=%d', (dx, dy, rot) => {
    const c = presetConfig('ch-sd-1x1');
    c.modules[0] = { ...c.modules[0], dx, dy, rot: rot as 0 | 90 };
    const f = resolveLayout(c);
    const [p] = pockets(f);
    expect(p.holes.length).toBeGreaterThan(0);
    checkHoles(p, c);
    expect(codes(f)).not.toContain(WARNING_CODES.accessUncovered);
  });

  it('wider access with a narrower strip margin gives fingertip-sized holes (wheel)', () => {
    const c = presetConfig('ch-sd-1x1');
    c.modules[0].bilresa = { variant: 'wheel' };
    c.bilresa.access.w = 40;
    c.bilresa.stripMargin = 2;
    const f = resolveLayout(c);
    const [p] = pockets(f);
    checkHoles(p, c);
    expect(p.holes.every((h) => Math.min((h.shape as { w: number }).w, (h.shape as { h: number }).h) >= 10)).toBe(true);
    expect(codes(f)).not.toContain(WARNING_CODES.accessNarrow);
  });

  it('a pocket moved off its rocker loses its holes (warning)', () => {
    const c = presetConfig('ch-sd-1x1');
    c.modules[0].dx = 40;
    const f = resolveLayout(c);
    expect(pockets(f)[0].holes).toHaveLength(0);
    expect(codes(f)).toContain(WARNING_CODES.accessNone);
  });
});

describe('features', () => {
  it('pocket outline = Bilresa outline + clearance, strip = strip + tolerance', () => {
    const [p] = pockets(resolveLayout(presetConfig('ch-sd-1x1')));
    expect(p.placed.shape).toEqual({ kind: 'stadium', w: 40.6, h: 70.6 });
    expect(p.strip.shape).toEqual({ kind: 'stadium', w: 7.4, h: 44.4 });
    expect(p.variant).toBe('2button');
  });

  it('notch sits at the pocket end farthest from the plate centre', () => {
    const top = pockets(resolveLayout(presetConfig('ch-sd-1x2v-switch-socket')))[0];
    expect(top.notch).toMatchObject({ shape: { kind: 'circle', d: 16 }, x: 0 });
    expect(top.notch!.y).toBeCloseTo(30.3 + 35.3, 6);
    const single = pockets(resolveLayout(presetConfig('ch-sd-1x1')))[0];
    expect(single.notch!.y).toBeCloseTo(-35.3, 6); // tie → bottom
    const rotated = pockets(resolveLayout(presetConfig('ch-sd-1x2v-two-switches')));
    expect(rotated[0].notch!.x).toBeCloseTo(35.3, 6); // tie → right
  });

  it('notch can be disabled globally or per module', () => {
    const c = presetConfig('ch-sd-2x1h-two-switches');
    c.modules[1].bilresa = { variant: '2button', notch: false };
    const ps = pockets(resolveLayout(c));
    expect(ps[0].notch).toBeDefined();
    expect(ps[1].notch).toBeUndefined();
    c.bilresa.notch.enabled = false;
    expect(pockets(resolveLayout(c))[0].notch).toBeUndefined();
  });

  it('outlets default to Ø46, passthroughs to a rounded rect, blanks are skipped', () => {
    const c = withGrid(3, 1, [
      { col: 0, row: 0, role: 'outlet', rot: 0, dx: 0, dy: 0 },
      { col: 1, row: 0, role: 'passthrough', rot: 0, dx: 0, dy: 0 },
      { col: 2, row: 0, role: 'blank', rot: 0, dx: 0, dy: 0 },
    ]);
    const os = openings(resolveLayout(c));
    expect(os.map((o) => [o.id, o.role, o.placed.shape.kind])).toEqual([
      ['c0r0', 'outlet', 'circle'],
      ['c1r0', 'passthrough', 'roundedRect'],
    ]);
    expect(os[0].placed.shape).toEqual({ kind: 'circle', d: 46 });
  });
});

describe('warnings', () => {
  it('warns about deep opening tunnels only when the face sits more than 15 mm above the plate', () => {
    // default: frontZ = 12 + 2 + 2.4 + 9 = 25.4 → 13.4 mm tunnel, no warning
    expect(codes(resolveLayout(presetConfig('ch-sd-1x2v-switch-socket')))).not.toContain(WARNING_CODES.openingDeep);
    const deep = presetConfig('ch-sd-1x2v-switch-socket');
    deep.bilresa.pocketDepth = 12; // → 16.4 mm tunnel
    expect(codes(resolveLayout(deep))).toContain(WARNING_CODES.openingDeep);
    expect(codes(resolveLayout(presetConfig('ch-sd-1x1')))).not.toContain(WARNING_CODES.openingDeep);
  });

  it('warns when the cover exceeds 250 mm', () => {
    const c = withGrid(4, 1, [bilresa(0, 0), bilresa(1, 0), bilresa(2, 0), bilresa(3, 0)]);
    const f = resolveLayout(c);
    expect(f.outer.w).toBeGreaterThan(250);
    expect(codes(f)).toContain(WARNING_CODES.coverTooLarge);
    expect(codes(resolveLayout(presetConfig('ch-sd-3x1h-three-switches')))).not.toContain(WARNING_CODES.coverTooLarge);
  });

  it('no errors for any shipped preset', () => {
    for (const id of ['ch-sd-1x1', 'ch-sd-1x2v-switch-socket', 'ch-sd-2x2', 'de-1x2v', 'ch-sd-1x3v-switch-two-sockets']) {
      const f = resolveLayout(presetConfig(id));
      expect(f.warnings.filter((w) => w.severity === 'error'), id).toEqual([]);
    }
  });
});

describe('placed helpers', () => {
  it('placedDistance is exact for circles, stadiums and rotated shapes', () => {
    const a: Placed = { shape: { kind: 'circle', d: 10 }, x: 0, y: 0, rotDeg: 0 };
    const b: Placed = { shape: { kind: 'circle', d: 10 }, x: 20, y: 0, rotDeg: 0 };
    expect(placedDistance(a, b)).toBeCloseTo(10, 9);
    const s: Placed = { shape: { kind: 'stadium', w: 10, h: 40 }, x: 0, y: 0, rotDeg: 90 };
    expect(placedDistance(s, { ...b, x: 0, y: 20 })).toBeCloseTo(10, 9);
    expect(placedDistance(s, { ...b, x: 40, y: 0 })).toBeCloseTo(15, 9);
    expect(placedDistance(s, { ...b, x: 5, y: 0 })).toBeLessThan(0);
  });
});
