/**
 * The Swiss switch + socket combo plate (preset ch-sd-1x1-combo): one 90 × 90 STANDARDdue plate
 * with the switch key (≈ 60 × 22) centred at y = +19 and a Type 13 socket at y = −12. The
 * two-button Bilresa lies horizontally (rot 90) above the Ø50 opening and the cover grows upwards
 * only. Resolved numbers, the rotated nested pocket's probes, the outlet sleeve, the build in every
 * style and the face-down STL. The finger notch is off by default; the notch tests switch it on.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { presetConfig } from '../src/config/presets';
import { buildCover, type CoverBuild } from '../src/geometry/buildCover';
import type { CoverFrame, Kit, Placed } from '../src/geometry/contract';
import { parseBinaryStl, toBinaryStl } from '../src/geometry/export/stl';
import { cavityCeiling, notchFloor, type OpeningFeature, type PocketFeature } from '../src/geometry/features';
import { withScope } from '../src/geometry/kit';
import { containmentMargin, insideDistance, offsetPlaced, placedBounds, placedDistance, pointInPlaced, toWorld } from '../src/geometry/shape2d';
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
/** The same config with the finger notch switched on (it is off by default). */
const notchConfigFor = (styleId = 'minimal') => {
  const c = configFor(styleId);
  c.bilresa.notch.enabled = true;
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
    expect(o.placed).toMatchObject({ shape: { kind: 'circle', d: 50 }, x: 0, y: -12 });
    expect(p.placed).toMatchObject({ shape: { kind: 'stadium', w: 40.6, h: 70.6 }, x: 0, rotDeg: 90 });
    // dy 17: the access hole's 34 mm width runs along Y for the lying Bilresa (half extent 17), so
    // the key centre (+19) stays in the hole up to a pocket centre of 19 + 17 = 36 — which is where
    // dy 17 puts it. (Clearing the Ø50 opening with minimal's full edges would need dy 17.9 =
    // opening top 13 + minWall 2 + chamfers 1 + 0.6 + half height 20.3 − 19.)
    expect(p.placed.y).toBeCloseTo(36, 9);
    expect(yRange(p.placed)[0]).toBeCloseTo(36 - 20.3, 9); // 15.7
    // pocket bottom 15.7 − opening top (−12 + 25 = 13) = 2.7: ≥ minWall 2, short of minimal's
    // 2 + 1 + 0.6 = 3.6 (the edges between them shrink, edge-reduced)
    expect(placedDistance(p.placed, o.placed)).toBeCloseTo(2.7, 6);
  });

  it('no style spreads: the access hole holds the pocket at y = 36 (edge-reduced where the style has edges), the rocker stays reachable', () => {
    for (const s of STYLES) {
      const f = deriveFrame(configFor(s)).frame;
      const p = pocketOf(f);
      expect(codes(f), s).not.toContain(WARNING_CODES.pocketSpread);
      expect(p.placed.y, s).toBeCloseTo(36, 9);
      // minimal, organic, faceted and stepped want more than the 2.7 mm left between pocket and
      // socket for their edges, so those edges shrink (info); box has no edges and needs minWall only
      expect(codes(f).includes(WARNING_CODES.edgeReduced), s).toBe(s !== 'box');
      expect(f.warnings.filter((w) => w.severity !== 'info'), s).toEqual([]);
      expect(codes(f), s).not.toContain(WARNING_CODES.accessUncovered);
      // the key centre sits exactly on the hole's lower edge: inside within the resolver's tolerance
      expect(insideDistance(p.holes[0], p.anchor), s).toBeCloseTo(0, 9);
      expect(pointInPlaced(p.anchor, p.holes[0]), `${s}: key centre in the hole`).toBe(true);
    }
  });

  it('access: the hole spans the key centre, the gap below the strip reaches the key band', () => {
    for (const s of STYLES) {
      const p = pocketOf(deriveFrame(configFor(s)).frame);
      // 34 × (strip 52 − 2 · glue ledge 16 = 20), r 1.5, centred on the pocket and not shortened;
      // rot 90 turns its 34 mm width along Y
      expect(p.holes[0], s).toMatchObject({ shape: { kind: 'roundedRect', w: 34, h: 20, r: 1.5 }, x: 0, y: 36, rotDeg: 90 });
      const [h0, h1] = yRange(p.holes[0]);
      const [s0, s1] = yRange(p.strip);
      expect(h0, s).toBeLessThanOrEqual(19 + 1e-6);
      // the lower tool gap (hole bottom → strip bottom) overlaps the key band by ≥ 5 mm
      const overlap = Math.min(s0, KEY_BAND[1]) - Math.max(h0, KEY_BAND[0]);
      expect(overlap, s).toBeGreaterThanOrEqual(5);
      // the upper gap lies above the key
      expect(s1, s).toBeGreaterThan(KEY_BAND[1]);
      expect(h1 - s1, s).toBeCloseTo(s0 - h0, 6);
      // the shipped numbers (every style holds the pocket at y = 36): hole 36 ± 17 = 19 … 53 (the
      // key centre on its lower edge), strip indent 36 ± (22 + 2 · 0.2 tolerance) / 2 = 24.8 … 47.2;
      // the lower tool gap y 19 … 24.8 lies over the key band (y 8 … 30), the upper one
      // y 47.2 … 53 above the key
      expect(h0, s).toBeCloseTo(19, 6);
      expect(h1, s).toBeCloseTo(53, 6);
      expect(s0, s).toBeCloseTo(24.8, 6);
      expect(s1, s).toBeCloseTo(47.2, 6);
    }
  });

  it('grows upwards only: plate-driven width and bottom, top = pocket top + minWall + margin (+ rim chamfer)', () => {
    const f = deriveFrame(configFor()).frame;
    const p = pocketOf(f);
    const top = p.placed.y + 20.3 + f.minWall + 4 + 0.6;
    expect(top).toBeCloseTo(62.9, 9); // 36 + 20.3 + 2 + 4 + 0.6
    expect(f.outer.w).toBe(96.8);
    expect(f.outer.cx).toBe(0);
    expect(f.outer.cy).toBeGreaterThan(0);
    expect(f.outer.cy - f.outer.h / 2).toBeCloseTo(-48.4, 6);
    expect(f.outer.cy + f.outer.h / 2).toBeCloseTo(top, 6);
    // −48.4 … 62.9: 111.3 tall, centred at (62.9 − 48.4) / 2 = 7.25
    expect(f.outer).toMatchObject({ h: 111.3, autoW: 96.8, autoH: 111.3 });
    expect(f.outer.cy).toBeCloseTo(7.25, 6);
    // without style limits (no edge allowances) the top is pocket top + minWall + margin
    const bare = resolveLayout(configFor());
    expect(bare.outer.cy + bare.outer.h / 2).toBeCloseTo(36 + 20.3 + 2 + 4, 6);
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

  it('finger notch (switched on): the +x end of the horizontal pocket (a tie), inside the off-centre outline', () => {
    // off by default
    expect(pocketOf(deriveFrame(configFor()).frame).notch).toBeUndefined();
    for (const s of STYLES) {
      const f = deriveFrame(notchConfigFor(s)).frame;
      const p = pocketOf(f);
      expect(p.notch!.x, s).toBeCloseTo(35.3, 6);
      expect(p.notch!.y, s).toBeCloseTo(p.placed.y, 6);
      // notch + minWall (its backing) inside the outline; the rim edge too
      expect(containmentMargin(offsetPlaced(p.notch!, f.minWall), outerPlaced(f)), s).toBeGreaterThanOrEqual(-1e-9);
    }
    // deterministic: the same end for the pocket turned the other way round
    const c = notchConfigFor();
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

  it.each(STYLES)('%s: one valid piece with two through-holes (opening + bridge hole), clear of the plate; the outlet sleeve hangs into the cavity', (s) => {
    withScope(() => {
      const b = buildCover(kit, configFor(s));
      expect(b.manifold.status()).toBe('NoError');
      expect(b.manifold.decompose().length).toBe(1);
      expect(b.expectedGenus).toBe(2);
      expect(b.manifold.genus()).toBe(2);
      expect(b.warnings.filter((w) => w.severity === 'error')).toEqual([]);
      // the sleeve (opening + minWall) is solid from its bottom (the pocket floor's height, lifted
      // like it on a domed face) up to the cavity ceiling; the opening itself stays clear
      const o = outletOf(b.frame);
      expect(o.sleeveZ).toBeCloseTo(pocketOf(b.frame).floorZ, 9);
      const sleeve = ringPrism(kit, o.placed, 0.2, b.frame.minWall - 0.2, o.sleeveZ! + 0.01, cavityCeiling(b.frame) - 0.01);
      expect(intersectionVolume(b.manifold, sleeve) / sleeve.volume()).toBeGreaterThan(0.999);
      expect(intersectionVolume(b.manifold, kit.prism(offsetPlaced(o.placed, -0.2), -1, b.frame.frontZ + 5))).toBeLessThan(1e-6);
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
        // u = ±14: between the strip indent (|u| ≤ 11.2) and the hole's sides (|u| = 17);
        // v = 0, ±8: inside the hole's 20 mm length, clear of its r 1.5 corners
        for (const u of [-14, 14]) {
          for (const v of [-8, 0, 8]) {
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

    it('the wall follows the back fillet above and below the hole and round the +x end (no notch by default)', () => {
      expect(f.notch).toBeUndefined();
      withScope(() => {
        for (const u of [-19, 19]) {
          const [x, y] = at(u, 0);
          const z = topOfIntersection(b.manifold, column(kit, x, y, -1, b.frame.frontZ + 5));
          expect(Math.abs(z - filletTopAt(f, 19 + 0.15)), `u=${u}`).toBeLessThanOrEqual(0.1);
        }
        // the +x end (local v = −34) is 19 mm from its cap's centre (v = −15): the same fillet height
        const [nx, ny] = at(0, -34);
        expect(nx).toBeGreaterThan(30);
        const z = topOfIntersection(b.manifold, column(kit, nx, ny, -1, b.frame.frontZ + 5));
        expect(Math.abs(z - filletTopAt(f, 19 + 0.15))).toBeLessThanOrEqual(0.1);
        return null;
      });
    });

    it('with the finger notch on: the notch floor at the +x end', () => {
      withScope(() => {
        const bn = buildCover(kit, notchConfigFor());
        const fn = pocketOf(bn.frame);
        expect(fn.notch!.x).toBeCloseTo(35.3, 6);
        expect(fn.notch!.y).toBeCloseTo(36, 6);
        expect(bn.manifold.genus()).toBe(bn.expectedGenus);
        // inside the pocket outline at the +x end (local v = −34): the notch floor (floorZ + 2),
        // below the fillet the default cover has there
        const [nx, ny] = at(0, -34);
        const z = topOfIntersection(bn.manifold, column(kit, nx, ny, -1, bn.frame.frontZ + 5));
        expect(Math.abs(z - notchFloor(fn))).toBeLessThanOrEqual(0.05);
        expect(filletTopAt(fn, 19 + 0.15)).toBeGreaterThan(z + 1);
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

    it('the outlet sleeve: a minWall tube round the opening from sleeveZ (the pocket floor) to the skin, open below', () => {
      withScope(() => {
        const o = outletOf(b.frame);
        const { frontZ, minWall, plate } = b.frame;
        const ceil = cavityCeiling(b.frame);
        // sleeveZ = frontZ 30.4 − pocket depth 14 = 16.4 (the pocket's floorZ); ceiling 30.4 − skin 3 = 27.4
        expect(frontZ).toBeCloseTo(30.4, 9);
        expect(o.sleeveZ).toBeCloseTo(16.4, 9);
        expect(o.sleeveZ).toBeCloseTo(f.floorZ, 9);
        expect(ceil).toBeCloseTo(27.4, 9);
        const z0 = o.sleeveZ!;
        // between the outline (r 25) and outline + minWall (r 27), sleeveZ … ceiling: solid
        const wall = ringPrism(kit, o.placed, 0.2, minWall - 0.2, z0 + 0.01, ceil - 0.01);
        expect(intersectionVolume(b.manifold, wall) / wall.volume()).toBeGreaterThan(0.999);
        // inside the opening: air from below the sleeve's bottom up through the face
        expect(intersectionVolume(b.manifold, kit.prism(offsetPlaced(o.placed, -0.2), z0 - 2, frontZ + 5))).toBeLessThan(1e-6);
        // under the sleeve, down to the plate, the cavity is open: the sleeve hangs from the skin
        const under = ringPrism(kit, o.placed, 0.2, minWall - 0.2, plate.protrusion + 0.5, z0 - 0.01);
        expect(intersectionVolume(b.manifold, under)).toBeLessThan(1e-6);
        // and it is minWall thick: just outside it (below the socket centre, away from the pocket
        // well, whose bottom edge is 13.7 at the full outline) the cavity is air
        const lowerHalf: Placed = { shape: { kind: 'roundedRect', w: 80, h: 40, r: 0 }, x: 0, y: o.placed.y - 20, rotDeg: 0 };
        const outside = ringPrism(kit, o.placed, minWall + 0.2, minWall + 1, z0 + 0.01, ceil - 0.01).intersect(kit.prism(lowerHalf, 0, frontZ));
        expect(outside.volume()).toBeGreaterThan(1);
        expect(intersectionVolume(b.manifold, outside)).toBeLessThan(1e-6);
        return null;
      });
    });

    it('the Bilresa ghost / seated model lies horizontally above the opening and fits the pocket', () => {
      const g = bilresaGhostPlacement(f);
      expect(g.rotZDeg).toBe(90);
      expect(g.position[1]).toBeCloseTo(36, 9);
      withScope(() => {
        const device = seatedBilresa(wasm, f, 'Bilresa_twobutton.stl');
        const box = device.boundingBox();
        expect(box.max[0] - box.min[0]).toBeCloseTo(70, 1);
        expect(box.max[1] - box.min[1]).toBeCloseTo(40, 1);
        // the device's bottom (36 − 20 = 16) clears the Ø50 opening (top −12 + 25) + minWall
        const opening = outletOf(b.frame).placed;
        expect(box.min[1]).toBeGreaterThan(opening.y + 25 + b.frame.minWall);
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
