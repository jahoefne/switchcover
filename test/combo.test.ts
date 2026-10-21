/**
 * The Swiss switch + socket combo plate (preset ch-sd-1x1-combo): one 90 × 90 STANDARDdue plate
 * with the switch key (≈ 60 × 22) centred at y = +19 and a Type 13 socket at y = −12. The
 * two-button Bilresa lies horizontally (rot 90) above the Ø46 opening and the cover grows upwards
 * only. Resolved numbers, the rotated nested pocket's probes, the build in every style and the
 * face-down STL.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { presetConfig } from '../src/config/presets';
import { buildCover, type CoverBuild } from '../src/geometry/buildCover';
import type { CoverFrame, Kit, Placed } from '../src/geometry/contract';
import { parseBinaryStl, toBinaryStl } from '../src/geometry/export/stl';
import { cavityCeiling, notchFloor, type OpeningFeature, type PocketFeature } from '../src/geometry/features';
import { withScope } from '../src/geometry/kit';
import { containmentMargin, offsetPlaced, placedBounds, placedDistance, pointInPlaced, toWorld } from '../src/geometry/shape2d';
import { WARNING_CODES, outerPlaced, resolveLayout } from '../src/layout/resolve';
import { listStyles } from '../src/styles';
import { deriveFrame } from '../src/ui/derive';
import { bilresaGhostPlacement } from '../src/ui/viewer/ghost';
import { getKit, getWasm } from './helpers/manifold';
import { column, filletTopAt, intersectionVolume, manifoldOfMesh, ringPrism, seatedBilresa, topOfIntersection } from './helpers/probes';

const ID = 'ch-sd-1x1-combo';
const STYLES = listStyles().map((s) => s.id);
/** The switch key's vertical band on the plate (60 × 22 key centred at y = +19). */
const KEY_BAND = [8, 30] as const;

const configFor = (styleId = 'minimal') => {
  const c = presetConfig(ID);
  c.cover.style = styleId;
  c.cover.styleParams = {};
  return c;
};
const pocketOf = (f: CoverFrame) => f.features.find((x): x is PocketFeature => x.kind === 'pocket')!;
const outletOf = (f: CoverFrame) => f.features.find((x): x is OpeningFeature => x.kind === 'opening')!;
const codes = (f: CoverFrame) => f.warnings.map((w) => w.code);
/** World y range of a placed shape. */
const yRange = (p: Placed) => {
  const b = placedBounds(p);
  return [b.minY, b.maxY] as const;
};

describe('combo plate: resolved layout', () => {
  it('anchors on the key (+19) and the socket (−12); the Bilresa lies horizontally above the opening', () => {
    const f = deriveFrame(configFor()).frame;
    const p = pocketOf(f);
    const o = outletOf(f);
    expect(p.anchor).toEqual([0, 19]);
    expect(o.anchor).toEqual([0, -12]);
    expect(o.placed).toMatchObject({ shape: { kind: 'circle', d: 46 }, x: 0, y: -12 });
    expect(p.placed).toMatchObject({ shape: { kind: 'stadium', w: 40.6, h: 70.6 }, x: 0, rotDeg: 90 });
    // dy 15.9 = (opening top 11 + minWall 2 + chamfers 1 + 0.6) + half height 20.3 − 19
    expect(p.placed.y).toBeCloseTo(34.9, 9);
    expect(yRange(p.placed)[0]).toBeCloseTo(14.6, 9);
    expect(placedDistance(p.placed, o.placed)).toBeCloseTo(2 + 1 + 0.6, 6);
  });

  it('minimal needs no spreading; organic spreads (info only) and every style keeps the rocker reachable', () => {
    const minimal = deriveFrame(configFor()).frame;
    expect(codes(minimal)).not.toContain(WARNING_CODES.pocketSpread);
    expect(minimal.warnings.filter((w) => w.severity !== 'info')).toEqual([]);
    const organic = deriveFrame(configFor('organic')).frame;
    expect(codes(organic)).toContain(WARNING_CODES.pocketSpread);
    expect(organic.warnings.filter((w) => w.severity !== 'info')).toEqual([]);
    for (const s of STYLES) {
      const f = deriveFrame(configFor(s)).frame;
      expect(f.warnings.filter((w) => w.severity === 'error'), s).toEqual([]);
      const p = pocketOf(f);
      expect(pointInPlaced(p.anchor, p.holes[0]), `${s}: key centre in the hole`).toBe(true);
    }
  });

  it('access: the hole spans the key centre, the gap below the strip reaches the key band', () => {
    for (const s of STYLES) {
      const p = pocketOf(deriveFrame(configFor(s)).frame);
      const [h0, h1] = yRange(p.holes[0]);
      const [s0, s1] = yRange(p.strip);
      expect(h0, s).toBeLessThanOrEqual(19 + 1e-6);
      // the lower tool gap (hole bottom → strip bottom) overlaps the key band by ≥ 5 mm
      const overlap = Math.min(s0, KEY_BAND[1]) - Math.max(h0, KEY_BAND[0]);
      expect(overlap, s).toBeGreaterThanOrEqual(5);
      // the upper gap lies above the key
      expect(s1, s).toBeGreaterThan(KEY_BAND[1]);
      expect(h1 - s1, s).toBeCloseTo(s0 - h0, 6);
    }
    // the shipped numbers (minimal): hole 17.9 … 51.9, strip indent 23.7 … 46.1
    const p = pocketOf(deriveFrame(configFor()).frame);
    expect(yRange(p.holes[0])[0]).toBeCloseTo(17.9, 6);
    expect(yRange(p.holes[0])[1]).toBeCloseTo(51.9, 6);
    expect(yRange(p.strip)[0]).toBeCloseTo(23.7, 6);
    expect(yRange(p.strip)[1]).toBeCloseTo(46.1, 6);
  });

  it('grows upwards only: plate-driven width and bottom, top = pocket top + minWall + margin (+ rim chamfer)', () => {
    const f = deriveFrame(configFor()).frame;
    const p = pocketOf(f);
    const top = p.placed.y + 20.3 + f.minWall + 4 + 0.6;
    expect(top).toBeCloseTo(61.8, 9);
    expect(f.outer.w).toBe(96.8);
    expect(f.outer.cx).toBe(0);
    expect(f.outer.cy).toBeGreaterThan(0);
    expect(f.outer.cy - f.outer.h / 2).toBeCloseTo(-48.4, 6);
    expect(f.outer.cy + f.outer.h / 2).toBeCloseTo(top, 6);
    expect(f.outer).toMatchObject({ h: 110.2, autoW: 96.8, autoH: 110.2 });
    expect(f.outer.cy).toBeCloseTo(6.7, 6);
    // without style limits (no edge allowances) the top is pocket top + minWall + margin
    const bare = resolveLayout(configFor());
    expect(bare.outer.cy + bare.outer.h / 2).toBeCloseTo(34.9 + 20.3 + 2 + 4, 6);
  });

  it.each(STYLES)('%s: the plate (+ clearance) fits the cavity; every feature keeps minWall to the edge', (s) => {
    const f = deriveFrame(configFor(s)).frame;
    const { plate } = f;
    const zone: Placed = {
      shape: { kind: 'roundedRect', w: plate.w + 2 * plate.clearance, h: plate.h + 2 * plate.clearance, r: plate.cornerR + plate.clearance },
      x: 0,
      y: 0,
      rotDeg: 0,
    };
    expect(containmentMargin(zone, outerPlaced(f, f.skirtT))).toBeGreaterThanOrEqual(-1e-9);
    expect(f.outer.cy).toBeGreaterThan(0);
    for (const x of f.features) expect(containmentMargin(x.placed, outerPlaced(f))).toBeGreaterThanOrEqual(f.minWall);
  });

  it('finger notch: the +x end of the horizontal pocket (a tie), inside the off-centre outline', () => {
    for (const s of STYLES) {
      const f = deriveFrame(configFor(s)).frame;
      const p = pocketOf(f);
      expect(p.notch!.x, s).toBeCloseTo(35.3, 6);
      expect(p.notch!.y, s).toBeCloseTo(p.placed.y, 6);
      // notch + minWall (its backing) inside the outline; the rim edge too
      expect(containmentMargin(offsetPlaced(p.notch!, f.minWall), outerPlaced(f)), s).toBeGreaterThanOrEqual(-1e-9);
    }
    // deterministic: the same end for the pocket turned the other way round
    const c = configFor();
    c.modules[0].rot = 270;
    expect(pocketOf(resolveLayout(c)).notch!.x).toBeCloseTo(35.3, 6);
  });
});

describe('combo plate: geometry', () => {
  let kit: Kit;
  let wasm: ManifoldToplevel;
  beforeAll(async () => {
    kit = await getKit('preview');
    wasm = await getWasm();
  });

  it.each(STYLES)('%s: one valid piece with two through-holes (opening + bridge hole), clear of the plate', (s) => {
    withScope(() => {
      const b = buildCover(kit, configFor(s));
      expect(b.manifold.status()).toBe('NoError');
      expect(b.manifold.decompose().length).toBe(1);
      expect(b.expectedGenus).toBe(2);
      expect(b.manifold.genus()).toBe(2);
      expect(b.warnings.filter((w) => w.severity === 'error')).toEqual([]);
      const box = b.manifold.boundingBox();
      const { w, h, cx, cy } = b.frame.outer;
      expect(box.min[1]).toBeCloseTo(cy - h / 2, 1);
      expect(box.max[1]).toBeCloseTo(cy + h / 2, 1);
      expect(box.max[0]).toBeCloseTo(cx + w / 2, 1);
      // the plate box (+ clearance, + rocker gap) at the origin stays free
      const { plate } = b.frame;
      const c = plate.clearance;
      const plateBox = kit.prism(
        { shape: { kind: 'roundedRect', w: plate.w + 2 * c - 0.02, h: plate.h + 2 * c - 0.02, r: plate.cornerR + c - 0.01 }, x: 0, y: 0, rotDeg: 0 },
        0,
        plate.protrusion + 2 - 0.01,
      );
      expect(intersectionVolume(b.manifold, plateBox)).toBeLessThan(1e-6);
      return null;
    });
  });

  describe('rotated nested pocket (minimal)', () => {
    let b: CoverBuild;
    let f: PocketFeature;
    const at = (u: number, v: number) => toWorld(f.placed, [u, v]); // u across (world y), v along (world −x)
    beforeAll(() => {
      b = buildCover(kit, configFor());
      f = pocketOf(b.frame);
    });

    it('the gaps above and below the horizontal strip are open from the cavity to the face', () => {
      const top = b.frame.frontZ + 5;
      withScope(() => {
        for (const u of [-14, 14]) {
          for (const v of [-15, 0, 15]) {
            const [x, y] = at(u, v);
            expect(intersectionVolume(b.manifold, column(kit, x, y, -1, top, 0.2)), `u=${u} v=${v}`).toBeLessThan(1e-9);
          }
        }
        // the lower gap is the one over the key: world y below the strip, inside the key band
        const [, yLow] = at(-14, 0);
        expect(yLow).toBeGreaterThan(KEY_BAND[0]);
        expect(yLow).toBeLessThan(KEY_BAND[1]);
        expect(yLow).toBeLessThan(f.placed.y);
        // under the strip (it spans the hole) the column is open too: the strip is not printed
        const [x0, y0] = at(0, 0);
        expect(intersectionVolume(b.manifold, column(kit, x0, y0, -1, top, 0.2))).toBeLessThan(1e-9);
        return null;
      });
    });

    it('the strip ends rest on glue ledges at the left and right ends', () => {
      withScope(() => {
        for (const v of [-24, 24]) {
          const [x, y] = toWorld({ ...f.placed, x: f.strip.x, y: f.strip.y }, [0, v]);
          expect(Math.abs(Math.abs(x) - 24)).toBeLessThan(1e-6); // the long axis runs along X
          const col = b.manifold.intersect(column(kit, x, y, -1, b.frame.frontZ + 5));
          expect(Math.abs(col.boundingBox().max[2] - (f.floorZ - f.stripDepth)), `v=${v}`).toBeLessThanOrEqual(0.05);
        }
        return null;
      });
    });

    it('the wall follows the back fillet above and below the hole; the notch floor at the +x end', () => {
      withScope(() => {
        for (const u of [-19, 19]) {
          const [x, y] = at(u, 0);
          const z = topOfIntersection(b.manifold, column(kit, x, y, -1, b.frame.frontZ + 5));
          expect(Math.abs(z - filletTopAt(f, 19 + 0.15)), `u=${u}`).toBeLessThanOrEqual(0.1);
        }
        // inside the pocket outline at the +x end (local v = −34): the notch floor
        const [nx, ny] = at(0, -34);
        expect(nx).toBeGreaterThan(30);
        const z = topOfIntersection(b.manifold, column(kit, nx, ny, -1, b.frame.frontZ + 5));
        expect(Math.abs(z - notchFloor(f))).toBeLessThanOrEqual(0.05);
        return null;
      });
    });

    it('the socket opening is clear with material around it below the pocket', () => {
      withScope(() => {
        const o = outletOf(b.frame);
        expect(intersectionVolume(b.manifold, kit.prism(offsetPlaced(o.placed, -0.2), -1, b.frame.frontZ + 5))).toBeLessThan(1e-6);
        const ceil = cavityCeiling(b.frame);
        const ring = ringPrism(kit, o.placed, 1.2, 1.8, ceil + 0.01, b.frame.frontZ - 0.01);
        expect(intersectionVolume(b.manifold, ring) / ring.volume()).toBeGreaterThan(0.85);
        return null;
      });
    });

    it('the Bilresa ghost / seated model lies horizontally above the opening and fits the pocket', () => {
      const g = bilresaGhostPlacement(f);
      expect(g.rotZDeg).toBe(90);
      expect(g.position[1]).toBeCloseTo(34.9, 9);
      withScope(() => {
        const device = seatedBilresa(wasm, f, 'Bilresa_twobutton.stl');
        const box = device.boundingBox();
        expect(box.max[0] - box.min[0]).toBeCloseTo(70, 1);
        expect(box.max[1] - box.min[1]).toBeCloseTo(40, 1);
        const opening = outletOf(b.frame).placed;
        expect(box.min[1]).toBeGreaterThan(opening.y + 23 + b.frame.minWall);
        const big: Placed = { shape: { kind: 'roundedRect', w: 500, h: 500, r: 0 }, x: 0, y: 0, rotDeg: 0 };
        const body = device.intersect(kit.prism(big, f.floorZ + 1e-3, b.frame.frontZ + 30));
        expect(intersectionVolume(b.manifold, body)).toBeLessThan(1e-3);
        return null;
      });
    });
  });

  it.each(['minimal', 'organic'])('%s: face-down export STL reads back valid (genus 2, one piece, front at z = 0)', async (s) => {
    const exportKit = await getKit('export');
    withScope(() => {
      const b = buildCover(exportKit, configFor(s));
      const stl = toBinaryStl(b.manifold, { orientation: 'faceDown' });
      const back = manifoldOfMesh(wasm, parseBinaryStl(stl));
      expect(back.status()).toBe('NoError');
      expect(back.genus()).toBe(2);
      expect(back.decompose().length).toBe(1);
      const box = back.boundingBox();
      expect(box.min[2]).toBeCloseTo(0, 4);
      expect(box.max[2]).toBeCloseTo(b.frame.frontZ, 3);
      expect(back.slice(0.05).area()).toBeGreaterThan(0);
      // rotated about Y: x is mirrored, y (the upward growth) is kept
      expect(box.max[1]).toBeCloseTo(b.frame.outer.cy + b.frame.outer.h / 2, 1);
      return null;
    });
  });
});
