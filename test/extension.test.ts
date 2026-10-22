/**
 * Extension plates (part.kind 'extension'): a solid slab beside the plate, flush with its face,
 * holding the Bilresa in a pocket whose rim rises above the face through a cove. Resolved
 * numbers for the two presets and the other sides, the built geometry (probes through the strip
 * indent, the floor, the rim and the cove), the seated Bilresa model, the test-fit part and the
 * worker's face-up export.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { BILRESA_VARIANTS, DEFAULT_PART, EXTENSION_EDGE_CHAMFER, MIN_EXTENSION_FACE } from '../src/config/defaults';
import { getPreset, presetConfig } from '../src/config/presets';
import { CoverConfigSchema, DEFAULT_CONFIG, type CoverConfig, type ModuleConfig } from '../src/config/schema';
import { decodeHash, encodeHash } from '../src/config/urlCodec';
import { buildCover, expectedGenus } from '../src/geometry/buildCover';
import { buildTestFit } from '../src/geometry/buildTestFit';
import type { CoverFrame, Kit } from '../src/geometry/contract';
import { notchFloor, type PocketFeature } from '../src/geometry/features';
import { liveObjectCount, withScope } from '../src/geometry/kit';
import { containmentMargin, offsetPlaced, pointInPlaced, toWorld } from '../src/geometry/shape2d';
import { WARNING_CODES, outerPlaced, resolveLayout } from '../src/layout/resolve';
import { rimRise, sideAxes } from '../src/layout/resolveExtension';
import { getStyle, listStyles, partStyle, stylePrintOrientation } from '../src/styles';
import { coveZ, extensionStyle, humpSurfaceZ } from '../src/styles/extension';
import { deriveFrame, heightSummary, stlFilename, topZ } from '../src/ui/derive';
import { handleRequest } from '../src/worker/handler';
import { isBuildError } from '../src/geometry/contract';
import { getKit, getWasm } from './helpers/manifold';
import { column, intersectionVolume, pocketProbePoints, seatedBilresa, topOfIntersection } from './helpers/probes';

const H = 'ch-sd-ext-top-h';
const V = 'ch-sd-ext-top-v';
const TOL = 0.05;

const pocketOf = (f: CoverFrame) => f.features.find((x): x is PocketFeature => x.kind === 'pocket')!;
const pockets = (f: CoverFrame) => f.features.filter((x): x is PocketFeature => x.kind === 'pocket');
const codes = (f: CoverFrame) => f.warnings.map((w) => w.code);
const ext = (f: CoverFrame) => {
  if (f.part.kind !== 'extension') throw new Error('not an extension frame');
  return f.part;
};
const sides = (f: CoverFrame) => ({
  left: f.outer.cx - f.outer.w / 2,
  right: f.outer.cx + f.outer.w / 2,
  bottom: f.outer.cy - f.outer.h / 2,
  top: f.outer.cy + f.outer.h / 2,
});

/** Room a pocket needs beyond its outline: rim + max(cove + chamfer, margin) + rim chamfer. */
const REACH = 2 + Math.max(6 + EXTENSION_EDGE_CHAMFER, 4) + 0.6; // 9.6

describe('config: part kind', () => {
  it('defaults to a cap; every cap preset and old link carries the default part', () => {
    expect(DEFAULT_PART).toEqual({ kind: 'cap', side: 'top', gap: 0, flare: 6 });
    expect(DEFAULT_CONFIG.part).toEqual(DEFAULT_PART);
    const { part: _p, ...withoutPart } = presetConfig('ch-sd-1x1');
    expect(CoverConfigSchema.parse(withoutPart).part).toEqual(DEFAULT_PART);
    expect(CoverConfigSchema.parse({ ...withoutPart, part: { kind: 'extension' } }).part).toEqual({ ...DEFAULT_PART, kind: 'extension' });
    for (const id of [H, V]) expect(getPreset(id)!.config.part).toEqual({ ...DEFAULT_PART, kind: 'extension', side: 'top' });
  });

  it('round-trips through the URL hash', () => {
    const c = presetConfig(V);
    c.part.side = 'left';
    c.part.gap = 1.5;
    c.part.flare = 4;
    const back = decodeHash(encodeHash(c));
    expect(back.warnings).toEqual([]);
    expect(back.config).toEqual(c);
  });

  it('picks the internal extension style, which is not in the registry', () => {
    expect(getStyle('extension')).toBeUndefined();
    expect(listStyles().some((s) => s.id === 'extension')).toBe(false);
    const c = presetConfig(H);
    c.cover.style = 'organic';
    c.cover.styleParams = { domeSag: 2 };
    const { style, rawParams } = partStyle(c);
    expect(style.id).toBe('extension');
    expect(rawParams).toEqual({});
    expect(stylePrintOrientation(style, {})).toBe('faceUp');
    expect(partStyle(presetConfig('ch-sd-1x1')).style.id).toBe('minimal');
    expect(extensionStyle.params.parse({})).toEqual({});
  });
});

describe('resolver: lying Bilresa above a 90 × 90 plate (ch-sd-ext-top-h)', () => {
  const f = resolveLayout(presetConfig(H));

  it('is one 90 × 60 module cell right above the plate, with the plate corner radius', () => {
    expect(f.part).toMatchObject({ kind: 'extension', side: 'top', gap: 0, origin: [0, 75], flare: 6 });
    expect(ext(f).rise).toBeCloseTo(4.4, 9);
    expect(f.outer).toMatchObject({ w: 90, h: 60, cx: 0, cy: 75, cornerR: 3, autoW: 90, autoH: 60 });
    expect(sides(f)).toEqual({ left: -45, right: 45, bottom: 45, top: 105 });
    expect(f.plate).toEqual({ w: 90, h: 90, protrusion: 12, cornerR: 3, clearance: 1 });
    expect(f.frontZ).toBe(12);
    expect(f.warnings).toEqual([]);
  });

  it('holds the pocket in the cell centre: floor on 2.4 mm, rim 4.4 mm above the face, no access hole', () => {
    const p = pocketOf(f);
    expect(p.anchor).toEqual([0, 75]);
    expect(p.placed).toMatchObject({ shape: { kind: 'stadium', w: 40.6, h: 70.6 }, x: 0, y: 75, rotDeg: 90 });
    expect(p.floorZ).toBeCloseTo(2.4, 9);
    expect(p.rimZ).toBeCloseTo(16.4, 9);
    expect(p.holes).toEqual([]);
    expect(p.notch).toBeUndefined();
    expect(p.strip).toMatchObject({ x: 0, y: 75, rotDeg: 90, shape: { kind: 'stadium', w: 22.4, h: 52.4 } });
    expect(p.stripDepth).toBeCloseTo(1.2, 9);
    expect(f.floorT).toBe(2.4);
    // the lying pocket + rim + cove (+ chamfer, rim chamfer) just fits the plate's width
    expect(70.6 + 2 * REACH).toBeCloseTo(89.8, 9);
    expect(containmentMargin(offsetPlaced(p.placed, REACH), outerPlaced(f))).toBeGreaterThanOrEqual(-1e-9);
    expect(expectedGenus(f)).toBe(0);
  });

  it('the cove profile: vertical at the rim, flat at its foot; surfaceZ follows it', () => {
    expect(coveZ(12, 4.4, 6, 0)).toBeCloseTo(16.4, 9);
    expect(coveZ(12, 4.4, 6, 6)).toBeCloseTo(12, 9);
    expect(coveZ(12, 4.4, 6, 3)).toBeCloseTo(12 + 4.4 * (1 - Math.sqrt(0.75)), 9);
    expect(coveZ(12, 0, 6, 3)).toBe(12);
    const p = pocketOf(f);
    // across the lying pocket (world y): outline at 75 ± 20.3, rim to 22.3, cove to 28.3
    expect(humpSurfaceZ(f, 0, 75)).toBeCloseTo(16.4, 9);
    expect(humpSurfaceZ(f, 0, 75 + 20.3 + 1)).toBeCloseTo(16.4, 9);
    expect(humpSurfaceZ(f, 0, 75 + 22.3 + 3)).toBeCloseTo(coveZ(12, 4.4, 6, 3), 9);
    expect(humpSurfaceZ(f, 0, 75 + 28.3 + 0.5)).toBe(12);
    expect(humpSurfaceZ(f, 44, 104)).toBe(12);
    expect(extensionStyle.surfaceZ({ frame: f, params: {}, kit: null as unknown as Kit }, p.placed.x, p.placed.y)).toBeCloseTo(16.4, 9);
    // a cap frame has no rims
    expect(humpSurfaceZ(resolveLayout(presetConfig('ch-sd-1x1')), 0, 0)).toBeCloseTo(30.4, 9);
  });
});

describe('resolver: upright Bilresa above the plate (ch-sd-ext-top-v)', () => {
  it('grows the cell upwards for the 70.6 mm pocket (+ rim, cove and chamfers), stays 90 wide', () => {
    const f = resolveLayout(presetConfig(V));
    expect(f.outer.w).toBe(90);
    expect(f.outer.h).toBeCloseTo(70.6 + 2 * REACH, 9); // 89.8
    expect(sides(f).bottom).toBeCloseTo(45, 9);
    expect(sides(f).top).toBeCloseTo(134.8, 9);
    expect(ext(f).origin).toEqual([0, 45 + 89.8 / 2]);
    const p = pocketOf(f);
    expect(p.placed).toMatchObject({ x: 0, y: 45 + 89.8 / 2, rotDeg: 0 });
    expect(p.rimZ).toBeCloseTo(16.4, 9);
    expect(f.warnings).toEqual([]);
  });

  it('the finger notch sits at the top end (away from the plate) without growing the slab', () => {
    const c = presetConfig(V);
    c.bilresa.notch.enabled = true;
    const f = resolveLayout(c);
    const p = pocketOf(f);
    expect(p.notch).toMatchObject({ shape: { kind: 'circle', d: 14 }, x: 0 });
    expect(p.notch!.y).toBeCloseTo(p.placed.y + 35.3, 9);
    expect(f.outer.h).toBeCloseTo(89.8, 9); // notch + 2 + 0.6 = the pocket's own reach
    // lying: the +x end (the two ends tie)
    const h = presetConfig(H);
    h.bilresa.notch.enabled = true;
    const ph = pocketOf(resolveLayout(h));
    expect(ph.notch).toMatchObject({ x: 35.3, y: 75 });
    expect(resolveLayout(h).outer).toMatchObject({ w: 90, h: 60 });
  });
});

describe('resolver: sides, gap, size, depth', () => {
  it('sideAxes', () => {
    expect(sideAxes('top')).toEqual({ along: 'x', away: 'y', outward: 1 });
    expect(sideAxes('bottom')).toEqual({ along: 'x', away: 'y', outward: -1 });
    expect(sideAxes('right')).toEqual({ along: 'y', away: 'x', outward: 1 });
    expect(sideAxes('left')).toEqual({ along: 'y', away: 'x', outward: -1 });
  });

  it('bottom / left / right mirror the top placement; the inner edge touches the plate + gap', () => {
    const base = presetConfig(H);
    const at = (side: CoverConfig['part']['side'], gap = 0) => {
      const c = structuredClone(base);
      c.part.side = side;
      c.part.gap = gap;
      return resolveLayout(c);
    };
    const bottom = at('bottom');
    expect(bottom.outer).toMatchObject({ w: 90, h: 60, cx: 0, cy: -75 });
    expect(pocketOf(bottom).placed).toMatchObject({ x: 0, y: -75 });
    expect(ext(bottom).origin).toEqual([0, -75]);
    // left / right: the cell is 60 wide, the lying pocket needs 89.8 across; as tall as the plate
    const right = at('right');
    expect(right.outer.w).toBeCloseTo(89.8, 9);
    expect(right.outer.h).toBe(90);
    expect(sides(right).left).toBeCloseTo(45, 9);
    expect(right.outer.cy).toBe(0);
    expect(pocketOf(right).placed).toMatchObject({ x: 45 + 44.9, y: 0 });
    const left = at('left', 2);
    expect(sides(left).right).toBeCloseTo(-47, 9);
    expect(left.outer.cx).toBeCloseTo(-47 - 44.9, 9);
    expect(ext(left)).toMatchObject({ side: 'left', gap: 2, origin: [-47 - 44.9, 0] });
    const top = at('top', 3);
    expect(sides(top).bottom).toBeCloseTo(48, 9);
    expect(pocketOf(top).placed.y).toBeCloseTo(78, 9);
  });

  it('a manual size grows along the plate edge symmetrically and away from the plate; too small is clamped', () => {
    const c = presetConfig(H);
    c.cover.size = { w: 100, h: 80 };
    const f = resolveLayout(c);
    expect(f.outer).toMatchObject({ w: 100, h: 80, cx: 0, cy: 45 + 40, autoW: 90, autoH: 60 });
    expect(pocketOf(f).placed.y).toBe(75); // the pocket stays in its cell
    expect(f.warnings).toEqual([]); // wider than the plate by request: no note
    c.cover.size = { w: 50, h: 50 };
    const g = resolveLayout(c);
    expect(g.outer).toMatchObject({ w: 90, h: 60 });
    expect(codes(g)).toContain(WARNING_CODES.sizeClamped);
    c.part.side = 'left';
    c.cover.size = { w: 120, h: 100 };
    const l = resolveLayout(c);
    expect(sides(l).right).toBeCloseTo(-45, 9);
    expect(l.outer).toMatchObject({ w: 120, h: 100, cx: -45 - 60, cy: 0 });
  });

  it('a pocket shallower than the slab is sunk flush; a thin plate raises the face', () => {
    expect(rimRise(12, 2.4, 14)).toBeCloseTo(4.4, 9);
    expect(rimRise(12, 2.4, 9)).toBe(0);
    expect(rimRise(20, 2.4, 14)).toBe(0);
    const c = presetConfig(H);
    c.bilresa.pocketDepth = 9;
    const f = resolveLayout(c);
    expect(pocketOf(f).floorZ).toBeCloseTo(3, 9);
    expect(pocketOf(f).rimZ).toBeCloseTo(12, 9);
    expect(ext(f).rise).toBe(0);
    expect(humpSurfaceZ(f, 0, 75)).toBe(12);
    const d = presetConfig(H);
    d.plate.depth = 20;
    expect(pocketOf(resolveLayout(d))).toMatchObject({ floorZ: 6, rimZ: 20 });
    const t = presetConfig(H);
    t.plate.depth = 1;
    const tf = resolveLayout(t);
    expect(tf.frontZ).toBe(MIN_EXTENSION_FACE);
    expect(codes(tf)).toContain(WARNING_CODES.frontRaised);
    // per-module depth: the deeper pocket rises higher
    const m = presetConfig(H);
    m.modules[0].bilresa = { variant: 'wheel', pocketDepth: 16 };
    const mf = resolveLayout(m);
    expect(pocketOf(mf)).toMatchObject({ variant: 'wheel', floorZ: 2.4, rimZ: 18.4 });
    expect(ext(mf).rise).toBeCloseTo(6.4, 9);
    expect(pocketOf(mf).placed.shape).toEqual({ kind: 'stadium', w: 45.6, h: 70.6 });
  });

  it('ignores outlets and passthroughs with a warning; blanks give a plain slab', () => {
    const c = presetConfig(H);
    c.modules[0] = { col: 0, row: 0, role: 'outlet', rot: 0, dx: 0, dy: 0, opening: { shape: 'circle', d: 50 } };
    const f = resolveLayout(c);
    expect(f.features).toEqual([]);
    expect(f.warnings.map((w) => [w.code, w.featureId])).toEqual([[WARNING_CODES.extensionOpening, 'c0r0']]);
    expect(f.outer).toMatchObject({ w: 90, h: 60, cx: 0, cy: 75 });
    c.modules[0] = { col: 0, row: 0, role: 'blank', rot: 0, dx: 0, dy: 0 };
    expect(resolveLayout(c)).toMatchObject({ features: [], warnings: [], outer: { w: 90, h: 60 } });
  });

  it('two lying Bilresa above a 150 mm plate spread apart freely and widen the slab (info)', () => {
    const c = presetConfig('ch-sd-2x1h-two-switches');
    c.part = { ...c.part, kind: 'extension' };
    c.modules = c.modules.map((m): ModuleConfig => ({ ...m, rot: 90 }));
    const f = resolveLayout(c);
    const [a, b] = pockets(f);
    // 70.6 + 2 + 2 · 0.6 − 60 = 13.8 mm, half each; no access hole holds them back
    expect(a.placed.x).toBeCloseTo(-30 - 6.9, 6);
    expect(b.placed.x).toBeCloseTo(30 + 6.9, 6);
    expect(f.warnings.filter((w) => w.code === WARNING_CODES.pocketSpread)).toHaveLength(2);
    expect(f.warnings.map((w) => w.code)).toContain(WARNING_CODES.extensionWide);
    expect(f.outer.w).toBeCloseTo(2 * (36.9 + 35.3 + REACH), 6);
    expect(f.outer.h).toBe(60);
    expect(f.outer.cx).toBe(0);
    expect(f.warnings.filter((w) => w.severity !== 'info')).toEqual([]);
    expect(f.plate.w).toBe(150);
  });

  it('grid offsets and dx/dy move the pocket inside the slab (the slab follows if needed)', () => {
    const c = presetConfig(H);
    c.modules[0].dx = 3;
    c.modules[0].dy = -2;
    c.grid.offsetY = 1;
    const f = resolveLayout(c);
    // the cell box (shifted up 1 mm: −29 … 31) is outgrown by the pocket's lower need (anchor 1,
    // dy −2: −1 − 20.3 − 9.6 = −30.9), so the slab's bottom, still at 45, lies 30.9 below the grid origin
    expect(ext(f).origin[0]).toBe(0);
    expect(ext(f).origin[1]).toBeCloseTo(45 + 30.9, 9);
    expect(pocketOf(f).anchor[1]).toBeCloseTo(45 + 30.9 + 1, 9);
    expect(pocketOf(f).placed.x).toBe(3);
    expect(pocketOf(f).placed.y).toBeCloseTo(45 + 30.9 + 1 - 2, 9);
    expect(f.outer.h).toBeCloseTo(61.9, 9);
    // the pocket's right edge needs 3 + 35.3 + 9.6 = 47.9 > 45: the slab widens on that side only
    expect(sides(f).right).toBeCloseTo(47.9, 9);
    expect(sides(f).left).toBe(-45);
    expect(f.outer.w).toBeCloseTo(92.9, 9);
    expect(codes(f)).toContain(WARNING_CODES.extensionWide);
  });
});

describe('UI helpers', () => {
  it('deriveFrame uses the extension style; heights and names follow the rim', () => {
    const c = presetConfig(H);
    const d = deriveFrame(c);
    expect(d.style.id).toBe('extension');
    expect(d.params).toEqual({});
    expect(d.frame.part.kind).toBe('extension');
    expect(topZ(d.frame)).toBeCloseTo(16.4, 9);
    expect(topZ(deriveFrame(presetConfig('ch-sd-1x1')).frame)).toBeCloseTo(30.4, 9);
    const h = heightSummary(d.frame);
    expect(h.frontZ).toBe(12);
    expect(h.total).toBeCloseTo(2.4 + 18.5, 9);
    expect(h.proud).toBeCloseTo(4.5, 9); // above the rim, not the face
    expect(stlFilename(c, 'export')).toBe('switchcover-ch-sd-ext-top-h-extension.stl');
    expect(stlFilename(c, 'testFit')).toBe('switchcover-ch-sd-ext-top-h-extension-testfit.stl');
  });
});

describe('geometry', () => {
  let kit: Kit;
  let wasm: ManifoldToplevel;
  beforeAll(async () => {
    wasm = await getWasm();
    kit = await getKit('preview');
  });

  it.each([H, V])('%s: one solid slab with a rim, genus 0, bbox = outline × rim height', (id) => {
    const before = liveObjectCount();
    withScope(() => {
      const b = buildCover(kit, presetConfig(id));
      expect(b.style.id).toBe('extension');
      expect(b.warnings).toEqual([]);
      expect(b.expectedGenus).toBe(0);
      const m = b.manifold;
      expect(m.status()).toBe('NoError');
      expect(m.decompose().length).toBe(1);
      expect(m.genus()).toBe(0);
      const { w, h, cx, cy } = b.frame.outer;
      const box = m.boundingBox();
      expect(box.min[2]).toBe(0);
      expect(Math.abs(box.max[2] - 16.4)).toBeLessThanOrEqual(TOL);
      for (const [got, want] of [
        [box.min[0], cx - w / 2],
        [box.max[0], cx + w / 2],
        [box.min[1], cy - h / 2],
        [box.max[1], cy + h / 2],
      ]) expect(Math.abs(got - want)).toBeLessThanOrEqual(TOL);
      // solid: most of the slab box is material (the pocket is the only void)
      expect(m.volume()).toBeGreaterThan(0.6 * w * h * b.frame.frontZ);
      // and nothing of it lies over the plate
      const plate = kit.prism({ shape: { kind: 'roundedRect', w: 90, h: 90, r: 3 }, x: 0, y: 0, rotDeg: 0 }, -1, 40);
      expect(intersectionVolume(m, plate)).toBeLessThan(1e-6);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });

  it('probes: strip indent on a full floor, the floor, the fillet wall, the rim and the cove', () => {
    withScope(() => {
      const config = presetConfig(H);
      const b = buildCover(kit, config);
      const f = pocketOf(b.frame);
      const top = 40;
      const { ledge, hole } = pocketProbePoints(f, config.bilresa.strip.l);
      // the strip indent floor, everywhere under the strip (no bridge hole), solid down to the wall
      for (const [x, y] of [...ledge, hole]) {
        const col = b.manifold.intersect(column(kit, x, y, -1, top));
        expect(Math.abs(col.boundingBox().max[2] - (f.floorZ - f.stripDepth))).toBeLessThanOrEqual(TOL);
        expect(col.boundingBox().min[2]).toBe(0);
      }
      // the floor beside the strip indent (the 24 mm back flat leaves ~0.8 mm of floor beside the 22.4 mm indent)
      const [px, py] = toWorld(f.placed, [11.6, 0]);
      expect(Math.abs(topOfIntersection(b.manifold, column(kit, px, py, -1, top, 0.2)) - f.floorZ)).toBeLessThanOrEqual(TOL);
      // across the lying pocket: the rim top 1 mm outside the outline, the cove at mid flare, the face beyond it
      const at = (across: number) => toWorld(f.placed, [across, 0]);
      const [rx, ry] = at(20.3 + 1);
      expect(Math.abs(topOfIntersection(b.manifold, column(kit, rx, ry, -1, top)) - f.rimZ!)).toBeLessThanOrEqual(TOL);
      const [mx, my] = at(20.3 + 2 + 3);
      const cove = topOfIntersection(b.manifold, column(kit, mx, my, -1, top));
      expect(cove - coveZ(12, 4.4, 6, 3)).toBeGreaterThanOrEqual(-TOL);
      expect(cove - coveZ(12, 4.4, 6, 3)).toBeLessThanOrEqual(0.15); // lofted chords lie just outside the cove
      expect(cove - humpSurfaceZ(b.frame, mx, my)).toBeLessThanOrEqual(0.15);
      // the flat face beyond the cove (world (38, 100): 13.7 mm from the pocket, off the edge chamfer)
      expect(Math.abs(topOfIntersection(b.manifold, column(kit, 38, 100, -1, top)) - 12)).toBeLessThanOrEqual(TOL);
      // 1 mm beyond the cove's foot the lying pocket's across axis already runs into the slab's 1 mm
      // edge chamfer (foot at 75 + 28.3, edge at 105): a little below the face there
      const [fx, fy] = at(20.3 + 2 + 6 + 1);
      const nearEdge = topOfIntersection(b.manifold, column(kit, fx, fy, -1, top));
      expect(nearEdge).toBeGreaterThan(11.5);
      expect(nearEdge).toBeLessThan(12);
      // the slab's top chamfer at its corner region, the base solid under it
      const corner = b.manifold.intersect(column(kit, 44, 104, -1, top));
      expect(corner.boundingBox().max[2]).toBeLessThan(12);
      expect(corner.boundingBox().max[2]).toBeGreaterThan(11);
      expect(corner.boundingBox().min[2]).toBe(0);
      return null;
    });
  });

  it('leaves room for the real Bilresa model, seated back-first with its strip rim in the indent', () => {
    withScope(() => {
      const b = buildCover(kit, presetConfig(V));
      const f = pocketOf(b.frame);
      const device = seatedBilresa(wasm, f, BILRESA_VARIANTS[f.variant].model.split('/').pop()!);
      const box = device.boundingBox();
      expect(box.max[2]).toBeCloseTo(f.floorZ + 18.5, 4);
      expect(box.max[2]).toBeGreaterThan(f.rimZ!);
      const big = { shape: { kind: 'roundedRect' as const, w: 500, h: 500, r: 0 }, x: 0, y: 0, rotDeg: 0 };
      const body = device.intersect(kit.prism(big, f.floorZ + 1e-3, 60));
      expect(intersectionVolume(b.manifold, body)).toBeLessThan(1e-3);
      const overlap = b.manifold.intersect(device);
      expect(overlap.isEmpty() ? 0 : overlap.volume()).toBeLessThan(10); // the STL rim's tips on the indent ends
      return null;
    });
  });

  it('a finger notch cuts the rim down to 2 mm above the floor and stays blind', () => {
    withScope(() => {
      const c = presetConfig(V);
      c.bilresa.notch.enabled = true;
      const b = buildCover(kit, c);
      expect(b.warnings).toEqual([]);
      expect(b.manifold.genus()).toBe(0);
      expect(b.manifold.decompose().length).toBe(1);
      const f = pocketOf(b.frame);
      const n = f.notch!;
      const [nx, ny] = [n.x, n.y + 5]; // in the notch, outside the pocket outline
      expect(pointInPlaced([nx, ny], f.placed)).toBe(false);
      const col = b.manifold.intersect(column(kit, nx, ny, -1, 40));
      expect(Math.abs(col.boundingBox().max[2] - notchFloor(f))).toBeLessThanOrEqual(TOL);
      expect(col.boundingBox().min[2]).toBe(0);
      return null;
    });
  });

  it('a flush pocket (shallower than the slab) needs no rim; a plain slab has no features', () => {
    withScope(() => {
      const c = presetConfig(H);
      c.bilresa.pocketDepth = 9;
      const b = buildCover(kit, c);
      expect(b.warnings).toEqual([]);
      expect(Math.abs(b.manifold.boundingBox().max[2] - 12)).toBeLessThanOrEqual(TOL);
      expect(b.manifold.genus()).toBe(0);
      const p = presetConfig(H);
      p.modules = [];
      const s = buildCover(kit, p);
      expect(s.manifold.genus()).toBe(0);
      expect(s.manifold.volume()).toBeGreaterThan(0.95 * 90 * 60 * 12);
      return null;
    });
  });

  it('builds in every style setting (the style is ignored) and at export quality', async () => {
    const exportKit = await getKit('export');
    withScope(() => {
      let tris = 0;
      for (const s of listStyles()) {
        const c = presetConfig(H);
        c.cover.style = s.id;
        const b = buildCover(kit, c);
        expect(b.style.id, s.id).toBe('extension');
        expect(b.warnings, s.id).toEqual([]);
        if (tris === 0) tris = b.manifold.numTri();
        else expect(b.manifold.numTri(), s.id).toBe(tris);
      }
      const fine = buildCover(exportKit, presetConfig(H));
      expect(fine.warnings).toEqual([]);
      expect(fine.manifold.numTri()).toBeGreaterThan(tris);
      return null;
    });
  });

  it('test-fit part of an extension pocket: the same nested pocket and strip indent, no hole', () => {
    withScope(() => {
      const t = buildTestFit(kit, presetConfig(H));
      expect(t.warnings).toEqual([]);
      expect(t.expectedGenus).toBe(0);
      expect(t.manifold.genus()).toBe(0);
      expect(t.manifold.boundingBox().min[2]).toBe(0);
      expect(t.manifold.boundingBox().max[2]).toBeCloseTo(t.feature.rimZ! + t.zOffset, 3);
      return null;
    });
  });

  it('worker: build, face-up export and test-fit of an extension', () => {
    const before = liveObjectCount();
    const config = presetConfig(H);
    const build = handleRequest(wasm, { id: 1, kind: 'build', config, quality: 'preview' }).response;
    if (isBuildError(build)) throw new Error(build.error);
    expect(build.frame.part.kind).toBe('extension');
    expect(build.stats.genus).toBe(0);
    const exp = handleRequest(wasm, { id: 2, kind: 'export', config, quality: 'export' }).response;
    if (isBuildError(exp)) throw new Error(exp.error);
    const header = new TextDecoder().decode(new Uint8Array(exp.stl!, 0, 80)).replace(/\0+$/, '');
    expect(header).toContain('extension faceUp');
    // face up: the STL is not rotated, its lowest z is 0 and its highest the rim
    const v = new DataView(exp.stl!);
    let zMax = -Infinity;
    const n = v.getUint32(80, true);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) zMax = Math.max(zMax, v.getFloat32(84 + i * 50 + 12 + k * 12 + 8, true));
    expect(zMax).toBeCloseTo(16.4, 2);
    const fit = handleRequest(wasm, { id: 3, kind: 'testFit', config, quality: 'export' }).response;
    if (isBuildError(fit)) throw new Error(fit.error);
    expect(fit.stats.genus).toBe(0);
    expect(liveObjectCount()).toBe(before);
  });
});
