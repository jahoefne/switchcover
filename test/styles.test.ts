/**
 * Styles (organic, faceted, stepped) against every preset frame: outer bodies, decorations,
 * shells and edge profiles, plus full covers through buildCover. Probes use thin prisms
 * intersected with the body.
 */
import type { Manifold } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { listPresets, presetConfig } from '../src/config/presets';
import type { CoverConfig } from '../src/config/schema';
import { buildCover } from '../src/geometry/buildCover';
import type { CoverFrame, EdgeProfile, Kit, Placed, StyleCtx } from '../src/geometry/contract';
import { OVERSHOOT, liveObjectCount, withScope, type Walls } from '../src/geometry/kit';
import { insideDistance, offsetPlaced, outlineWorld, placedDistance } from '../src/geometry/shape2d';
import { outerPlaced, resolveLayout } from '../src/layout/resolve';
import { getStyle, listStyles, stylePrintOrientation, type AnyCoverStyle } from '../src/styles';
import { availableEdgeRoom, bodyPlaced, edgeWidth, type EdgeWants } from '../src/styles/common/frame';
import { domeEnvelope } from '../src/styles/organic/dome';
import { bevelInset, facetedBody, facetedFullEdges } from '../src/styles/faceted';
import { filletInset, organicBody, organicFullEdges, type OrganicParams } from '../src/styles/organic';
import { steppedBody, steppedFullEdges, tierInset, type SteppedParams } from '../src/styles/stepped';
import { getKit } from './helpers/manifold';

type Params = Record<string, unknown>;
type BodyFn = (c: StyleCtx<Params>, walls: Walls) => Manifold;

interface Spec {
  id: string;
  defaults: Params;
  orientation: 'faceDown' | 'faceUp';
  /** The style's body builder (outer body with NO_WALLS, inner surface with walls). */
  body: BodyFn;
  /** Param sets run on every preset (defaults first). */
  variants: Params[];
  /** Extreme param sets run on a few presets. */
  extremes: Params[];
  /** Plateau where features sit (for edge-room checks). */
  plateau(frame: CoverFrame, p: Params): Placed;
  /** Full-size edge profiles (what the style draws when the resolver left room). */
  full(p: Params): { opening: EdgeProfile; pocket: EdgeProfile };
}

const SPECS: Spec[] = [
  {
    id: 'organic',
    defaults: { cornerR: 14, edgeR: 8, domeSag: 0, flareR: 6 },
    orientation: 'faceDown',
    body: organicBody as unknown as BodyFn,
    variants: [{}, { domeSag: 3 }],
    extremes: [
      { cornerR: 4, edgeR: 2, domeSag: 0.5, flareR: 0 },
      { cornerR: 30, edgeR: 14, domeSag: 3, flareR: 12 },
      { cornerR: 4, edgeR: 14, domeSag: 1.5, flareR: 1 }, // edgeR > cornerR (sharp plateau corners)
    ],
    plateau: (frame, p) => offsetPlaced(bodyPlaced(frame, p.cornerR as number), -(p.edgeR as number)),
    full: (p) => organicFullEdges(p as OrganicParams),
  },
  {
    id: 'faceted',
    defaults: { bevelW: 7, bevelAngleDeg: 45, groove: true, grooveW: 1, grooveD: 0.8, cornerR: 3 },
    orientation: 'faceDown',
    body: facetedBody as unknown as BodyFn,
    variants: [{}, { bevelAngleDeg: 25, groove: false, cornerR: 0 }],
    extremes: [
      { bevelW: 3, bevelAngleDeg: 60, grooveW: 3, grooveD: 2, cornerR: 20 },
      { bevelW: 15, bevelAngleDeg: 60, grooveW: 0.6, grooveD: 0.3, cornerR: 0 },
      { bevelW: 15, bevelAngleDeg: 25, groove: false, cornerR: 10 },
    ],
    plateau: (frame, p) =>
      offsetPlaced(
        bodyPlaced(frame, p.cornerR as number),
        -((p.bevelW as number) + (p.groove ? 1.5 + (p.grooveW as number) : 0)),
      ),
    full: () => facetedFullEdges(),
  },
  {
    id: 'stepped',
    defaults: { tiers: 2, stepH: 2.5, stepInset: 5, cornerR: 6 },
    orientation: 'faceUp',
    body: steppedBody as unknown as BodyFn,
    variants: [{}, { tiers: 3 }],
    extremes: [
      { tiers: 3, stepH: 5, stepInset: 12, cornerR: 20 },
      { tiers: 3, stepH: 1, stepInset: 2, cornerR: 0 },
      { tiers: 2, stepH: 5, stepInset: 2, cornerR: 3 },
    ],
    plateau: (frame, p) =>
      offsetPlaced(bodyPlaced(frame, p.cornerR as number), -((p.tiers as number) - 1) * (p.stepInset as number)),
    full: () => steppedFullEdges(),
  },
];

const PRESET_IDS = listPresets().map((p) => p.id);
const EXTREME_PRESETS = ['ch-sd-1x1', 'ch-sd-1x2v-switch-socket', 'ch-sd-2x2', 'de-2x1h'];

let kit: Kit;
beforeAll(async () => {
  kit = await getKit('preview');
});

// --- helpers -----------------------------------------------------------------------------

const circle = (d: number, x = 0, y = 0): Placed => ({ shape: { kind: 'circle', d }, x, y, rotDeg: 0 });
const stadium = (w: number, h: number, x = 0, y = 0): Placed => ({ shape: { kind: 'stadium', w, h }, x, y, rotDeg: 0 });

function plateOf(cfg: CoverConfig): CoverFrame['plate'] {
  return { w: cfg.plate.w, h: cfg.plate.h, protrusion: cfg.plate.depth, cornerR: cfg.plate.cornerR, clearance: cfg.cover.clearance };
}

function styleOf(id: string): AnyCoverStyle {
  const s = getStyle(id);
  if (!s) throw new Error(`style ${id} not registered`);
  return s;
}

function setup(spec: Spec, presetId: string, variant: Params) {
  const style = styleOf(spec.id);
  const cfg = presetConfig(presetId);
  const params = style.params.parse(variant) as Params;
  const frame = resolveLayout(cfg, { limits: style.limits(params, plateOf(cfg)), allowsNotchInEdge: style.allowsNotchInEdge });
  return { style, cfg, params, frame, ctx: { frame, params, kit } as StyleCtx<Params> };
}

/** Highest material point of `m` in a thin column at (x, y) (−Infinity if none). */
function columnTop(m: Manifold, x: number, y: number, zMax: number): number {
  const hit = m.intersect(kit.prism(circle(0.3, x, y), -1, zMax));
  return hit.isEmpty() ? -Infinity : hit.boundingBox().max[2];
}

const roundedRectArea = (p: Placed) => {
  if (p.shape.kind !== 'roundedRect') throw new Error('rounded rect expected');
  const r = Math.min(p.shape.r, Math.min(p.shape.w, p.shape.h) / 2);
  return p.shape.w * p.shape.h - (4 - Math.PI) * r * r;
};

/** surfaceZ sampled over the outline (grid) and at every feature centre. */
function surfaceSamples(style: AnyCoverStyle, ctx: StyleCtx<Params>): Array<[number, number, number]> {
  const { w, h, cx, cy } = ctx.frame.outer;
  const outline = outerPlaced(ctx.frame);
  const pts: Array<[number, number]> = ctx.frame.features.map((f) => [f.placed.x, f.placed.y]);
  const n = 41;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = cx - w / 2 + (w * i) / (n - 1);
      const y = cy - h / 2 + (h * j) / (n - 1);
      if (insideDistance(outline, [x, y]) > 0) pts.push([x, y]);
    }
  return pts.map(([x, y]) => [x, y, style.surfaceZ(ctx, x, y)]);
}

function edgesOf(style: AnyCoverStyle, ctx: StyleCtx<Params>): EdgeProfile[] {
  return ctx.frame.features.flatMap((f) => {
    if (f.kind === 'opening') return [style.openingEdge(ctx, f)];
    return style.pocketEdge ? [style.pocketEdge(ctx, f)] : [];
  });
}

const wantsOf = (lim: { edgeAllowance?: number; pocketEdgeAllowance?: number }): EdgeWants => ({
  opening: lim.edgeAllowance ?? 0,
  pocket: lim.pocketEdgeAllowance ?? lim.edgeAllowance ?? 0,
});

// --- pure helpers --------------------------------------------------------------------------

describe('common helpers', () => {
  it('insideDistance is exact for rounded rects and circles', () => {
    const rr: Placed = { shape: { kind: 'roundedRect', w: 40, h: 20, r: 5 }, x: 1, y: 2, rotDeg: 0 };
    expect(insideDistance(rr, [1, 2])).toBeCloseTo(10, 9);
    expect(insideDistance(rr, [21, 2])).toBeCloseTo(0, 9);
    expect(insideDistance(rr, [16, 7])).toBeCloseTo(5, 9); // corner centre
    expect(insideDistance(rr, [16 + 5 / Math.SQRT2, 7 + 5 / Math.SQRT2])).toBeCloseTo(0, 9);
    expect(insideDistance(rr, [1, 15])).toBeCloseTo(-3, 9);
    expect(insideDistance(circle(10, 3, 0), [3, 0])).toBeCloseTo(5, 9);
  });

  it('domeEnvelope is concave, ≥ (1−u²)(1−v²), equal to it near the middle, 0 on the boundary', () => {
    const f = (u: number, v: number) => (1 - u * u) * (1 - v * v);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let k = 0; k < 20000; k++) {
      const p = [rnd(), rnd()];
      const q = [rnd(), rnd()];
      const mid = domeEnvelope((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      expect(mid).toBeGreaterThanOrEqual((domeEnvelope(p[0], p[1]) + domeEnvelope(q[0], q[1])) / 2 - 1e-12);
      expect(domeEnvelope(p[0], p[1])).toBeGreaterThanOrEqual(f(p[0], p[1]) - 1e-12);
    }
    expect(domeEnvelope(0, 0)).toBe(1);
    expect(domeEnvelope(0.3, -0.2)).toBeCloseTo(f(0.3, 0.2), 12);
    expect(domeEnvelope(1, 0.3)).toBe(0);
    expect(domeEnvelope(-0.4, 1.2)).toBe(0);
    expect(domeEnvelope(0.8, 0.8)).toBeCloseTo(0.237, 3); // tangent cone from the corner
  });
});

// --- per style -----------------------------------------------------------------------------

describe.each(SPECS.map((s) => [s.id, s] as const))('%s style', (id, spec) => {
  it('is registered with metadata, defaults and ui ranges inside the schema', () => {
    const style = styleOf(id);
    expect(listStyles()).toContain(style);
    expect(style.version).toBe(1);
    expect(style.label.length).toBeGreaterThan(0);
    expect(style.description.length).toBeGreaterThan(20);
    expect(style.printHint.length).toBeGreaterThan(20);
    expect(stylePrintOrientation(style, spec.defaults)).toBe(spec.orientation);
    expect(style.params.parse({})).toEqual(spec.defaults);
    const keys = Object.keys(style.params.shape);
    expect(Object.keys(spec.defaults).sort()).toEqual([...keys].sort());
    for (const [key, meta] of Object.entries(style.ui ?? {})) {
      expect(keys).toContain(key);
      if (!meta) continue;
      if (meta.kind === 'boolean') {
        expect(typeof spec.defaults[key], `${key} is a boolean param`).toBe('boolean');
        continue;
      }
      expect(meta.min).toBeLessThan(meta.max);
      expect(meta.step).toBeGreaterThan(0);
      expect(style.params.safeParse({ [key]: meta.min }).success, `${key} min`).toBe(true);
      expect(style.params.safeParse({ [key]: meta.max }).success, `${key} max`).toBe(true);
      const d = spec.defaults[key];
      if (typeof d === 'number') {
        expect(d).toBeGreaterThanOrEqual(meta.min);
        expect(d).toBeLessThanOrEqual(meta.max);
      }
    }
  });

  it('limits are finite and honoured by resolveLayout', () => {
    const style = styleOf(id);
    for (const variant of [...spec.variants, ...spec.extremes]) {
      const params = style.params.parse(variant) as Params;
      const cfg = presetConfig('ch-sd-1x1');
      const lim = style.limits(params, plateOf(cfg));
      expect(Number.isFinite(lim.minFrame) && lim.minFrame > 0).toBe(true);
      expect(Number.isFinite(lim.minFrontZ) && lim.minFrontZ > 0).toBe(true);
      expect(Number.isFinite(lim.maxEdgeR) && lim.maxEdgeR >= 0).toBe(true);
      // the allowances are the full-size edge widths (so the resolver leaves room for them)
      const full = spec.full(params);
      expect(lim.edgeAllowance).toBeCloseTo(edgeWidth(full.opening), 9);
      expect(lim.pocketEdgeAllowance).toBeCloseTo(edgeWidth(full.pocket), 9);
      expect(lim.cornerR).toBe(params.cornerR);
      expect(typeof lim.edgeInset).toBe('function');
      const frame = resolveLayout(cfg, { limits: lim, allowsNotchInEdge: style.allowsNotchInEdge });
      expect(frame.frontZ).toBeGreaterThanOrEqual(lim.minFrontZ - 1e-9);
      // the resolver's corner radius reaches the style's (body corners never cut the cavity)
      if (typeof params.cornerR === 'number') expect(frame.outer.cornerR).toBeGreaterThanOrEqual(params.cornerR - 1e-9);
    }
  });

  const cases = spec.variants.flatMap((v) => PRESET_IDS.map((p) => [p, JSON.stringify(v), v] as const));
  it.each(cases)('%s %s: outer body, probes, edges, decorations, shell', (presetId, _label, variant) => {
    const before = liveObjectCount();
    withScope(() => {
      const { style, cfg, params, frame, ctx } = setup(spec, presetId, variant);
      const { w, h, cx, cy } = frame.outer;
      const body = style.outerBody(ctx);

      // validity, single component, flat base at 0, bbox = frame outline
      expect(body.status()).toBe('NoError');
      expect(body.isEmpty()).toBe(false);
      expect(body.decompose().length).toBe(1);
      expect(body.genus()).toBe(0);
      const box = body.boundingBox();
      expect(Math.abs(box.min[2])).toBeLessThanOrEqual(1e-6);
      for (const [got, want] of [
        [box.min[0], cx - w / 2],
        [box.max[0], cx + w / 2],
        [box.min[1], cy - h / 2],
        [box.max[1], cy + h / 2],
      ])
        expect(Math.abs(got - want)).toBeLessThanOrEqual(0.05);

      // top = max surfaceZ
      const samples = surfaceSamples(style, ctx);
      const maxSurface = Math.max(...samples.map((s) => s[2]));
      expect(Math.abs(box.max[2] - maxSurface)).toBeLessThanOrEqual(0.2);
      expect(Math.min(...samples.map((s) => s[2]))).toBeGreaterThan(0);

      // features sit in solid material
      for (const f of frame.features) {
        const col = kit.prism(circle(2, f.placed.x, f.placed.y), 0.1, frame.frontZ - 0.5);
        expect(col.subtract(body).volume(), `column at ${f.id}`).toBeLessThan(1e-6);
        // the face at the feature is where surfaceZ says
        const top = columnTop(body, f.placed.x, f.placed.y, frame.frontZ + 10);
        expect(Math.abs(top - style.surfaceZ(ctx, f.placed.x, f.placed.y)), `surface at ${f.id}`).toBeLessThanOrEqual(0.2);
      }

      // the base is the full outline
      const base = body.slice(0.01).area();
      const bodyArea = roundedRectArea(bodyPlaced(frame, params.cornerR as number));
      expect(Math.abs(base - bodyArea) / bodyArea).toBeLessThanOrEqual(0.02);
      expect(base).toBeGreaterThanOrEqual(roundedRectArea(outerPlaced(frame)) * 0.995);

      // edge profiles: within the room they have, accepted by the kit
      const plateau = spec.plateau(frame, params);
      const wants = wantsOf(style.limits(params, plateOf(cfg)));
      for (const f of frame.features) {
        const e = f.kind === 'opening' ? style.openingEdge(ctx, f) : style.pocketEdge?.(ctx, f);
        if (!e) continue;
        expect(edgeWidth(e)).toBeGreaterThanOrEqual(0);
        expect(edgeWidth(e)).toBeLessThanOrEqual(availableEdgeRoom(frame, f, plateau, wants) + 1e-9);
      }
      for (const e of edgesOf(style, ctx)) {
        for (const p of [circle(46, 0, 0), stadium(40.6, 70.6, 0, 0)]) {
          const t = kit.edgeTool(p, frame.frontZ, e, frame.frontZ - cfg.plate.depth);
          expect(t.status()).toBe('NoError');
          expect(t.isEmpty()).toBe(false);
        }
      }

      // decorations
      const dec = style.decorate?.(ctx) ?? {};
      if (dec.add) {
        expect(dec.add.status()).toBe('NoError');
        expect(dec.add.subtract(body).volume()).toBeLessThan(1e-3);
      }
      if (dec.subtract) {
        expect(dec.subtract.status()).toBe('NoError');
        expect(dec.subtract.isEmpty()).toBe(false);
        const sb = dec.subtract.boundingBox();
        expect(sb.min[0]).toBeGreaterThan(cx - w / 2);
        expect(sb.max[0]).toBeLessThan(cx + w / 2);
        expect(sb.max[2]).toBeLessThanOrEqual(frame.frontZ + OVERSHOOT + 1e-6);
        expect(dec.subtract.intersect(body).volume()).toBeGreaterThan(0);
        // a decoration cut (groove, notch breakout) never breaks into the hollow: it stays out of
        // the body offset inward by the full walls
        const hollowBody = spec.body(ctx, { side: frame.skirtT, top: frame.skinT });
        expect(dec.subtract.intersect(hollowBody).volume()).toBeLessThan(1e-6);
      }

      // shell: body − stub cavity + fill keeps ≥ 0.9 × the nominal walls everywhere
      const cavity = kit.prism(outerPlaced(frame, frame.skirtT), -OVERSHOOT, frame.frontZ - frame.skinT);
      let shell = body.subtract(cavity);
      if (dec.add) shell = shell.add(dec.add);
      expect(shell.status()).toBe('NoError');
      expect(shell.decompose().length).toBe(1);
      expect(shell.genus()).toBe(0);
      const inner = spec.body(ctx, { side: 0.9 * frame.skirtT, top: 0.9 * frame.skinT });
      const missing = body.subtract(inner).subtract(shell).volume();
      expect(missing, 'wall material missing under the styled edge').toBeLessThan(0.5);
      // the plate + clearance and the rocker gap above it stay clear
      const c = cfg.cover.clearance;
      const plateBox = kit.prism(
        { shape: { kind: 'roundedRect', w: cfg.plate.w + 2 * c, h: cfg.plate.h + 2 * c, r: cfg.plate.cornerR + c }, x: 0, y: 0, rotDeg: 0 },
        0,
        cfg.plate.depth + cfg.cover.rockerGap,
      );
      expect(plateBox.intersect(shell).volume()).toBeLessThan(1e-6);
      if (dec.subtract) {
        const cut = shell.subtract(dec.subtract);
        expect(cut.status()).toBe('NoError');
        expect(cut.decompose().length).toBe(1);
      }
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });

  const extremeCases = spec.extremes.flatMap((v) => EXTREME_PRESETS.map((p) => [p, JSON.stringify(v), v] as const));
  it.each(extremeCases)('%s %s: extreme params stay valid', (presetId, _label, variant) => {
    withScope(() => {
      const { style, frame, ctx } = setup(spec, presetId, variant);
      const body = style.outerBody(ctx);
      expect(body.status()).toBe('NoError');
      expect(body.decompose().length).toBe(1);
      expect(Math.abs(body.boundingBox().min[2])).toBeLessThanOrEqual(1e-6);
      const maxSurface = Math.max(...surfaceSamples(style, ctx).map((s) => s[2]));
      expect(Math.abs(body.boundingBox().max[2] - maxSurface)).toBeLessThanOrEqual(0.2);
      const dec = style.decorate?.(ctx) ?? {};
      const cavity = kit.prism(outerPlaced(frame, frame.skirtT), -OVERSHOOT, frame.frontZ - frame.skinT);
      let shell = body.subtract(cavity);
      if (dec.add) shell = shell.add(dec.add);
      if (dec.subtract) shell = shell.subtract(dec.subtract);
      expect(shell.status()).toBe('NoError');
      expect(shell.decompose().length).toBe(1);
      for (const e of edgesOf(style, ctx)) expect(kit.edgeTool(circle(46), frame.frontZ, e, 10).status()).toBe('NoError');
      return null;
    });
  });

  it.each(PRESET_IDS)('%s: stub buildCover succeeds', (presetId) => {
    const before = liveObjectCount();
    withScope(() => {
      const cfg = presetConfig(presetId);
      cfg.cover.style = id;
      const { manifold, frame, style } = buildCover(kit, cfg);
      expect(style.id).toBe(id);
      expect(frame.warnings.map((w) => w.code)).not.toContain('style-unknown');
      expect(manifold.status()).toBe('NoError');
      expect(manifold.isEmpty()).toBe(false);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });
});

// --- organic specifics -------------------------------------------------------------------

describe('organic dome', () => {
  const spec = SPECS.find((s) => s.id === 'organic')!;
  it.each(['ch-sd-1x1', 'ch-sd-2x1h-two-switches', 'ch-sd-2x2'])('%s: the hull follows surfaceZ over the plateau', (presetId) => {
    withScope(() => {
      const { style, params, frame, ctx } = setup(spec, presetId, { domeSag: 3 });
      const body = style.outerBody(ctx);
      const plateau = offsetPlaced(bodyPlaced(frame, params.cornerR as number), -(params.edgeR as number) - 1);
      const pts = outlineWorld(offsetPlaced(plateau, -2), 0, 16).map(([x, y]) => [x, y] as [number, number]);
      const { w, h, cx, cy } = frame.outer;
      for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) pts.push([cx - w / 2 + (w * i) / 8, cy - h / 2 + (h * j) / 8]);
      let worst = 0;
      for (const [x, y] of pts) {
        if (insideDistance(plateau, [x, y]) <= 0) continue;
        const top = columnTop(body, x, y, frame.frontZ + 10);
        const s = style.surfaceZ(ctx, x, y);
        worst = Math.max(worst, Math.abs(top - s));
        expect(top - s, `(${x.toFixed(1)}, ${y.toFixed(1)})`).toBeLessThanOrEqual(0.1); // never above surfaceZ
        expect(top - s, `(${x.toFixed(1)}, ${y.toFixed(1)})`).toBeGreaterThanOrEqual(-0.2);
      }
      // the apex sits on the cover's centre (which may be off the plate centre)
      expect(style.surfaceZ(ctx, cx, cy)).toBeCloseTo(frame.frontZ + 3, 9);
      expect(style.surfaceZ(ctx, cx + w / 2 + 5, cy)).toBe(frame.frontZ);
      expect(worst).toBeLessThan(0.2);
      return null;
    });
  });

  it('prints face down with a flat face and face up as soon as the face is domed', () => {
    const style = styleOf('organic');
    expect(typeof style.printOrientation).toBe('function');
    expect(stylePrintOrientation(style, style.params.parse({}) as Params)).toBe('faceDown');
    expect(stylePrintOrientation(style, style.params.parse({ domeSag: 0.1 }) as Params)).toBe('faceUp');
    expect(stylePrintOrientation(style, style.params.parse({ domeSag: 3 }) as Params)).toBe('faceUp');
    // the static form stays valid for the other styles
    for (const id of ['minimal', 'faceted', 'stepped', 'box']) expect(typeof styleOf(id).printOrientation).toBe('string');
  });

  it('flat face without a dome; both sockets get the full flare (the pocket is spread for it)', () => {
    withScope(() => {
      const { style, frame, ctx } = setup(spec, 'ch-sd-1x3v-switch-two-sockets', {});
      expect(style.surfaceZ(ctx, 0, 0)).toBe(frame.frontZ);
      const outlets = frame.features.filter((f) => f.kind === 'opening');
      const [upper, lower] = [...outlets].sort((a, b) => b.placed.y - a.placed.y);
      expect(style.openingEdge(ctx, upper)).toEqual({ kind: 'flare', r: 6, depth: 6 });
      expect(style.openingEdge(ctx, lower)).toEqual({ kind: 'flare', r: 6, depth: 6 });
      const pocket = frame.features.find((f) => f.kind === 'pocket')!;
      expect(placedDistance(pocket.placed, upper.placed)).toBeCloseTo(frame.minWall + 6 + 1.5, 6);
      return null;
    });
  });

  it('safety net: sockets pushed together (outlets never move) share the room, flare → fillet', () => {
    withScope(() => {
      const style = styleOf('organic');
      const cfg = presetConfig('ch-sd-1x3v-switch-two-sockets');
      const params = style.params.parse({}) as Params;
      const lim = style.limits(params, plateOf(cfg));
      for (const [dy, kind, width] of [
        [6, 'flare', 3], // 14 − 6 = 8 mm apart: (8 − 2) / 2 each
        [9.5, 'fillet', 1.25], // 4.5 mm apart: 1.25 each, too narrow for a flare
      ] as const) {
        cfg.modules[2].dy = dy; // the bottom socket moves up towards the middle one
        const frame = resolveLayout(cfg, { limits: lim, allowsNotchInEdge: style.allowsNotchInEdge });
        expect(frame.warnings.map((w) => w.code)).toContain('edge-reduced');
        const ctx = { frame, params, kit } as StyleCtx<Params>;
        const [upper, lower] = frame.features.filter((f) => f.kind === 'opening').sort((a, b) => b.placed.y - a.placed.y);
        const eu = style.openingEdge(ctx, upper);
        const el = style.openingEdge(ctx, lower);
        expect(eu.kind).toBe(kind);
        expect(edgeWidth(eu)).toBeCloseTo(width, 5);
        expect(edgeWidth(el)).toBeCloseTo(width, 5);
        // the two edges never eat into the minimum wall between them
        expect(edgeWidth(eu) + edgeWidth(el)).toBeLessThanOrEqual(placedDistance(upper.placed, lower.placed) - frame.minWall + 1e-6);
        // the pocket above keeps its full fillet (it was spread for the upper socket's flare)
        expect(style.pocketEdge!(ctx, frame.features.find((f) => f.kind === 'pocket')!)).toEqual({ kind: 'fillet', r: 1.5 });
      }
      return null;
    });
  });
});

// --- full-size edges in the shipped presets -------------------------------------------------

describe('full-size edges in every Swiss preset (the resolver leaves room, nothing shrinks)', () => {
  const swiss = PRESET_IDS.filter((id) => id.startsWith('ch-sd-'));
  const cases = SPECS.flatMap((spec) => swiss.map((id) => [spec.id, id, spec] as const));
  it.each(cases)('%s × %s', (_styleId, presetId, spec) => {
    const { style, cfg, params, frame, ctx } = setup(spec, presetId, {});
    const full = spec.full(params);
    const wants = wantsOf(style.limits(params, plateOf(cfg)));
    const plateau = spec.plateau(frame, params);
    expect(frame.warnings.map((w) => w.code)).not.toContain('edge-reduced');
    for (const f of frame.features) {
      if (f.kind === 'opening') {
        expect(style.openingEdge(ctx, f), `${f.id} opening edge`).toEqual(full.opening);
        expect(availableEdgeRoom(frame, f, plateau, wants)).toBeGreaterThanOrEqual(edgeWidth(full.opening));
      } else {
        expect(style.pocketEdge?.(ctx, f), `${f.id} pocket edge`).toEqual(full.pocket);
        expect(availableEdgeRoom(frame, f, plateau, wants)).toBeGreaterThanOrEqual(edgeWidth(full.pocket));
      }
    }
  });
});

describe('edge profiles inverted (edgeInset)', () => {
  it('fillet, bevel and tiers: the drop at the returned inset is within the budget, and tight', () => {
    const filletDrop = (r: number, d: number) => (d >= r ? 0 : r - Math.sqrt(r * r - (r - d) * (r - d)));
    for (const r of [2, 8, 14])
      for (const b of [0.5, 2, 6, 20]) {
        const d = filletInset(r, b);
        expect(filletDrop(r, d)).toBeLessThanOrEqual(b + 1e-9);
        if (d > 1e-9) expect(filletDrop(r, d - 1e-3)).toBeGreaterThan(b);
      }
    expect(filletInset(8, -1)).toBe(8);
    expect(bevelInset(7, 45, 6)).toBeCloseTo(1, 9);
    expect(bevelInset(15, 60, 9.58)).toBeCloseTo(15 - 9.58 / Math.tan(Math.PI / 3), 9);
    expect(bevelInset(7, 45, 20)).toBe(0);
    expect(bevelInset(7, 45, -2)).toBe(7);
    const p = (tiers: number): SteppedParams => ({ tiers, stepH: 5, stepInset: 12, cornerR: 6 });
    expect(tierInset(p(3), 6)).toBe(12); // tier 0 is 10 below the face, tier 1 is 5
    expect(tierInset(p(3), 10)).toBe(0);
    expect(tierInset(p(2), 4)).toBe(12);
  });

  it.each([
    ['faceted', { bevelW: 15, bevelAngleDeg: 60 }],
    ['stepped', { tiers: 3, stepH: 5, stepInset: 12 }],
    ['organic', { edgeR: 14, cornerR: 14 }],
  ] as const)('%s %j: deep edges keep clear of the plate box', (id, variant) => {
    withScope(() => {
      const spec = SPECS.find((s) => s.id === id)!;
      for (const presetId of ['ch-sd-1x1', 'ch-sd-1x2v-switch-socket']) {
        const { style, cfg, frame, ctx } = setup(spec, presetId, variant);
        const body = style.outerBody(ctx);
        const dec = style.decorate?.(ctx) ?? {};
        const cavity = kit.prism(outerPlaced(frame, frame.skirtT), -OVERSHOOT, frame.frontZ - frame.skinT);
        let shell = body.subtract(cavity);
        if (dec.add) shell = shell.add(dec.add);
        const c = cfg.cover.clearance;
        const plateBox = kit.prism(
          { shape: { kind: 'roundedRect', w: cfg.plate.w + 2 * c, h: cfg.plate.h + 2 * c, r: cfg.plate.cornerR + c }, x: 0, y: 0, rotDeg: 0 },
          0,
          cfg.plate.depth + cfg.cover.rockerGap,
        );
        expect(plateBox.intersect(shell).volume(), presetId).toBeLessThan(1e-6);
        // and the face above the plate keeps a real wall (≥ the skin, vertically)
        const zClear = cfg.plate.depth + cfg.cover.rockerGap;
        const edge = cfg.plate.w / 2 + c - 0.05;
        const top = columnTop(body, edge, 0, frame.frontZ + 10);
        expect(top - zClear, presetId).toBeGreaterThanOrEqual(frame.skinT - 1e-6);
      }
      return null;
    });
  });
});

// --- timing ----------------------------------------------------------------------------------

describe('timing (largest preset)', () => {
  const largest = [...PRESET_IDS].sort((a, b) => {
    const area = (id: string) => {
      const f = resolveLayout(presetConfig(id));
      return f.outer.w * f.outer.h;
    };
    return area(b) - area(a);
  })[0];

  it.each(SPECS.map((s) => [s.id, s] as const))(`%s on ${largest}`, async (_id, spec) => {
    for (const quality of ['preview', 'export'] as const) {
      const qk = await getKit(quality);
      withScope(() => {
        const style = styleOf(spec.id);
        const cfg = presetConfig(largest);
        cfg.cover.style = spec.id;
        for (const variant of spec.variants) {
          const params = style.params.parse(variant) as Params;
          const frame = resolveLayout(cfg, { limits: style.limits(params, plateOf(cfg)), allowsNotchInEdge: style.allowsNotchInEdge });
          const ctx = { frame, params, kit: qk };
          const t0 = performance.now();
          const body = style.outerBody(ctx);
          const t1 = performance.now();
          const dec = style.decorate?.(ctx) ?? {};
          const t2 = performance.now();
          cfg.cover.styleParams = variant;
          const built = buildCover(qk, cfg).manifold;
          const t3 = performance.now();
          console.log(
            `[timing] ${spec.id} ${JSON.stringify(variant)} ${largest} ${quality}: outerBody ${(t1 - t0).toFixed(1)} ms / ${body.numTri()} tris; ` +
              `decorate ${(t2 - t1).toFixed(1)} ms (add ${dec.add?.numTri() ?? 0}, subtract ${dec.subtract?.numTri() ?? 0} tris); ` +
              `stub build ${(t3 - t2).toFixed(1)} ms / ${built.numTri()} tris`,
          );
          expect(body.status()).toBe('NoError');
          expect(built.status()).toBe('NoError');
          // the decorated shell is valid at this quality too
          const cavity = qk.prism(outerPlaced(frame, frame.skirtT), -OVERSHOOT, frame.frontZ - frame.skinT);
          let shell = body.subtract(cavity);
          if (dec.add) shell = shell.add(dec.add);
          if (dec.subtract) shell = shell.subtract(dec.subtract);
          expect(shell.status()).toBe('NoError');
          expect(shell.decompose().length).toBe(1);
          expect(shell.genus()).toBe(0);
        }
        return null;
      });
    }
  });
});
