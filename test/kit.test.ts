import { beforeAll, describe, expect, it } from 'vitest';
import type { EdgeProfile, Kit, Placed } from '../src/geometry/contract';
import { createKit, liveObjectCount, OVERSHOOT, withScope } from '../src/geometry/kit';
import { expectSolid, getKit, getWasm } from './helpers/manifold';

let kit: Kit;
beforeAll(async () => {
  kit = await getKit('preview');
});

const circle = (d: number, x = 0, y = 0): Placed => ({ shape: { kind: 'circle', d }, x, y, rotDeg: 0 });
const stadium = (w: number, h: number, x = 0, y = 0, rotDeg = 0): Placed => ({
  shape: { kind: 'stadium', w, h },
  x,
  y,
  rotDeg,
});
const rrect = (w: number, h: number, r: number, x = 0, y = 0, rotDeg = 0): Placed => ({
  shape: { kind: 'roundedRect', w, h, r },
  x,
  y,
  rotDeg,
});

describe('kit basics', () => {
  it('segments follow the quality presets and are multiples of 4', async () => {
    const wasm = await getWasm();
    const preview = createKit(wasm, 'preview');
    expect(preview.segments(20)).toBe(36); // 10° cap
    expect(preview.segments(1) % 4).toBe(0);
    expect(preview.segments(0)).toBe(4);
    const exp = createKit(wasm, 'export');
    expect(exp.segments(20)).toBe(120); // 3° cap
    expect(exp.segments(1)).toBeGreaterThan(preview.segments(1)); // kits re-apply their own quality
    expect(preview.segments(20)).toBe(36);
  });

  it('outlines: circles have exactly segments(r) points, rounded rects are symmetric', () => {
    expect(kit.ring(circle(20), 0, 0).length).toBe(kit.segments(10));
    const pts = kit.ring(rrect(30, 20, 5), 0, 0);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-15, 9);
    expect(Math.max(...xs)).toBeCloseTo(15, 9);
    expect(Math.min(...ys)).toBeCloseTo(-10, 9);
    expect(Math.max(...ys)).toBeCloseTo(10, 9);
    // the straight top edge exists at both ends
    expect(pts.some((p) => Math.abs(p[0] - 10) < 1e-9 && Math.abs(p[1] - 10) < 1e-9)).toBe(true);
    expect(pts.some((p) => Math.abs(p[0] + 10) < 1e-9 && Math.abs(p[1] - 10) < 1e-9)).toBe(true);
  });

  it('cross() builds rotated, translated outlines', () => {
    withScope(() => {
      const c = kit.cross(circle(10, 5, -3));
      expect(c.isEmpty()).toBe(false);
      const cb = c.bounds();
      expect(cb.min[0]).toBeCloseTo(0, 6);
      expect(cb.max[0]).toBeCloseTo(10, 6);
      expect(cb.min[1]).toBeCloseTo(-8, 6);

      const s = kit.cross(stadium(40, 70, 0, 0, 90));
      const sb = s.bounds();
      expect(sb.max[0]).toBeCloseTo(35, 6);
      expect(sb.max[1]).toBeCloseTo(20, 6);

      const r = kit.cross(rrect(30, 20, 0));
      expect(r.area()).toBeCloseTo(600, 6);
      const rr = kit.cross(rrect(30, 20, 5));
      expect(rr.area()).toBeLessThan(600);
      expect(rr.area()).toBeGreaterThan(600 - (4 - Math.PI) * 25 - 1);
    });
  });

  it('ring() returns CCW points at z with the inset applied', () => {
    const pts = kit.ring(rrect(30, 20, 5), 1, 7);
    expect(pts.every((p) => p[2] === 7)).toBe(true);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(14, 9);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(9, 9);
    // same sample count at another inset
    expect(kit.ring(rrect(30, 20, 5), 2, 0).length).toBe(pts.length);
    // shoelace > 0 ⇒ CCW
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      area += x0 * y1 - x1 * y0;
    }
    expect(area).toBeGreaterThan(0);
  });

  it('hull() and prism() produce valid solids with the expected boxes', () => {
    withScope(() => {
      const h = kit.hull([
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
        [10, 10, 10],
      ]);
      expectSolid(h, [0, 0, 0], [10, 10, 10]);

      const p = kit.prism(stadium(40, 70, 3, 4), 1, 6);
      expectSolid(p, [-17, -31, 1], [23, 39, 6]);
      expect(() => kit.prism(circle(5), 2, 2)).toThrow(RangeError);
    });
  });

  it('loft() unions pairwise hulls of offset slices', () => {
    withScope(() => {
      const m = kit.loft(rrect(20, 10, 2), [
        { z: 0, offset: 0 },
        { z: 2, offset: 0 },
        { z: 5, offset: 3 },
      ]);
      expectSolid(m, [-13, -8, 0], [13, 8, 5]);
      expect(m.decompose().length).toBe(1);
      expect(() => kit.loft(circle(5), [{ z: 0, offset: 0 }])).toThrow(RangeError);
      expect(() =>
        kit.loft(circle(5), [
          { z: 1, offset: 0 },
          { z: 1, offset: 1 },
        ]),
      ).toThrow(RangeError);
    });
  });
});

describe('edgeTool', () => {
  const zTop = 25;
  const through = 13;
  const zMin = zTop - through - OVERSHOOT;
  const zMax = zTop + OVERSHOOT;
  const profiles: Array<[EdgeProfile, number]> = [
    // [profile, outward offset at the tool top (zTop + overshoot)]
    [{ kind: 'sharp' }, 0],
    [{ kind: 'chamfer', size: 0 }, 0],
    [{ kind: 'chamfer', size: 2 }, 2 + OVERSHOOT],
    [{ kind: 'fillet', r: 3 }, 3 + OVERSHOOT],
    [{ kind: 'flare', r: 6, depth: 8 }, 6 + OVERSHOOT],
    [{ kind: 'step', inset: 2, depth: 3 }, 2],
  ];

  for (const [edge, top] of profiles) {
    it(`${edge.kind} ${JSON.stringify(edge)} — circle (revolve)`, () => {
      withScope(() => {
        const t = kit.edgeTool(circle(46, 10, -5), zTop, edge, through);
        const R = 23 + top;
        expectSolid(t, [10 - R, -5 - R, zMin], [10 + R, -5 + R, zMax], 1e-3);
        expect(t.genus()).toBe(0);
        expect(t.decompose().length).toBe(1);
      });
    });

    it(`${edge.kind} ${JSON.stringify(edge)} — rotated stadium (loft)`, () => {
      withScope(() => {
        const t = kit.edgeTool(stadium(40.6, 70.6, 0, 30, 90), zTop, edge, through);
        expectSolid(t, [-35.3 - top, 30 - 20.3 - top, zMin], [35.3 + top, 30 + 20.3 + top, zMax], 1e-3);
        expect(t.decompose().length).toBe(1);
      });
    });

    it(`${edge.kind} ${JSON.stringify(edge)} — rounded rect (loft)`, () => {
      withScope(() => {
        const t = kit.edgeTool(rrect(52, 30, 4), zTop, edge, through);
        expectSolid(t, [-26 - top, -15 - top, zMin], [26 + top, 15 + top, zMax], 1e-3);
      });
    });
  }

  it('clamps edge depth to the tool depth', () => {
    withScope(() => {
      const t = kit.edgeTool(circle(20), 5, { kind: 'chamfer', size: 10 }, 3);
      expectSolid(t, [-13.1, -13.1, 5 - 3 - OVERSHOOT], [13.1, 13.1, 5 + OVERSHOOT], 1e-3);
    });
  });
});

describe('scope', () => {
  it('deletes everything except the returned object', () => {
    const before = liveObjectCount();
    const kept = withScope(() => {
      const a = kit.prism(circle(10), 0, 1);
      const b = kit.prism(circle(5), 0, 2);
      // un-kept intermediates are tracked automatically
      const c = a.add(b).translate([1, 0, 0]);
      kit.cross(stadium(10, 20));
      return c;
    });
    expect(liveObjectCount()).toBe(before + 1);
    expectSolid(kept);
    kept.delete();
    expect(liveObjectCount()).toBe(before);
  });

  it('keeps objects returned inside arrays / plain objects and hands them to the parent', () => {
    const before = liveObjectCount();
    withScope(() => {
      const inner = withScope(() => {
        const a = kit.prism(circle(10), 0, 1);
        kit.prism(circle(3), 0, 1); // dropped
        return { add: [a], note: 'x' };
      });
      expect(inner.add[0].isEmpty()).toBe(false);
      expect(liveObjectCount()).toBe(before + 1);
      return 42;
    });
    expect(liveObjectCount()).toBe(before);
  });

  it('cleans up when fn throws', () => {
    const before = liveObjectCount();
    expect(() =>
      withScope(() => {
        kit.prism(circle(10), 0, 1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(liveObjectCount()).toBe(before);
  });

  it('never deletes objects owned by an outer scope', () => {
    const before = liveObjectCount();
    withScope(() => {
      const outer = kit.prism(circle(10), 0, 1);
      withScope(() => {
        withScope(() => outer); // returning an outer object must not transfer ownership
        return null;
      });
      expect(outer.isEmpty()).toBe(false);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });

  it('tracks objects made by raw manifold-3d calls and constructors', async () => {
    const wasm = await getWasm();
    const before = liveObjectCount();
    withScope(() => {
      const cs = new wasm.CrossSection([
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      ]);
      const m = wasm.Manifold.extrude(cs, 2).add(wasm.Manifold.cube([1, 1, 1]));
      expect(m.status()).toBe('NoError');
      wasm.Manifold.revolve(
        [
          [
            [1, 0],
            [2, 0],
            [2, 1],
          ],
        ],
        16,
      );
      expect(liveObjectCount()).toBeGreaterThan(before);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });

  it('every kit helper leaves zero live objects after its scope', () => {
    const before = liveObjectCount();
    withScope(() => {
      kit.cross(rrect(10, 10, 2));
      kit.hull(kit.ring(circle(10), 0, 0).concat(kit.ring(circle(10), 1, 3)));
      kit.prism(stadium(10, 30), 0, 3);
      kit.loft(stadium(10, 30), [
        { z: 0, offset: 0 },
        { z: 3, offset: 1 },
      ]);
      for (const p of [circle(20), stadium(20, 40), rrect(20, 30, 3)]) {
        kit.edgeTool(p, 10, { kind: 'fillet', r: 2 }, 5);
        kit.edgeTool(p, 10, { kind: 'step', inset: 2, depth: 2 }, 5);
      }
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });
});
