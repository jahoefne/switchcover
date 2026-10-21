import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { listPresets, presetConfig } from '../src/config/presets';
import { buildCover, expectedGenus, placeFeaturesOnFace, prepareCover } from '../src/geometry/buildCover';
import type { CoverStyle, Kit } from '../src/geometry/contract';
import type { PocketFeature } from '../src/geometry/features';
import { liveObjectCount, withScope } from '../src/geometry/kit';
import { outerPlaced } from '../src/layout/resolve';
import { getStyle, listStyles, parseStyleParams, resolveStyle, type AnyCoverStyle } from '../src/styles';
import { minimalStyle } from '../src/styles/minimal';
import { expectSolid, getKit } from './helpers/manifold';
import { column, plainFloorPoint, topOfIntersection } from './helpers/probes';

let kit: Kit;
beforeAll(async () => {
  kit = await getKit('preview');
});

describe('buildCover (staged: body − (cavity − wells) − cuts)', () => {
  it.each(listPresets().map((p) => [p.id] as const))('%s: valid, single piece, genus = through-holes, bbox = frame', (id) => {
    const before = liveObjectCount();
    withScope(() => {
      const { manifold, frame, warnings, expectedGenus: genus } = buildCover(kit, presetConfig(id));
      const { w, h, cx, cy } = frame.outer;
      expectSolid(manifold, [cx - w / 2, cy - h / 2, 0], [cx + w / 2, cy + h / 2, frame.frontZ], 1e-4);
      expect(manifold.boundingBox().min[2]).toBe(0);
      expect(manifold.decompose().length).toBe(1);
      expect(genus).toBe(expectedGenus(frame));
      expect(manifold.genus()).toBe(genus);
      expect(genus).toBeGreaterThan(0);
      expect(warnings.some((w) => w.severity === 'error')).toBe(false);
      // hollow: much less than the full box
      expect(manifold.volume()).toBeLessThan(0.5 * w * h * frame.frontZ);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });

  it('also builds at export quality', async () => {
    const exportKit = await getKit('export');
    withScope(() => {
      const preview = buildCover(kit, presetConfig('ch-sd-1x1')).manifold.numTri();
      const fine = buildCover(exportKit, presetConfig('ch-sd-1x1')).manifold;
      expect(fine.numTri()).toBeGreaterThan(preview);
      expect(fine.genus()).toBe(2);
      return null;
    });
  });

  it('falls back to the default style for unknown ids, with a warning', () => {
    const c = presetConfig('ch-sd-1x1');
    c.cover.style = 'does-not-exist';
    withScope(() => {
      const { frame, style, warnings } = buildCover(kit, c);
      expect(style.id).toBe('box');
      expect(frame.warnings.map((w) => w.code)).toContain('style-unknown');
      expect(warnings).toEqual(frame.warnings);
      return null;
    });
  });

  it('counts openings and access holes over the cavity as through-holes', () => {
    withScope(() => {
      const { frame } = prepareCover(kit, presetConfig('ch-sd-2x2'));
      // two pockets × two access holes + two outlets
      expect(expectedGenus(frame)).toBe(6);
      // a hole entirely over the skirt would be blind
      const cav = outerPlaced(frame, frame.skirtT);
      const skirtOnly = { ...frame, features: frame.features.filter((f) => f.kind === 'pocket').slice(0, 1) } as typeof frame;
      const p = skirtOnly.features[0] as PocketFeature;
      const hole = { shape: { kind: 'circle' as const, d: 1 }, x: cav.x + frame.outer.w / 2 - frame.skirtT / 2, y: 0, rotDeg: 0 };
      expect(expectedGenus({ ...skirtOnly, features: [{ ...p, holes: [hole] }] })).toBe(0);
      return null;
    });
  });

  it('reports validation failures as error warnings instead of throwing', () => {
    // A style whose decoration drills an extra hole through the face: genus mismatch.
    const drill: AnyCoverStyle = {
      ...(minimalStyle as unknown as AnyCoverStyle),
      id: 'drill',
      decorate: ({ kit: k, frame }) => ({
        subtract: k.prism({ shape: { kind: 'circle', d: 4 }, x: frame.outer.w / 2 - 6, y: 0, rotDeg: 0 }, -1, frame.frontZ + 1),
      }),
    };
    withScope(() => {
      const b = buildCover(kit, presetConfig('ch-sd-1x1'), { style: drill });
      expect(b.expectedGenus).toBe(2);
      expect(b.manifold.genus()).toBe(3);
      const err = b.warnings.find((w) => w.code === 'geometry-genus');
      expect(err?.severity).toBe('error');
      return null;
    });
  });

  it('does not check genus when the layout already reports overlapping features', () => {
    const c = presetConfig('ch-sd-2x2');
    // push the right outlet into the left one: the two cuts merge into one hole
    c.modules.find((m) => m.col === 1 && m.row === 1)!.dx = -40;
    withScope(() => {
      const b = buildCover(kit, c);
      expect(b.warnings.map((w) => w.code)).toContain('feature-overlap');
      expect(b.expectedGenus).toBeNull();
      expect(b.manifold.status()).toBe('NoError');
      expect(b.warnings.some((w) => w.code.startsWith('geometry-'))).toBe(false);
      return null;
    });
  });

  it('applies style decorations (add, then subtract)', () => {
    const bump: AnyCoverStyle = {
      ...(minimalStyle as unknown as AnyCoverStyle),
      id: 'bump',
      decorate: ({ kit: k, frame }) => ({
        add: k.prism({ shape: { kind: 'circle', d: 6 }, x: frame.outer.w / 2 - 8, y: 0, rotDeg: 0 }, frame.frontZ - 1, frame.frontZ + 1),
        subtract: k.prism({ shape: { kind: 'circle', d: 3 }, x: -(frame.outer.w / 2 - 8), y: 0, rotDeg: 0 }, frame.frontZ - 1, frame.frontZ + 1),
      }),
    };
    withScope(() => {
      const plain = buildCover(kit, presetConfig('ch-sd-1x1'), { style: minimalStyle as unknown as AnyCoverStyle });
      const deco = buildCover(kit, presetConfig('ch-sd-1x1'), { style: bump });
      expect(deco.manifold.boundingBox().max[2]).toBeCloseTo(plain.frame.frontZ + 1, 6);
      const x = plain.frame.outer.w / 2 - 8;
      expect(topOfIntersection(deco.manifold, column(kit, -x, 0, -1, 40))).toBeCloseTo(plain.frame.frontZ - 1, 4);
      expect(deco.manifold.genus()).toBe(deco.expectedGenus);
      return null;
    });
  });
});

describe('domed styles: features follow surfaceZ', () => {
  const sag = 3;
  const dome = (frame: { outer: { w: number; h: number; cx: number; cy: number }; frontZ: number }, x: number, y: number) => {
    const u = Math.min(1, Math.abs((2 * (x - frame.outer.cx)) / frame.outer.w));
    const v = Math.min(1, Math.abs((2 * (y - frame.outer.cy)) / frame.outer.h));
    return frame.frontZ + sag * (1 - u * u) * (1 - v * v);
  };
  const params = z.object({});
  const domeStyle: CoverStyle<typeof params> = {
    id: 'test-dome',
    version: 1,
    label: 'Test dome',
    description: 'test only',
    params,
    printOrientation: 'faceUp',
    printHint: '',
    limits: () => ({ minFrame: 0, minFrontZ: 0, maxEdgeR: 0 }),
    surfaceZ: (c, x, y) => dome(c.frame, x, y),
    outerBody: ({ frame, kit: k }) => {
      const o = outerPlaced(frame);
      const pts = [...k.ring(o, 0, 0), ...k.ring(o, 0, frame.frontZ)];
      const n = 24;
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          const x = frame.outer.cx + (i / n - 0.5) * frame.outer.w;
          const y = frame.outer.cy + (j / n - 0.5) * frame.outer.h;
          pts.push([x * 0.999, y * 0.999, dome(frame, x, y)]);
        }
      }
      return k.hull(pts);
    },
    openingEdge: () => ({ kind: 'fillet', r: 2 }),
  };
  const style = domeStyle as unknown as AnyCoverStyle;

  it('lifts pocket floors by the local face height and stays valid', () => {
    withScope(() => {
      const config = presetConfig('ch-sd-1x2v-switch-socket');
      const flat = prepareCover(kit, config).frame;
      const b = buildCover(kit, config, { style });
      expect(b.manifold.status()).toBe('NoError');
      expect(b.manifold.decompose().length).toBe(1);
      expect(b.manifold.genus()).toBe(b.expectedGenus);
      const pocket = b.frame.features.find((f): f is PocketFeature => f.kind === 'pocket')!;
      const flatPocket = flat.features.find((f): f is PocketFeature => f.kind === 'pocket')!;
      const lift = dome(b.frame, pocket.placed.x, pocket.placed.y) - b.frame.frontZ;
      expect(lift).toBeGreaterThan(0.5);
      expect(pocket.floorZ).toBeCloseTo(flatPocket.floorZ + lift, 9);
      const [px, py] = plainFloorPoint(pocket);
      expect(Math.abs(topOfIntersection(b.manifold, column(kit, px, py, -1, 40)) - pocket.floorZ)).toBeLessThan(0.05);
      return null;
    });
  });

  it('never lowers a floor when the face dips below frontZ', () => {
    withScope(() => {
      const { frame, ctx } = prepareCover(kit, presetConfig('ch-sd-1x1'));
      const dip = { ...style, surfaceZ: () => frame.frontZ - 2 } as AnyCoverStyle;
      expect(placeFeaturesOnFace(frame, dip, ctx).features).toEqual(frame.features);
      return null;
    });
  });
});

describe('style registry', () => {
  it('registers box and minimal', () => {
    expect(listStyles().map((s) => s.id)).toEqual(expect.arrayContaining(['box', 'minimal']));
    expect(getStyle('box')?.printOrientation).toBe('faceDown');
    expect(resolveStyle('box').warnings).toEqual([]);
  });

  it('parses params with defaults and tolerates garbage', () => {
    const box = getStyle('box')!;
    expect(parseStyleParams(box, {}).params).toEqual({});
    expect(parseStyleParams(box, 'garbage').warnings[0].code).toBe('style-params-invalid');
  });
});
