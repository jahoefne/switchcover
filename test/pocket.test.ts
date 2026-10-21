/**
 * WP5 — Bilresa orientation: the flat face of the reference STL is the FRONT, the rounded end the
 * BACK that rests on the pocket floor. Nested pocket (void + well follow the R8 back fillet),
 * glue ledges + one bridge access hole, Ø14 finger notch down to floorZ + 2 bridged to the skirt
 * (off by default; the notch tests switch it on), ghost placement, and the exported STLs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { BILRESA_VARIANTS, NOTCH_FLOOR_LIFT, backFilletInset } from '../src/config/defaults';
import { presetConfig } from '../src/config/presets';
import { buildCover, type CoverBuild } from '../src/geometry/buildCover';
import { buildTestFit } from '../src/geometry/buildTestFit';
import type { Kit, Placed } from '../src/geometry/contract';
import { parseBinaryStl, toBinaryStl } from '../src/geometry/export/stl';
import { FILLET_SEGMENTS, holeExitHeight, notchFloor, skirtBridge, voidOutlineAt, type PocketFeature } from '../src/geometry/features';
import { withScope } from '../src/geometry/kit';
import { containmentMargin, offsetPlaced, outwardDirection, toWorld } from '../src/geometry/shape2d';
import { backingGap } from '../src/layout/resolve';
import { bilresaGhostPlacement, placeGhostPoint } from '../src/ui/viewer/ghost';
import { getKit, getWasm } from './helpers/manifold';
import { column, filletTopAt, intersectionVolume, manifoldOfMesh, modelPath, readStlMesh, seatedBilresa, topOfIntersection } from './helpers/probes';

let kit: Kit;
let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await getWasm();
  kit = await getKit('preview');
});

const COLUMN = 0.3;
const pocketOf = (b: { frame: { features: unknown[] } }) => b.frame.features.find((f): f is PocketFeature => (f as PocketFeature).kind === 'pocket')!;
const BIG: Placed = { shape: { kind: 'roundedRect', w: 600, h: 600, r: 0 }, x: 0, y: 0, rotDeg: 0 };

describe('reference STL orientation (front at z = 0, back flat at −18.5, R8 back fillet)', () => {
  it.each(['2button', 'wheel'] as const)('%s: slice widths follow backFilletInset above the back flat', (variant) => {
    withScope(() => {
      const v = BILRESA_VARIANTS[variant];
      const m = manifoldOfMesh(wasm, readStlMesh(modelPath(v.model.split('/').pop()!)));
      const box = m.boundingBox();
      expect(box.max[2]).toBeCloseTo(0, 3); // the flat front
      expect(box.min[2]).toBeCloseTo(-v.depth - v.stripRim, 3); // strip rim below the back flat
      // the fillet region (the bodies have shallow inward grooves higher up, irrelevant for the fit)
      for (const h of [0.2, 1, 2, 3, 5, 7, 8.1]) {
        const b = m.slice(-v.depth + h).bounds();
        const inset = backFilletInset(v.backFilletR, h);
        // the mesh's chords sit slightly inside the true arc
        expect(Math.abs(b.max[0] - b.min[0] - (v.outline.w - 2 * inset)), `w at h=${h}`).toBeLessThan(0.08);
        expect(Math.abs(b.max[1] - b.min[1] - (v.outline.h - 2 * inset)), `h at h=${h}`).toBeLessThan(0.08);
      }
    });
  });
});

describe('ghost placement (viewer) = seated Bilresa (tests)', () => {
  it('no tilt: back flat on the floor, front at floorZ + 18.5, rotated about the pocket centre', () => {
    const f = { placed: { shape: { kind: 'stadium' as const, w: 40.6, h: 70.6 }, x: 10, y: -5, rotDeg: 90 }, floorZ: 16.4, variant: '2button' as const };
    const g = bilresaGhostPlacement(f);
    expect(g).toEqual({ position: [10, -5, 16.4 + 18.5], rotZDeg: 90 });
    const front = placeGhostPoint(g, [0, 0, 0]);
    expect(front[2]).toBeCloseTo(34.9, 9);
    expect(placeGhostPoint(g, [0, 0, -18.5])[2]).toBeCloseTo(16.4, 9);
    // the STL's +Y end (long axis) turns to −X for rot 90
    const end = placeGhostPoint(g, [0, 35, -5]);
    expect(end[0]).toBeCloseTo(10 - 35, 9);
    expect(end[1]).toBeCloseTo(-5, 9);
  });

  it('seatedBilresa uses the same placement', () => {
    withScope(() => {
      const b = buildCover(kit, presetConfig('ch-sd-1x2v-two-switches'));
      const f = pocketOf(b);
      const device = seatedBilresa(wasm, f, 'Bilresa_twobutton.stl');
      const box = device.boundingBox();
      expect(box.max[2]).toBeCloseTo(f.floorZ + 18.5, 4);
      // rotated 90°: long axis along X
      expect(box.max[0] - box.min[0]).toBeCloseTo(70, 2);
      expect(box.max[1] - box.min[1]).toBeCloseTo(40, 2);
      return null;
    });
  });
});

describe('nested pocket (ch-sd-1x1, minimal)', () => {
  let b: CoverBuild;
  let f: PocketFeature;
  /** The same cover with the finger notch switched on (it is off by default). */
  let bn: CoverBuild;
  let fn: PocketFeature;
  beforeAll(() => {
    b = buildCover(kit, presetConfig('ch-sd-1x1'));
    f = pocketOf(b);
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.notch.enabled = true;
    bn = buildCover(kit, c);
    fn = pocketOf(bn);
  });

  it('lofts the fillet finely enough (chord error < 0.05 mm)', () => {
    expect(FILLET_SEGMENTS + 1).toBeGreaterThanOrEqual(10);
    expect(f.backFilletR * (1 - Math.cos(Math.PI / 4 / FILLET_SEGMENTS))).toBeLessThan(0.05);
  });

  it('the void follows the fillet + clearance across and along the pocket', () => {
    const top = b.frame.frontZ + 5;
    withScope(() => {
      // across (v = 0), outside the 34 mm hole
      for (const u of [17.6, 18.5, 19.5, 20]) {
        const [x, y] = toWorld(f.placed, [u, 0]);
        const z = topOfIntersection(b.manifold, column(kit, x, y, -1, top));
        expect(Math.abs(z - filletTopAt(f, u + COLUMN / 2)), `u=${u}`).toBeLessThanOrEqual(0.1);
      }
      // along (u = 0) towards both ends (no notch by default), beyond the strip indent (|v| ≤ 26.2):
      // the fillet
      expect(f.notch).toBeUndefined();
      const half = 35.3;
      for (const dir of [-1, 1]) {
        for (const v of [28.5, 30, 32, 34]) {
          const [x, y] = toWorld(f.placed, [0, dir * v]);
          const z = topOfIntersection(b.manifold, column(kit, x, y, -1, top));
          const inset = half - (v + COLUMN / 2);
          const want = f.floorZ + f.backFilletR - Math.sqrt(f.backFilletR ** 2 - (f.backFilletR - inset) ** 2);
          expect(Math.abs(z - want), `v=${dir * v}`).toBeLessThanOrEqual(0.1);
        }
      }
      return null;
    });
  });

  it('the well follows the same profile offset by minWall (uniform wall, no material wasted in the cavity)', () => {
    withScope(() => {
      const r = f.backFilletR;
      const R = r + b.frame.minWall;
      for (const u of [18, 19, 20]) {
        const [x, y] = toWorld(f.placed, [u, 0]);
        const m = b.manifold.intersect(column(kit, x, y, -1, b.frame.frontZ + 5));
        // the lowest material in the column: the outer arc at the column's inner edge
        const xi = u - COLUMN / 2 - (20.3 - r); // distance beyond the void floor's edge
        const want = f.floorZ + r - Math.sqrt(R * R - xi * xi);
        expect(Math.abs(m.boundingBox().min[2] - want), `u=${u}`).toBeLessThanOrEqual(0.1);
      }
      return null;
    });
  });

  it('the bridge hole cuts the floor and the foot of the fillet wall, ending where the void contains it', () => {
    const [hole] = f.holes;
    const exit = holeExitHeight(f, hole);
    // 34 × 20, r 1.5: the 20 mm length stays inside the stadium's straight part (|v| ≤ 15), so only
    // the straight sides set the exit: the void's half width 20.3 − inset must clear the hole's 17
    // by HOLE_EXIT_MARGIN 0.05 → inset 3.25 → h = 8 − √(8² − 4.75²) ≈ 1.563
    expect(exit).toBeGreaterThan(1.5);
    expect(exit).toBeLessThan(2.6);
    expect(exit).toBeCloseTo(8 - Math.sqrt(64 - 4.75 ** 2), 6);
    expect(containmentMargin(hole, voidOutlineAt(f, exit))).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(containmentMargin(hole, voidOutlineAt(f, exit - 0.05))).toBeLessThan(0.05);
    withScope(() => {
      // just inside the hole's side, at the hole's middle: open from the cavity up into the void
      const [x, y] = toWorld(f.placed, [16.5, 0]);
      expect(intersectionVolume(b.manifold, column(kit, x, y, -1, b.frame.frontZ + 5, 0.2))).toBeLessThan(1e-9);
      // just outside it: the fillet wall
      const [x2, y2] = toWorld(f.placed, [17.4, 0]);
      expect(topOfIntersection(b.manifold, column(kit, x2, y2, -1, b.frame.frontZ + 5, 0.2))).toBeGreaterThan(f.floorZ + 1);
      return null;
    });
  });

  it('the Ø14 notch (switched on) cuts the fillet wall down to floorZ + 2 at the far end and is blind', () => {
    const n = fn.notch!;
    expect(n.shape).toEqual({ kind: 'circle', d: 14 });
    // on the plate's centre line both ends tie: the lower one
    expect(n).toMatchObject({ x: 0, y: -35.3 });
    expect(notchFloor(fn)).toBeCloseTo(fn.floorZ + NOTCH_FLOOR_LIFT, 9);
    expect(bn.frame.outer).toMatchObject({ w: b.frame.outer.w, h: b.frame.outer.h }); // the notch fits the plate-driven size
    const dir = Math.sign(n.y - fn.placed.y);
    withScope(() => {
      // inside the pocket outline, beyond the void at h = 2: the notch floor (the fillet would be higher)
      const [x, y] = toWorld(fn.placed, [0, dir * 34]);
      const z = topOfIntersection(bn.manifold, column(kit, x, y, -1, bn.frame.frontZ + 5));
      expect(Math.abs(z - notchFloor(fn))).toBeLessThanOrEqual(0.05);
      expect(filletTopAt({ ...fn, placed: { ...fn.placed, shape: { kind: 'stadium', w: 70.6, h: 70.6 } } }, 34.15)).toBeGreaterThan(z + 1);
      // the default cover (no notch) keeps the fillet there
      expect(topOfIntersection(b.manifold, column(kit, x, y, -1, b.frame.frontZ + 5))).toBeGreaterThan(z + 1);
      // material under the notch floor all the way across the notch (blind)
      for (const t of [-6, -3, 0, 3, 6]) {
        const [px, py] = [n.x + t, n.y];
        const m = bn.manifold.intersect(column(kit, px, py, -1, bn.frame.frontZ + 5, 0.2));
        expect(m.isEmpty(), `t=${t}`).toBe(false);
      }
      return null;
    });
    expect(bn.manifold.genus()).toBe(1);
  });

  it('a notch backing ending 0 … minWall short of the skirt is bridged to it', () => {
    // backing: notch (r 7) + minWall 2 = r 9 at y = −35.3, bottom −44.3; skirt inside at
    // −48.4 + 2.4 = −46: a 1.7 mm gap
    const backing = offsetPlaced(fn.notch!, bn.frame.minWall);
    const gap = backingGap(bn.frame.outer, bn.frame.skirtT, backing);
    expect(gap).toBeCloseTo(1.7, 6);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(bn.frame.minWall);
    const bridge = skirtBridge(bn.frame, backing)!;
    expect(bridge).not.toBeNull();
    // straight down for the 1×1 (notch at the bottom end)
    expect(bridge.rotDeg).toBeCloseTo(-180, 6);
    withScope(() => {
      // material between the backing and the skirt, below the face (air in the default cover)
      const y = backing.y - (backing.shape as { d: number }).d / 2 - gap / 2;
      const m = bn.manifold.intersect(column(kit, 0, y, fn.floorZ + 0.5, bn.frame.frontZ - bn.frame.skinT - 0.5, 0.2));
      expect(m.isEmpty()).toBe(false);
      expect(intersectionVolume(b.manifold, column(kit, 0, y, f.floorZ + 0.5, b.frame.frontZ - b.frame.skinT - 0.5, 0.2))).toBeLessThan(1e-9);
      return null;
    });
    // no bridge when there is room (≥ minWall) or when the backing already reaches the skirt
    expect(skirtBridge({ ...bn.frame, outer: { ...bn.frame.outer, h: bn.frame.outer.h + 10 } }, backing)).toBeNull();
    expect(skirtBridge({ ...bn.frame, outer: { ...bn.frame.outer, h: bn.frame.outer.h - 4 } }, backing)).toBeNull();
  });

  it('outwardDirection points to the nearest boundary', () => {
    const rr: Placed = { shape: { kind: 'roundedRect', w: 100, h: 60, r: 10 }, x: 0, y: 0, rotDeg: 0 };
    expect(outwardDirection(rr, [0, -25])).toEqual([0, -1]);
    expect(outwardDirection(rr, [45, 0])).toEqual([1, 0]);
    const d = outwardDirection(rr, [45, 25]);
    expect(d[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(d[1]).toBeCloseTo(Math.SQRT1_2, 9);
    const rot = outwardDirection({ ...rr, rotDeg: 90 }, [0, 45]);
    expect(rot[0]).toBeCloseTo(0, 9);
    expect(rot[1]).toBeCloseTo(1, 9);
  });

  it('the reference model fits the default 52 mm indentation; a 51 mm strip would clip the rim tips', () => {
    withScope(() => {
      // default strip length 52 (= the STL rim length): the whole seated model is clear of the cover
      const d = seatedBilresa(wasm, f, 'Bilresa_twobutton.stl');
      expect(intersectionVolume(b.manifold, d)).toBeLessThan(1e-3);
      // with a 51 mm strip only the rim tips overlap the glue ledges (a few mm³); the body above
      // the floor still fits exactly
      const c = presetConfig('ch-sd-1x1');
      c.bilresa.strip.l = 51;
      const g = buildCover(kit, c);
      const p = pocketOf(g);
      const d51 = seatedBilresa(wasm, p, 'Bilresa_twobutton.stl');
      const v = intersectionVolume(g.manifold, d51);
      expect(v).toBeGreaterThan(1);
      expect(v).toBeLessThan(10);
      expect(intersectionVolume(g.manifold, d51.intersect(kit.prism(BIG, p.floorZ + 1e-3, 80)))).toBeLessThan(1e-3);
      return null;
    });
  });
});

describe('exported STLs (export quality)', () => {
  let exportKit: Kit;
  beforeAll(async () => {
    exportKit = await getKit('export');
  });

  it.each(['minimal', 'organic'] as const)('switch + socket cover and test fit (%s), face down: valid, front at z = 0', (styleId) => {
    withScope(() => {
      const c = presetConfig('ch-sd-1x2v-switch-socket');
      c.cover.style = styleId;
      const cover = buildCover(exportKit, c);
      const fit = buildTestFit(exportKit, c);
      for (const [what, m, genus, height] of [
        ['cover', cover.manifold, 2, cover.frame.frontZ],
        ['test fit', fit.manifold, 1, fit.manifold.boundingBox().max[2]],
      ] as const) {
        const stl = toBinaryStl(m, { orientation: 'faceDown' });
        const mesh = parseBinaryStl(stl);
        const back = manifoldOfMesh(wasm, mesh);
        expect(back.status(), what).toBe('NoError');
        expect(back.genus(), what).toBe(genus);
        expect(back.decompose().length, what).toBe(1);
        const box = back.boundingBox();
        expect(box.min[2], what).toBeCloseTo(0, 4);
        expect(box.max[2], what).toBeCloseTo(height, 3);
        // face down: the face (largest z in the model) is now the bed layer at z = 0
        const bed = back.slice(0.05).area();
        expect(bed, what).toBeGreaterThan(0);
      }
      // the test fit stays small
      expect(fit.manifold.volume() * 1.24e-3).toBeLessThan(25);
      return null;
    });
  });
});
