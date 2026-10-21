/**
 * Full-cover geometry probes: every layout (presets + extras) × {box, minimal}.
 *
 * Genus (= number of through-holes): the open-bottom shell is a cup (genus 0); nested pockets,
 * strip indents and finger notches are blind; every opening and every pocket's single bridge
 * access hole connects the face side with the wall side and adds exactly one handle. So for
 * these layouts genus = #openings + #pockets (see expectedGenus in src/geometry/buildCover.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { BILRESA_VARIANTS } from '../src/config/defaults';
import { buildCover, type CoverBuild } from '../src/geometry/buildCover';
import type { EdgeProfile, Kit, Placed } from '../src/geometry/contract';
import { cavityCeiling, notchFloor, type OpeningFeature, type PocketFeature } from '../src/geometry/features';
import { liveObjectCount, withScope } from '../src/geometry/kit';
import { offsetPlaced, outlineWorld, pointInPlaced, shapeCore } from '../src/geometry/shape2d';
import { outerPlaced } from '../src/layout/resolve';
import { LAYOUT_IDS, layoutConfig } from './helpers/configs';
import { getKit, getWasm } from './helpers/manifold';
import { column, filletTopAt, intersectionVolume, pocketProbePoints, ringPrism, seatedBilresa, topOfIntersection } from './helpers/probes';

const STYLE_IDS = ['box', 'minimal'] as const;
const CASES = LAYOUT_IDS.flatMap((id) => STYLE_IDS.map((s) => [id, s] as const));
const TOL = 0.05;

let kit: Kit;
let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await getWasm();
  kit = await getKit('preview');
});

const pockets = (b: CoverBuild) => b.frame.features.filter((f): f is PocketFeature => f.kind === 'pocket');
const openings = (b: CoverBuild) => b.frame.features.filter((f): f is OpeningFeature => f.kind === 'opening');

/** How far an edge profile widens a cut at the face. */
function edgeExtent(e: EdgeProfile): number {
  switch (e.kind) {
    case 'sharp':
      return 0;
    case 'chamfer':
      return e.size;
    case 'fillet':
    case 'flare':
      return e.r;
    case 'step':
      return e.inset;
  }
}

/** Probe column size (see helpers/probes column). */
const COLUMN = 0.3;
/** Across-axis distance of the fillet-wall probe (outside the 34 mm bridge hole). */
const FILLET_PROBE = 19;
/** Overlap (mm³) of the STL's 52 mm strip rim with the default 51 mm strip's indent (see below). */
const STRIP_RIM_OVERLAP = 10;

/** Point inside the finger notch but outside the pocket outline (over the notch backing). */
function notchOuterPoint(f: PocketFeature): [number, number] {
  const n = f.notch!;
  const r = shapeCore(n.shape).r;
  const dx = n.x - f.placed.x;
  const dy = n.y - f.placed.y;
  const len = Math.hypot(dx, dy);
  return [n.x + (dx / len) * (r - 2), n.y + (dy / len) * (r - 2)];
}

describe.each(CASES)('cover %s × %s', (layoutId, styleId) => {
  let b: CoverBuild;
  const config = layoutConfig(layoutId, styleId);

  beforeAll(() => {
    b = buildCover(kit, config);
  });
  afterAll(() => {
    b.manifold.delete();
  });

  it('is one valid solid whose genus is the number of through-holes', () => {
    const m = b.manifold;
    expect(b.style.id).toBe(styleId);
    expect(m.status()).toBe('NoError');
    expect(m.isEmpty()).toBe(false);
    withScope(() => expect(m.decompose().length).toBe(1));
    const throughHoles = openings(b).length + pockets(b).reduce((n, f) => n + f.holes.length, 0);
    expect(b.expectedGenus).toBe(throughHoles);
    expect(m.genus()).toBe(throughHoles);
    expect(b.warnings.filter((w) => w.severity === 'error')).toEqual([]);
    expect(b.frame.warnings).toEqual(b.warnings);
  });

  it('fills the frame: bbox = outer × frontZ, base exactly at z = 0, volume in range', () => {
    const { w, h, cx, cy } = b.frame.outer;
    const box = b.manifold.boundingBox();
    const min = [cx - w / 2, cy - h / 2, 0];
    const max = [cx + w / 2, cy + h / 2, b.frame.frontZ];
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(box.min[i] - min[i]), `min[${i}]`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(box.max[i] - max[i]), `max[${i}]`).toBeLessThanOrEqual(TOL);
    }
    expect(box.min[2]).toBe(0);
    const v = b.manifold.volume();
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(w * h * b.frame.frontZ);
  });

  it('touches the wall only with the skirt ring (slice at z = 0.01)', () => {
    withScope(() => {
      const slice = b.manifold.slice(0.01);
      const body = b.style.outerBody({ frame: b.frame, params: b.params, kit }).slice(0.01);
      const ring = body.area() - kit.cross(outerPlaced(b.frame, b.frame.skirtT)).area();
      expect(ring).toBeGreaterThan(0);
      expect(Math.abs(slice.area() - ring) / ring).toBeLessThan(0.01);
      expect(slice.numContour()).toBe(2); // outer outline + cavity
    });
  });

  it('nested pocket: glue ledges, bridge hole, fillet wall and notch floor sit at the resolved heights', () => {
    const top = b.frame.frontZ + 5;
    for (const f of pockets(b)) {
      withScope(() => {
        const { ledge, hole, fillet } = pocketProbePoints(f, config.bilresa.strip.l);
        for (const [x, y] of ledge) {
          // the strip's end ledges: indent floor on top, the pocket floor's underside below
          const col = b.manifold.intersect(column(kit, x, y, -1, top));
          expect(Math.abs(col.boundingBox().max[2] - (f.floorZ - f.stripDepth)), `${f.id} ledge top`).toBeLessThanOrEqual(TOL);
          expect(Math.abs(col.boundingBox().min[2] - (f.floorZ - b.frame.floorT)), `${f.id} ledge bottom`).toBeLessThanOrEqual(TOL);
        }
        // through the bridge hole at the pocket centre: nothing at all
        expect(intersectionVolume(b.manifold, column(kit, hole[0], hole[1], -1, top)), `${f.id} hole`).toBeLessThan(1e-9);
        // beside the hole, the wall follows the Bilresa's back fillet (+ clearance)
        const wall = topOfIntersection(b.manifold, column(kit, fillet[0], fillet[1], -1, top));
        const expected = filletTopAt(f, FILLET_PROBE + COLUMN / 2);
        expect(expected).toBeGreaterThan(f.floorZ + 0.5);
        expect(expected).toBeLessThan(f.floorZ + f.backFilletR);
        expect(Math.abs(wall - expected), `${f.id} fillet wall`).toBeLessThanOrEqual(0.1);

        if (f.notch) {
          const [nx, ny] = notchOuterPoint(f);
          expect(pointInPlaced([nx, ny], f.placed)).toBe(false);
          // outside the pocket outline but inside the notch: floor of the notch backing, above the pocket floor
          const n = topOfIntersection(b.manifold, column(kit, nx, ny, -1, top));
          expect(Math.abs(n - notchFloor(f)), `${f.id} notch floor`).toBeLessThanOrEqual(TOL);
        }
      });
    }
  });

  it('access holes and openings are clear; outlets have material around them', () => {
    const z0 = -1;
    const z1 = b.frame.frontZ + 5;
    const clear = (p: Placed) => intersectionVolume(b.manifold, kit.prism(offsetPlaced(p, -0.2), z0, z1));
    for (const f of pockets(b)) {
      expect(f.holes).toHaveLength(1);
      for (const hole of f.holes) withScope(() => expect(clear(hole), `${f.id} hole`).toBeLessThan(1e-6));
    }
    const ctx = { frame: b.frame, params: b.params, kit };
    for (const f of openings(b)) {
      withScope(() => {
        expect(clear(f.placed), `${f.id} opening`).toBeLessThan(1e-6);
        const e = f.role === 'outlet' ? edgeExtent(b.style.openingEdge(ctx, f)) : 0.6;
        const ceil = cavityCeiling(b.frame);
        const ring = ringPrism(kit, f.placed, e + 0.2, e + 0.8, ceil + 0.01, b.frame.frontZ - 0.01);
        const filled = intersectionVolume(b.manifold, ring) / ring.volume();
        expect(filled, `${f.id} rim`).toBeGreaterThan(0.85);
      });
    }
  });

  it('outlets hang a sleeve (outline + minWall) from the skin down to the deepest pocket floor', () => {
    const top = b.frame.frontZ + 5;
    const { minWall } = b.frame;
    // where a column beside the opening meets nothing else that reaches lower (wells, notch backings, skirt)
    const inCavity = outerPlaced(b.frame, b.frame.skirtT + 0.5);
    const lower = pockets(b).flatMap((p) => [p.placed, ...(p.notch ? [p.notch] : [])].map((q) => offsetPlaced(q, minWall + 0.5)));
    const deepest = Math.min(...pockets(b).map((p) => p.floorZ));
    for (const f of openings(b)) {
      if (f.role === 'passthrough') {
        expect(f.sleeveZ, `${f.id} passthrough`).toBeUndefined();
        continue;
      }
      expect(f.sleeveZ, `${f.id} sleeveZ`).toBeCloseTo(deepest, 9);
      withScope(() => {
        let probed = 0;
        for (const [x, y] of outlineWorld(f.placed, -minWall / 2, 16)) {
          if (!pointInPlaced([x, y], inCavity) || lower.some((q) => pointInPlaced([x, y], q))) continue;
          const col = b.manifold.intersect(column(kit, x, y, -1, top));
          expect(Math.abs(col.boundingBox().min[2] - f.sleeveZ!), `${f.id} sleeve bottom`).toBeLessThanOrEqual(TOL);
          probed++;
        }
        expect(probed, `${f.id} probes`).toBeGreaterThanOrEqual(8);
        // the wall is solid all round, from the sleeve bottom up to the skin
        const ring = ringPrism(kit, f.placed, 0.2, minWall - 0.2, f.sleeveZ! + 0.1, cavityCeiling(b.frame));
        expect(intersectionVolume(b.manifold, ring) / ring.volume(), `${f.id} sleeve wall`).toBeGreaterThan(0.99);
      });
    }
  });

  it('keeps clear of the plate box (+ clearance, + rocker gap)', () => {
    const { plate } = b.frame;
    const c = plate.clearance;
    withScope(() => {
      const box = kit.prism(
        { shape: { kind: 'roundedRect', w: plate.w + 2 * c - 0.02, h: plate.h + 2 * c - 0.02, r: plate.cornerR + c - 0.01 }, x: 0, y: 0, rotDeg: 0 },
        0,
        plate.protrusion + config.cover.rockerGap - 0.01,
      );
      expect(intersectionVolume(b.manifold, box)).toBeLessThan(1e-6);
    });
  });

  it('leaves room for the real Bilresa model in every pocket (back on the floor, front out)', () => {
    for (const f of pockets(b)) {
      withScope(() => {
        const file = BILRESA_VARIANTS[f.variant].model.split('/').pop()!;
        const device = seatedBilresa(wasm, f, file);
        expect(device.status()).toBe('NoError');
        // the front stands proud of the face by depth − pocket depth; the strip rim dips into its indent
        const box = device.boundingBox();
        expect(box.max[2]).toBeCloseTo(f.floorZ + BILRESA_VARIANTS[f.variant].depth, 4);
        expect(box.max[2]).toBeGreaterThan(b.frame.frontZ);
        expect(box.min[2]).toBeCloseTo(f.floorZ - BILRESA_VARIANTS[f.variant].stripRim, 4);
        // the body (back flat and up) fits the nested pocket exactly
        const big = { shape: { kind: 'roundedRect' as const, w: 500, h: 500, r: 0 }, x: 0, y: 0, rotDeg: 0 };
        const body = device.intersect(kit.prism(big, f.floorZ + 1e-3, b.frame.frontZ + 30));
        expect(intersectionVolume(b.manifold, body), `${f.id} body`).toBeLessThan(1e-3);
        // The STL's strip rim is a 22 × 52 stadium (flat at its −y end); the default 51 mm strip's
        // indent (51.4) is 0.3 mm shorter at each end, so the rim's tips overlap the glue ledges:
        // a few mm³, only in the indent's height band and only beyond the bridge hole.
        const overlap = b.manifold.intersect(device);
        const v = overlap.isEmpty() ? 0 : overlap.volume();
        expect(v, `${f.id} rim`).toBeLessThan(STRIP_RIM_OVERLAP);
        if (v > 0) {
          const ob = overlap.boundingBox();
          expect(ob.min[2]).toBeGreaterThanOrEqual(f.floorZ - f.stripDepth - 1e-3);
          expect(ob.max[2]).toBeLessThanOrEqual(f.floorZ + 1e-3);
        }
      });
    }
  });
});

describe('export quality', () => {
  let exportKit: Kit;
  beforeAll(async () => {
    exportKit = await getKit('export');
  });

  it.each(CASES)('%s × %s is valid with the same topology', (layoutId, styleId) => {
    withScope(() => {
      const b = buildCover(exportKit, layoutConfig(layoutId, styleId));
      expect(b.manifold.status()).toBe('NoError');
      expect(b.manifold.decompose().length).toBe(1);
      expect(b.manifold.genus()).toBe(b.expectedGenus);
      expect(b.warnings.filter((w) => w.severity === 'error')).toEqual([]);
    });
  });
});

describe('buildCover memory and speed', () => {
  it('leaves zero live WASM objects after 50 builds', () => {
    const before = liveObjectCount();
    for (let i = 0; i < 50; i++) {
      const id = LAYOUT_IDS[i % LAYOUT_IDS.length];
      withScope(() => {
        buildCover(kit, layoutConfig(id, STYLE_IDS[i % 2]));
        return null;
      });
    }
    expect(liveObjectCount()).toBe(before);
  });

  it('stays within the preview / export time budget (soft, logged)', async () => {
    const exportKit = await getKit('export');
    const time = (k: Kit, id: string) =>
      withScope(() => {
        const t0 = performance.now();
        const { manifold } = buildCover(k, layoutConfig(id, 'minimal'));
        return { ms: performance.now() - t0, tris: manifold.numTri() };
      });
    for (const id of ['ch-sd-3x1h-three-switches', 'ch-sd-2x2']) {
      time(kit, id); // warm up
      const preview = time(kit, id);
      const exp = time(exportKit, id);
      console.info(`[budget] ${id}: preview ${preview.ms.toFixed(0)} ms / ${preview.tris} tris, export ${exp.ms.toFixed(0)} ms / ${exp.tris} tris`);
      if (preview.ms > 1500) console.warn(`[budget] preview build of ${id} took ${preview.ms.toFixed(0)} ms (> 1500 ms)`);
      expect(exp.tris).toBeLessThan(40_000);
    }
  });
});
