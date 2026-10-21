import { describe, expect, it } from 'vitest';
import { presetConfig } from '../src/config/presets';
import type { CoverConfig, ModuleConfig } from '../src/config/schema';
import type { CoverFrame, Placed, ResolvedFeature } from '../src/geometry/contract';
import {
  containmentMargin,
  insideDistance,
  offsetPlaced,
  outlineWorld,
  placedBounds,
  placedDistance,
  pointInPlaced,
} from '../src/geometry/shape2d';
import type { Shape2D, StyleLimits } from '../src/geometry/contract';
import { WARNING_CODES, backingGap, moduleAnchor, outerPlaced, resolveLayout } from '../src/layout/resolve';
import { getStyle } from '../src/styles';

type Pocket = Extract<ResolvedFeature, { kind: 'pocket' }>;
type Opening = Extract<ResolvedFeature, { kind: 'opening' }>;

const pockets = (f: CoverFrame) => f.features.filter((x): x is Pocket => x.kind === 'pocket');
/** The outer outline's sides (world mm). */
const sides = (f: CoverFrame) => ({
  left: f.outer.cx - f.outer.w / 2,
  right: f.outer.cx + f.outer.w / 2,
  bottom: f.outer.cy - f.outer.h / 2,
  top: f.outer.cy + f.outer.h / 2,
});
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
  c.grid = { ...c.grid, cols, rows, pitchX: 60, pitchY: 60 };
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

  it('grid offsets shift every anchor (and the features on them)', () => {
    const g = { ...grid(1, 2), pitchY: 31, offsetX: 0, offsetY: 3.5 };
    expect(moduleAnchor(g, 0, 0)).toEqual([0, 19]);
    expect(moduleAnchor(g, 0, 1)).toEqual([0, -12]);
    expect(moduleAnchor({ ...grid(2, 1), offsetX: -5, offsetY: 2 }, 1, 0)).toEqual([25, 2]);
    // omitted offsets are 0 (as in the schema)
    expect(moduleAnchor(grid(2, 1), 1, 0)).toEqual(moduleAnchor({ ...grid(2, 1), offsetX: 0, offsetY: 0 }, 1, 0));
    const c = withGrid(2, 1, [bilresa(0, 0), bilresa(1, 0, { dx: 2, dy: -3 })]);
    c.grid.offsetX = 7;
    c.grid.offsetY = -4;
    const f = resolveLayout(c);
    expect(pockets(f).map((p) => [p.anchor, p.placed.x, p.placed.y])).toEqual([
      [[-23, -4], -23, -4],
      [[37, -4], 39, -7],
    ]);
    // the holes follow the pockets, the rockers stay inside them
    for (const p of pockets(f)) expect(pointInPlaced(p.anchor, p.holes[0])).toBe(true);
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

  /** The switch + socket combo layout (one 90 × 90 plate), built by hand. */
  const comboLike = (dy = 15.9): CoverConfig => {
    const c = withGrid(1, 2, [bilresa(0, 0, { rot: 90, dy }), { col: 0, row: 1, role: 'outlet', rot: 0, dx: 0, dy: 0 }]);
    c.plate.h = 90;
    c.grid = { ...c.grid, pitchY: 31, offsetY: 3.5 };
    return c;
  };
  const wide: StyleLimits = { minFrame: 0, minFrontZ: 0, maxEdgeR: Infinity, edgeAllowance: 6, pocketEdgeAllowance: 1.5 };

  it('stops spreading where the rocker would leave its access hole; the edges shrink instead', () => {
    // no allowances: 3.6 mm ≥ minWall, nothing moves
    const plain = resolveLayout(comboLike());
    expect(pockets(plain)[0].placed.y).toBeCloseTo(34.9, 9);
    expect(codes(plain)).not.toContain(WARNING_CODES.pocketSpread);
    // 9.5 mm wanted (2 + 6 + 1.5) would put the pocket at 40.8 and its 34 mm hole (y ± 17) above
    // the rocker at y = 19: it stops at 36, the rocker on the hole's lower edge
    const f = resolveLayout(comboLike(), { limits: wide });
    const [p] = pockets(f);
    const [o] = openings(f);
    expect(p.placed.y).toBeCloseTo(36, 6);
    expect(pointInPlaced(p.anchor, p.holes[0])).toBe(true);
    expect(p.holes[0].y - 17).toBeCloseTo(19, 6);
    expect(placedDistance(p.placed, o.placed)).toBeCloseTo(4.7, 6);
    expect(codes(f)).toContain(WARNING_CODES.edgeReduced);
    expect(codes(f)).not.toContain(WARNING_CODES.accessUncovered);
    expect(f.warnings.find((w) => w.code === WARNING_CODES.pocketSpread)?.message).toMatch(/moved 1\.1 mm up .*rocker stays inside the access hole/);
    expect(f.warnings.filter((w) => w.severity !== 'info')).toEqual([]);
  });

  it('minWall still wins over access (then the rocker is reported uncovered)', () => {
    const c = comboLike();
    c.cover.minWall = 6; // pocket bottom ≥ 11 + 6 → centre 37.3, hole from 20.3
    const f = resolveLayout(c);
    const [p] = pockets(f);
    expect(placedDistance(p.placed, openings(f)[0].placed)).toBeCloseTo(6, 6);
    expect(p.placed.y).toBeCloseTo(37.3, 6);
    expect(f.warnings.find((w) => w.code === WARNING_CODES.accessUncovered)?.severity).toBe('error');
  });

  it('does not hold back a pocket whose rocker is already outside its hole (dx/dy by hand)', () => {
    const c = comboLike();
    c.modules[0].dx = 25; // the rotated hole spans x ± 19.56 around the pocket: the rocker (x 0) is outside
    const f = resolveLayout(c, { limits: wide });
    const [p] = pockets(f);
    expect(placedDistance(p.placed, openings(f)[0].placed)).toBeCloseTo(9.5, 6);
    expect(codes(f)).not.toContain(WARNING_CODES.edgeReduced);
    expect(codes(f)).toContain(WARNING_CODES.accessUncovered);
  });

  it('holds back both pockets of a pair symmetrically', () => {
    const c = presetConfig('ch-sd-1x2v-two-switches');
    c.modules = c.modules.map((m) => ({ ...m, rot: 0 }));
    // 42 mm wanted between the two unrotated pockets: 26.3 mm each, but the 39.12 mm long holes
    // (y ± 19.56) keep their rockers only up to 19.56
    const f = resolveLayout(c, { limits: { minFrame: 0, minFrontZ: 0, maxEdgeR: Infinity, edgeAllowance: 20 } });
    const [top, bottom] = pockets(f);
    expect(top.placed.y - 30).toBeCloseTo(19.56, 6);
    expect(bottom.placed.y + 30).toBeCloseTo(-19.56, 6);
    for (const p of [top, bottom]) expect(pointInPlaced(p.anchor, p.holes[0])).toBe(true);
    expect(codes(f)).toContain(WARNING_CODES.edgeReduced);
    expect(codes(f)).not.toContain(WARNING_CODES.accessUncovered);
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
    expect(f.frontZ).toBeCloseTo(12 + 2 + 3 + 10, 9);
    expect(pockets(f)[0].floorZ).toBeCloseTo(f.frontZ - 10, 9);
    expect(pockets(f)[0].stripDepth).toBeCloseTo(1 + 0.2, 9);
    expect(pockets(f)[0].backFilletR).toBe(8);
  });

  it('clamps floorT to stripDepth + 1.2 with a warning', () => {
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.strip.protrusion = 2;
    c.bilresa.floorT = 2.2;
    const f = resolveLayout(c);
    expect(f.floorT).toBeCloseTo(2 + 0.2 + 1.2, 9);
    expect(codes(f)).toContain(WARNING_CODES.floorClamped);
    expect(f.frontZ).toBeCloseTo(12 + 2 + 3.4 + 10, 9);
    // the shipped defaults (floorT 2.2, strip 1.0 + tol 0.2) are clamped to 2.4
    expect(resolveLayout(presetConfig('ch-sd-1x1')).floorT).toBeCloseTo(2.4, 9);
  });

  it('uses the deepest per-module pocket and the style minimum', () => {
    const c = withGrid(2, 1, [bilresa(0, 0), bilresa(1, 0, { bilresa: { variant: 'wheel', pocketDepth: 11 } })]);
    c.bilresa.floorT = 3;
    const f = resolveLayout(c);
    expect(f.frontZ).toBeCloseTo(12 + 2 + 3 + 11, 9);
    expect(pockets(f).map((p) => p.floorZ)).toEqual([f.frontZ - 10, f.frontZ - 11]);
    const raised = resolveLayout(c, { limits: { minFrame: 0, minFrontZ: 40, maxEdgeR: 5 } });
    expect(raised.frontZ).toBe(40);
    expect(codes(raised)).toContain(WARNING_CODES.frontRaised);
  });
});

describe('outer size', () => {
  it('auto size wraps the plate (+clearance +skirt); symmetric content stays centred on the plate', () => {
    const f = resolveLayout(presetConfig('ch-sd-1x1'));
    // 90 + 2·(1 + 2.4) both ways: the plate sets the size. The pocket (35.3 + minWall 2 + margin 4)
    // and the finger notch (end at 35.3 + 7, + minWall 2) fit inside; the notch backing ending
    // 1.7 mm short of the skirt is bridged to it by the pocket feature, the cover does not grow.
    expect(f.outer).toMatchObject({ w: 96.8, h: 96.8, cx: 0, cy: 0, cornerR: 6.4, autoW: 96.8, autoH: 96.8 });
  });

  it('grows only on the side a shifted pocket needs (the outline is the union of the requirement boxes)', () => {
    const c = presetConfig('ch-sd-1x1');
    c.modules[0].dx = 20;
    // pocket half width 20.3 + 20 shift + minWall 2 + margin 4 = 46.3 < 48.4 (plate wins)
    expect(resolveLayout(c).outer).toMatchObject({ w: 96.8, cx: 0 });
    c.modules[0].dx = 30;
    const g = resolveLayout(c);
    // right: 30 + 20.3 + 6 = 56.3 (the pocket), left: −48.4 (the plate + clearance + skirt)
    expect(sides(g).right).toBeCloseTo(56.3, 6);
    expect(sides(g).left).toBeCloseTo(-48.4, 6);
    expect(g.outer.w).toBeCloseTo(104.7, 6);
    expect(g.outer.cx).toBeCloseTo((56.3 - 48.4) / 2, 6);
    expect(g.outer).toMatchObject({ h: 96.8, cy: 0 });
    const b = placedBounds(offsetPlaced(pockets(g)[0].placed, 6));
    expect(b.maxX).toBeLessThanOrEqual(sides(g).right + 1e-6);
    // mirrored: the left side grows instead, by the same amount
    c.modules[0].dx = -30;
    const m = resolveLayout(c);
    expect(m.outer.w).toBe(g.outer.w);
    expect(m.outer.cx).toBeCloseTo(-g.outer.cx, 9);
  });

  it('a manual size ≥ auto is centred on the automatic outline', () => {
    const c = presetConfig('ch-sd-1x1');
    c.modules[0].dx = 30;
    const auto = resolveLayout(c).outer;
    c.cover.size = { w: 130, h: 100 };
    const f = resolveLayout(c);
    expect(f.outer).toMatchObject({ w: 130, h: 100, cx: auto.cx, cy: auto.cy, autoW: auto.autoW, autoH: auto.autoH });
    expect(sides(f).right - sides(resolveLayout({ ...c, cover: { ...c.cover, size: 'auto' } })).right).toBeCloseTo((130 - auto.w) / 2, 9);
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

  it('style minFrame keeps features and finger notches (not the plate) away from the edge', () => {
    const lim = (minFrame: number): StyleLimits => ({ minFrame, minFrontZ: 0, maxEdgeR: 5 });
    // 5 mm: pocket (35.3 + 6) and notch (42.3 + 5) fit inside the plate-driven 48.4
    expect(resolveLayout(presetConfig('ch-sd-1x1'), { limits: lim(5) }).outer).toMatchObject({ w: 96.8, h: 96.8, cy: 0 });
    // 10 mm: the pocket still fits (35.3 + 10), the notch (bottom end 42.3) needs 52.3 below the
    // centre; only the bottom grows, the top stays plate-driven
    const ten = resolveLayout(presetConfig('ch-sd-1x1'), { limits: lim(10) });
    expect(ten.outer).toMatchObject({ w: 96.8, h: 100.7 });
    expect(sides(ten).top).toBeCloseTo(48.4, 6);
    expect(sides(ten).bottom).toBeCloseTo(-52.3, 6);
    const f = resolveLayout(presetConfig('ch-sd-1x1'), { limits: lim(20) });
    expect(f.outer.w).toBe(96.8);
    expect(sides(f).bottom).toBeCloseTo(-(35.3 + 7 + 20), 6); // the notch
    expect(sides(f).top).toBeCloseTo(35.3 + 20, 6); // the pocket
    // without a notch the pocket alone sets it, symmetrically
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.notch.enabled = false;
    expect(resolveLayout(c, { limits: lim(20) }).outer.h).toBeCloseTo(2 * (35.3 + 20), 2);
    expect(resolveLayout(c, { limits: lim(20) }).outer.cy).toBe(0);
  });
});

describe('style limits: edge allowance, corner radius, plate inset', () => {
  const base: StyleLimits = { minFrame: 0, minFrontZ: 0, maxEdgeR: Infinity };

  it('spaces a pocket from an outlet by minWall + both edge allowances; outlets stay put', () => {
    const limits = { ...base, edgeAllowance: 6, pocketEdgeAllowance: 1.5 };
    const f = resolveLayout(presetConfig('ch-sd-1x2v-switch-socket'), { limits });
    const [p] = pockets(f);
    const [o] = openings(f);
    expect(o.placed.y).toBe(-30);
    expect(placedDistance(p.placed, o.placed)).toBeCloseTo(2 + 6 + 1.5, 6);
    expect(p.placed.y).toBeCloseTo(-30 + 23 + 9.5 + 35.3, 6);
    expect(codes(f)).not.toContain(WARNING_CODES.edgeReduced);
    // pocketEdgeAllowance defaults to edgeAllowance
    const both = resolveLayout(presetConfig('ch-sd-1x2v-switch-socket'), { limits: { ...base, edgeAllowance: 3 } });
    expect(placedDistance(pockets(both)[0].placed, openings(both)[0].placed)).toBeCloseTo(2 + 3 + 3, 6);
  });

  it('keeps every feature inside the outline by minWall + margin + its edge allowance', () => {
    const limits = { ...base, minFrame: 9, edgeAllowance: 6, pocketEdgeAllowance: 1.5 };
    for (const id of ['ch-sd-1x2v-switch-socket', 'ch-sd-1x3v-switch-two-sockets', 'ch-sd-2x2', 'de-1x2v']) {
      const c = presetConfig(id);
      const f = resolveLayout(c, { limits });
      const outer = outerPlaced(f);
      for (const x of f.features) {
        const allow = x.kind === 'pocket' ? 1.5 : 6;
        expect(containmentMargin(x.placed, outer), `${id} ${x.id}`).toBeGreaterThanOrEqual(9 + allow - 1e-6);
      }
    }
  });

  it('reports (info) features placed closer than their edges need, (error) closer than minWall', () => {
    // Diagonal neighbours are never spread: a pocket moved towards the outlet below-right of it.
    const outlet: ModuleConfig = { col: 1, row: 1, role: 'outlet', rot: 0, dx: 0, dy: 0 };
    const c = withGrid(2, 2, [bilresa(0, 0, { dx: 20, dy: -20 }), outlet]);
    const limits = { ...base, edgeAllowance: 6, pocketEdgeAllowance: 1.5 };
    const f = resolveLayout(c, { limits });
    const gap = placedDistance(pockets(f)[0].placed, openings(f)[0].placed);
    expect(gap).toBeGreaterThan(2);
    expect(gap).toBeLessThan(2 + 6 + 1.5);
    expect(f.warnings.find((w) => w.code === WARNING_CODES.edgeReduced)?.severity).toBe('info');
    expect(codes(f)).not.toContain(WARNING_CODES.featureOverlap);
    expect(codes(resolveLayout(c))).not.toContain(WARNING_CODES.edgeReduced); // no allowance, no note
    c.modules[0] = bilresa(0, 0, { dx: 25, dy: -25 });
    expect(codes(resolveLayout(c, { limits }))).toContain(WARNING_CODES.featureOverlap);
  });

  it('sets the outer corner radius from limits.cornerR, clamped to ≥ plate corner + clearance + skirt', () => {
    const c = presetConfig('ch-sd-1x1');
    expect(resolveLayout(c, { limits: { ...base, cornerR: 14 } }).outer.cornerR).toBe(14);
    expect(resolveLayout(c, { limits: { ...base, cornerR: 2 } }).outer.cornerR).toBeCloseTo(3 + 1 + 2.4, 9);
    expect(resolveLayout(c).outer.cornerR).toBeCloseTo(6.4, 9);
    // never more than half the smaller side
    const small = presetConfig('custom');
    small.plate = { ...small.plate, w: 30, h: 30, cornerR: 3 };
    small.modules = [];
    const g = resolveLayout(small, { limits: { ...base, cornerR: 40 } });
    expect(g.outer.cornerR).toBeLessThanOrEqual(Math.min(g.outer.w, g.outer.h) / 2 + 1e-9);
  });

  it.each([6.4, 8, 14, 20, 30])('cornerR %d: frame = clearance + skirtT + (Rc − rp)(1 − 1/√2), plate fits the cavity corner', (R) => {
    const c = presetConfig('ch-sd-1x1');
    c.modules = []; // the plate alone sets the size
    const f = resolveLayout(c, { limits: { ...base, cornerR: R } });
    const { skirtT } = c.cover;
    const rp = c.plate.cornerR + c.cover.clearance;
    const extra = Math.max(0, (R - skirtT - rp) * (1 - Math.SQRT1_2));
    expect(f.outer.cornerR).toBeCloseTo(R, 9);
    // sizes are ceiled to 0.01; tight corners get the chord allowance (≤ 0.12 mm) on top
    expect(f.outer.w).toBeGreaterThanOrEqual(90 + 2 * (1 + skirtT + extra) - 1e-9);
    expect(f.outer.w).toBeLessThanOrEqual(90 + 2 * (1 + skirtT + extra) + 0.25);
    // geometric check: the plate + clearance outline stays inside the cavity outline …
    const cavity = outerPlaced(f, skirtT);
    const plateZone = { shape: { kind: 'roundedRect' as const, w: 92, h: 92, r: rp }, x: 0, y: 0, rotDeg: 0 };
    const margin = containmentMargin(plateZone, cavity);
    expect(margin).toBeGreaterThanOrEqual(-1e-9);
    const sampled = Math.min(...outlineWorld(plateZone, 0, 720).map((v) => insideDistance(cavity, v)));
    expect(sampled).toBeGreaterThanOrEqual(-1e-9);
    // … and (no wasted frame) touches it, up to the meshing allowance and the 0.01 mm size rounding
    expect(margin).toBeLessThan(0.15);
  });

  it('pushes the plate under the part of a deep edge profile that is high enough (edgeInset)', () => {
    const c = presetConfig('ch-sd-1x1');
    const seen: number[] = [];
    const edgeInset = (drop: number) => {
      seen.push(drop);
      return drop >= 10 ? 0 : 12; // a 10 mm deep, 12 mm wide edge
    };
    const f = resolveLayout(c, { limits: { ...base, edgeInset } });
    // budget = frontZ − (plate top + rocker gap under the pocket floor) − skinT − skirtT
    expect(seen[0]).toBeCloseTo(26.4 - 14 - 3 - 2.4, 9);
    expect(f.outer.w).toBeCloseTo(92 + 2 * 12, 6);
    expect(resolveLayout(c, { limits: { ...base, edgeInset: () => 0 } }).outer.w).toBe(96.8);
  });
});

describe('finger notch: inside the frame like other features, no growth for the backing', () => {
  const STYLE_LIKE: Record<string, StyleLimits> = {
    none: { minFrame: 0, minFrontZ: 0, maxEdgeR: Infinity },
    allowances: { minFrame: 0, minFrontZ: 0, maxEdgeR: Infinity, edgeAllowance: 1, pocketEdgeAllowance: 0.6 },
    rounded: { minFrame: 9, minFrontZ: 0, maxEdgeR: Infinity, edgeAllowance: 6, pocketEdgeAllowance: 1.5, cornerR: 14 },
  };
  const ids = ['ch-sd-1x1', 'ch-sd-1x2v-switch-socket', 'ch-sd-2x1h-two-switches', 'ch-sd-1x2v-two-switches', 'ch-sd-1x3v-switch-two-sockets', 'ch-sd-2x2', 'de-1x1', 'de-2x1h'];
  it.each(ids.flatMap((id) => Object.keys(STYLE_LIKE).map((k) => [id, k] as const)))('%s (%s): notch + max(minWall, minFrame) + allowance inside, manual = auto', (id, k) => {
    const c = presetConfig(id);
    const limits = STYLE_LIKE[k];
    const auto = resolveLayout(c, { limits });
    c.cover.size = { w: auto.outer.autoW, h: auto.outer.autoH };
    const manual = resolveLayout(c, { limits });
    expect(manual.outer).toEqual(auto.outer);
    const need = Math.max(c.cover.minWall, limits.minFrame) + (limits.pocketEdgeAllowance ?? limits.edgeAllowance ?? 0);
    for (const f of [auto, manual]) {
      for (const p of pockets(f)) {
        expect(p.notch!.shape).toEqual({ kind: 'circle', d: 14 });
        expect(containmentMargin(p.notch!, outerPlaced(f)), p.id).toBeGreaterThanOrEqual(need - 1e-6);
        // so the backing (notch + minWall) always fits the outline
        expect(containmentMargin(offsetPlaced(p.notch!, f.minWall), outerPlaced(f))).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('a backing ending 0 … minWall short of the skirt no longer grows the cover (the pocket feature bridges it)', () => {
    const f = resolveLayout(presetConfig('ch-sd-1x1'));
    const [p] = pockets(f);
    const g = backingGap(f.outer, f.skirtT, offsetPlaced(p.notch!, f.minWall));
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(f.minWall);
    expect(f.outer.h).toBe(96.8); // plate-driven
  });
});

describe('finger notch in the edge zone (CoverStyle.allowsNotchInEdge)', () => {
  const plateOf = (c: CoverConfig): CoverFrame['plate'] => ({
    w: c.plate.w,
    h: c.plate.h,
    protrusion: c.plate.depth,
    cornerR: c.plate.cornerR,
    clearance: c.cover.clearance,
  });
  const styled = (styleId: string, allowsNotchInEdge: boolean, presetId = 'ch-sd-1x1') => {
    const style = getStyle(styleId)!;
    const c = presetConfig(presetId);
    const params = style.params.parse({}) as Record<string, unknown>;
    return resolveLayout(c, { limits: style.limits(params, plateOf(c)), allowsNotchInEdge });
  };

  it('1×1 faceted: 96.8 × 102.7 with the notch off the bevel, the plate-driven 96.8 × 96.8 when the notch may enter it', () => {
    // minFrame 11 (bevel 7 + groove 1 + 3) + chamfer 1: the notch end at −42.3 needs −54.3 (only
    // the bottom grows; the top stays at the plate-driven 48.4)
    expect(styled('faceted', false).outer).toMatchObject({ w: 96.8, h: 102.7 });
    expect(sides(styled('faceted', false)).bottom).toBeCloseTo(-54.3, 6);
    const f = styled('faceted', true);
    expect(f.outer).toMatchObject({ w: 96.8, h: 96.8, autoW: 96.8, autoH: 96.8 });
    expect(getStyle('faceted')!.allowsNotchInEdge).toBe(true);
    // the notch keeps minWall + the rim chamfer inside the outline …
    const [p] = pockets(f);
    expect(containmentMargin(p.notch!, outerPlaced(f))).toBeCloseTo(48.4 - 42.3, 6);
    expect(containmentMargin(p.notch!, outerPlaced(f))).toBeGreaterThanOrEqual(2 + 1);
    // … and its backing reaches into the skirt's merge zone
    const g = backingGap(f.outer, f.skirtT, offsetPlaced(p.notch!, f.minWall));
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(f.minWall);
  });

  it('1×1 stepped: 96.8 × 98.3 with the notch on the top tier, 96.8 × 96.8 when it may enter the step', () => {
    // minFrame 7 (step 5 + 2) + chamfer 0.6: the notch end at −42.3 needs −49.9 (bottom only)
    expect(styled('stepped', false).outer).toMatchObject({ w: 96.8, h: 98.3 });
    expect(sides(styled('stepped', false)).bottom).toBeCloseTo(-49.9, 6);
    expect(styled('stepped', true).outer).toMatchObject({ w: 96.8, h: 96.8 });
    expect(getStyle('stepped')!.allowsNotchInEdge).toBe(true);
  });

  it('1×1 organic: the notch no longer adds 2.1 mm at the bottom; the rounded corner still sets the width', () => {
    // minFrame 9 (fillet 8 + 1) + fillet 1.5: the notch end at −42.3 needs −52.8; top 101.33 / 2
    expect(styled('organic', false).outer).toMatchObject({ w: 101.33, h: 103.47 });
    expect(sides(styled('organic', false)).bottom).toBeCloseTo(-52.8, 2); // (+ half the 0.01 rounding)
    expect(styled('organic', true).outer).toMatchObject({ w: 101.33, h: 101.33 });
    expect(getStyle('organic')!.allowsNotchInEdge).toBe(true);
  });

  it('minimal and box keep notches off nothing (minFrame 0): the flag changes nothing', () => {
    for (const id of ['minimal', 'box']) {
      expect(getStyle(id)!.allowsNotchInEdge).toBeUndefined();
      expect(styled(id, true).outer).toEqual(styled(id, false).outer);
    }
  });

  it('only the notch rule changes: pockets and openings keep max(minWall + margin, minFrame) + allowance', () => {
    for (const styleId of ['faceted', 'stepped', 'organic']) {
      const c = presetConfig('ch-sd-1x1');
      c.bilresa.notch.enabled = false;
      const style = getStyle(styleId)!;
      const params = style.params.parse({}) as Record<string, unknown>;
      const limits = style.limits(params, plateOf(c));
      expect(resolveLayout(c, { limits, allowsNotchInEdge: true }).outer).toEqual(resolveLayout(c, { limits }).outer);
    }
  });

  it.each([
    ['ch-sd-1x1', 'faceted'],
    ['ch-sd-1x2v-switch-socket', 'faceted'],
    ['ch-sd-2x2', 'faceted'],
    ['ch-sd-1x1', 'stepped'],
    ['ch-sd-1x2v-switch-socket', 'stepped'],
    ['ch-sd-1x2v-two-switches', 'stepped'],
    ['ch-sd-1x1', 'organic'],
    ['ch-sd-3x1h-three-switches', 'organic'],
    ['de-1x2v', 'organic'],
  ])('%s %s: notch + minWall + allowance inside the outline, backing inside the cavity, manual = auto', (presetId, styleId) => {
    const style = getStyle(styleId)!;
    const c = presetConfig(presetId);
    const params = style.params.parse({}) as Record<string, unknown>;
    const limits = style.limits(params, plateOf(c));
    const auto = resolveLayout(c, { limits, allowsNotchInEdge: true });
    c.cover.size = { w: auto.outer.autoW, h: auto.outer.autoH };
    const manual = resolveLayout(c, { limits, allowsNotchInEdge: true });
    expect(manual.outer).toEqual(auto.outer);
    const need = c.cover.minWall + (limits.pocketEdgeAllowance ?? limits.edgeAllowance ?? 0);
    for (const p of pockets(auto)) {
      expect(containmentMargin(p.notch!, outerPlaced(auto)), p.id).toBeGreaterThanOrEqual(need - 1e-6);
      expect(containmentMargin(offsetPlaced(p.notch!, auto.minWall), outerPlaced(auto, auto.skirtT)), p.id).toBeGreaterThanOrEqual(-auto.minWall);
    }
    expect(auto.warnings.filter((w) => w.severity === 'error')).toEqual([]);
  });
});

describe('access hole (one bridge hole under the strip)', () => {
  /** Hole checks: centred on the pocket, oriented with it, hidden behind the Bilresa, ledges ≥ stripLedge. */
  function checkHole(p: Pocket, c: CoverConfig) {
    expect(p.holes).toHaveLength(1);
    const [h] = p.holes;
    expect([h.x, h.y, h.rotDeg]).toEqual([p.placed.x, p.placed.y, p.placed.rotDeg]);
    expect(h.shape.kind).toBe('roundedRect');
    const s = h.shape as Extract<Shape2D, { kind: 'roundedRect' }>;
    expect(s.r).toBeCloseTo(Math.min(1.5, s.w / 2, s.h / 2), 9);
    // hidden behind the Bilresa: inside the pocket outline inset by hiddenMargin (and so inside the well)
    expect(containmentMargin(h, offsetPlaced(p.placed, -c.bilresa.hiddenMargin))).toBeGreaterThanOrEqual(-1e-6);
    expect(containmentMargin(h, offsetPlaced(p.placed, c.cover.minWall))).toBeGreaterThan(0);
    // both glue ledges keep at least stripLedge
    const ledge = (c.bilresa.strip.l - s.h) / 2 - Math.abs(c.bilresa.strip.dy);
    expect(ledge).toBeGreaterThanOrEqual(c.bilresa.stripLedge - 1e-6);
    return s;
  }

  it('default pocket: 34 mm wide, shortened from 44 (= 52 − 2·4) to fit the inset end caps; 6 mm gaps (info)', () => {
    const c = presetConfig('ch-sd-1x1');
    const f = resolveLayout(c);
    const [p] = pockets(f);
    const s = checkHole(p, c);
    expect(s.w).toBe(34); // min(34, 40.6 − 2·3)
    // a 34 mm wide rounded rect (r 1.5) inside the 34.6 × 64.6 inset stadium: ≤ 39.12 long
    expect(s.h).toBeCloseTo(39.12, 2);
    expect(pointInPlaced(p.anchor, p.holes[0])).toBe(true);
    const narrow = f.warnings.find((w) => w.code === WARNING_CODES.accessNarrow);
    expect(narrow?.severity).toBe('info');
    expect(narrow?.message).toMatch(/6 and 6 mm/);
    expect(codes(f)).not.toContain(WARNING_CODES.accessUncovered);
    expect(codes(f)).not.toContain(WARNING_CODES.accessNone);
  });

  it('length = strip.l − 2·stripLedge when that fits; a wider strip ledge shortens it', () => {
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.stripLedge = 8;
    const [p] = pockets(resolveLayout(c));
    expect(checkHole(p, c).h).toBeCloseTo(52 - 16, 9);
    c.bilresa.strip.dy = 2; // off-centre strip: both ledges keep 8 mm
    const [q] = pockets(resolveLayout(c));
    expect(checkHole(q, c).h).toBeCloseTo(52 - 16 - 4, 9);
  });

  it('width = min(access.w, pocket width − 2·hiddenMargin); the wheel pocket is wider', () => {
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.access.w = 60;
    expect(checkHole(pockets(resolveLayout(c))[0], c).w).toBeCloseTo(40.6 - 6, 9);
    c.modules[0].bilresa = { variant: 'wheel' };
    expect(checkHole(pockets(resolveLayout(c))[0], c).w).toBeCloseTo(45.6 - 6, 9);
    c.bilresa.access.w = 40;
    const f = resolveLayout(c);
    checkHole(pockets(f)[0], c);
    // (40 − 22) / 2 = 9 mm beside the strip: wide enough, no note
    expect(codes(f)).not.toContain(WARNING_CODES.accessNarrow);
  });

  it.each([
    [0, 0, 0],
    [5, 0, 0],
    [-7, 3, 0],
    [0, 9, 0],
    [4, -6, 90],
    [-3, 5, 90],
  ])('follows the pocket after dx=%d dy=%d rot=%d; the rocker stays inside the hole', (dx, dy, rot) => {
    const c = presetConfig('ch-sd-1x1');
    c.modules[0] = { ...c.modules[0], dx, dy, rot: rot as 0 | 90 };
    const f = resolveLayout(c);
    const [p] = pockets(f);
    checkHole(p, c);
    expect(pointInPlaced(p.anchor, p.holes[0])).toBe(true);
    expect(codes(f)).not.toContain(WARNING_CODES.accessUncovered);
  });

  it('a pocket moved off its rocker: the anchor outside the hole is an error', () => {
    const c = presetConfig('ch-sd-1x1');
    c.modules[0].dy = 25;
    const f = resolveLayout(c);
    const [p] = pockets(f);
    checkHole(p, c);
    expect(f.warnings.find((w) => w.code === WARNING_CODES.accessUncovered)?.severity).toBe('error');
  });

  it('no hole (warning) when nothing fits; strip covering the hole is a warning too', () => {
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.stripLedge = 26; // 51 − 52 < 0
    const f = resolveLayout(c);
    expect(pockets(f)[0].holes).toHaveLength(0);
    expect(f.warnings.find((w) => w.code === WARNING_CODES.accessNone)?.severity).toBe('warning');
    const d = presetConfig('ch-sd-1x1');
    d.bilresa.strip.w = 40;
    const g = resolveLayout(d);
    expect(pockets(g)[0].holes).toHaveLength(1);
    expect(g.warnings.find((w) => w.code === WARNING_CODES.accessNone)?.message).toMatch(/covers the whole/);
  });

  it('every shipped preset: one hole per pocket, rocker inside, no errors', () => {
    for (const id of ['ch-sd-1x1', 'ch-sd-1x2v-switch-socket', 'ch-sd-2x1h-two-switches', 'ch-sd-1x2v-two-switches', 'ch-sd-1x3v-switch-two-sockets', 'ch-sd-3x1h-three-switches', 'ch-sd-2x2', 'de-1x1', 'de-1x2v', 'de-2x1h']) {
      const c = presetConfig(id);
      for (const limits of [undefined, { minFrame: 9, minFrontZ: 0, maxEdgeR: 14, edgeAllowance: 6, pocketEdgeAllowance: 1.5, cornerR: 14 }]) {
        const f = resolveLayout(c, limits ? { limits } : undefined);
        for (const p of pockets(f)) {
          checkHole(p, c);
          expect(pointInPlaced(p.anchor, p.holes[0]), `${id} ${p.id}`).toBe(true);
        }
        expect(f.warnings.filter((w) => w.severity === 'error'), id).toEqual([]);
      }
    }
  });
});

describe('features', () => {
  it('pocket outline = Bilresa outline + clearance, strip = strip + tolerance', () => {
    const [p] = pockets(resolveLayout(presetConfig('ch-sd-1x1')));
    expect(p.placed.shape).toEqual({ kind: 'stadium', w: 40.6, h: 70.6 });
    expect(p.strip.shape).toEqual({ kind: 'stadium', w: 22.4, h: 52.4 });
    expect(p.backFilletR).toBe(8);
    expect(p.variant).toBe('2button');
  });

  it('notch sits at the pocket end farthest from the plate centre', () => {
    const top = pockets(resolveLayout(presetConfig('ch-sd-1x2v-switch-socket')))[0];
    expect(top.notch).toMatchObject({ shape: { kind: 'circle', d: 14 }, x: 0 });
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
    // default: frontZ = 12 + 2 + 2.4 + 10 = 26.4 → 14.4 mm tunnel, no warning
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
