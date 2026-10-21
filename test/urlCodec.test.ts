import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { getPreset, listPresets, presetConfig } from '../src/config/presets';
import { CoverConfigSchema, DEFAULT_CONFIG, type CoverConfig, type ModuleConfig } from '../src/config/schema';
import { HASH_PREFIX, decodeHash, encodeHash, roundDeep } from '../src/config/urlCodec';
import { V1_HASH_FIXTURES, V1_SWITCH_SOCKET_MIGRATED, V1_SWITCH_SOCKET_RAW } from './fixtures/v1Hashes';
import { V2_HASH_FIXTURES, V2_SWITCH_SOCKET_EXPECTED } from './fixtures/v2Hashes';

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perturb(base: CoverConfig, rand: () => number): CoverConfig {
  const c = structuredClone(base);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  c.plate.w = between(40, 300);
  c.plate.h = between(40, 300);
  c.plate.depth = between(0, 30);
  c.plate.cornerR = between(0, 10);
  c.grid.pitchX = between(40, 90);
  c.grid.pitchY = between(40, 90);
  c.grid.offsetX = rand() < 0.5 ? 0 : between(-20, 20);
  c.grid.offsetY = rand() < 0.5 ? 0 : between(-20, 20);
  c.cover.skinT = between(1, 5);
  c.cover.skirtT = between(1, 5);
  c.cover.margin = between(0, 10);
  c.cover.size = rand() < 0.5 ? 'auto' : { w: between(50, 400), h: between(50, 400) };
  c.cover.styleParams = { sag: between(0, 3), label: 'x' };
  c.bilresa.pocketDepth = between(8.5, 14);
  c.bilresa.stripLedge = between(0, 10);
  c.bilresa.floorT = between(1, 4);
  c.bilresa.notch = { enabled: rand() < 0.5, d: between(8, 20) };
  c.bilresa.strip = { ...c.bilresa.strip, l: between(20, 60), w: between(3, 12), protrusion: between(0, 2), dx: between(-3, 3), dy: between(-5, 5) };
  c.print.tolerance = between(0, 0.5);
  c.print.orientation = pick(['style', 'faceDown', 'faceUp'] as const);
  c.modules = c.modules.map((m): ModuleConfig => {
    const role = pick(['bilresa', 'outlet', 'blank', 'passthrough'] as const);
    const out: ModuleConfig = { col: m.col, row: m.row, role, rot: pick([0, 90, 180, 270] as const), dx: between(-20, 20), dy: between(-20, 20) };
    if (role === 'bilresa') out.bilresa = { variant: pick(['2button', 'wheel'] as const), ...(rand() < 0.5 ? { pocketDepth: between(8.5, 12) } : {}) };
    if (role === 'outlet' || role === 'passthrough') {
      out.opening = rand() < 0.5 ? { shape: 'circle', d: between(20, 60) } : { shape: 'roundedRect', w: between(20, 60), h: between(20, 60), cornerR: between(0, 8) };
    }
    return out;
  });
  return CoverConfigSchema.parse(c);
}

/**
 * A fixture's decoded config as it parses today: links written before grid.offsetX / offsetY
 * existed get both offsets as 0 (zod default), everything else is unchanged.
 */
const withGridOffsets = <T extends { grid: object }>(c: T) => ({ ...c, grid: { ...c.grid, offsetX: 0, offsetY: 0 } });

describe('urlCodec', () => {
  it.each(listPresets().map((p) => [p.id, p.config] as const))('round-trips preset %s', (_id, config) => {
    const hash = encodeHash(config);
    expect(hash.startsWith(HASH_PREFIX)).toBe(true);
    const { config: back, warnings } = decodeHash(hash);
    expect(warnings).toEqual([]);
    expect(back).toEqual(config);
  });

  it('round-trips 300 random perturbations (rounded to 0.01) and is idempotent', () => {
    const rand = rng(1234);
    const presets = listPresets();
    for (let i = 0; i < 300; i++) {
      const c = perturb(presets[i % presets.length].config, rand);
      const hash = encodeHash(c);
      const { config: back, warnings } = decodeHash(hash);
      expect(warnings, `iteration ${i}`).toEqual([]);
      expect(back, `iteration ${i}`).toEqual(roundDeep(c));
      expect(encodeHash(back)).toBe(hash);
    }
  });

  it('rounds numbers to 0.01 and normalises −0', () => {
    expect(roundDeep({ a: 1.23456, b: [-0.001, 2.005], c: 'x', d: true })).toEqual({ a: 1.23, b: [0, 2.01], c: 'x', d: true });
    expect(Object.is(roundDeep(-0.001), 0)).toBe(true);
  });

  it('accepts hashes with or without the leading #', () => {
    const c = presetConfig('ch-sd-2x2');
    expect(decodeHash(encodeHash(c).slice(1)).config).toEqual(c);
  });

  it('empty / missing hash → defaults without warnings', () => {
    for (const h of ['', '#', null, undefined]) {
      const r = decodeHash(h);
      expect(r.config).toEqual(DEFAULT_CONFIG);
      expect(r.warnings).toEqual([]);
    }
  });

  it.each([
    ['#garbage'],
    ['#v1.'],
    ['#v1.!!!not-lz!!!'],
    [HASH_PREFIX + LZString.compressToEncodedURIComponent('not json {')],
    [HASH_PREFIX + LZString.compressToEncodedURIComponent('[1,2,3]')],
    [HASH_PREFIX + LZString.compressToEncodedURIComponent('{"v":1,"plate":"nope"}')],
    ['#v9.abc'],
  ])('garbage hash %s → defaults + warning', (hash) => {
    const r = decodeHash(hash);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.every((w) => w.severity === 'warning')).toBe(true);
    if (r.warnings[0].code !== 'config-repaired') expect(r.config).toEqual(DEFAULT_CONFIG);
    expect(CoverConfigSchema.safeParse(r.config).success).toBe(true);
  });

  it('writes #v2. links', () => {
    expect(HASH_PREFIX).toBe('#v2.');
    expect(encodeHash(presetConfig('ch-sd-1x1')).startsWith('#v2.')).toBe(true);
  });

  it('committed v1 fixtures still decode, migrated to config v2', () => {
    // the fixture itself is untouched: its payload is still the v1 snapshot
    const payload = V1_HASH_FIXTURES['ch-sd-1x2v-switch-socket'].slice('#v1.'.length);
    expect(JSON.parse(LZString.decompressFromEncodedURIComponent(payload)!)).toEqual(V1_SWITCH_SOCKET_RAW);

    const a = decodeHash(V1_HASH_FIXTURES['ch-sd-1x2v-switch-socket']);
    expect(a.warnings).toEqual([]);
    expect(a.config).toEqual(withGridOffsets(V1_SWITCH_SOCKET_MIGRATED));
    // the layout part must still match today's preset
    const preset = getPreset('ch-sd-1x2v-switch-socket')!.config;
    expect({ plate: a.config.plate, grid: a.config.grid, modules: a.config.modules }).toEqual({
      plate: preset.plate,
      grid: preset.grid,
      modules: preset.modules,
    });

    const b = decodeHash(V1_HASH_FIXTURES['de-2x1h']);
    expect(b.warnings).toEqual([]);
    expect(b.config.v).toBe(2);
    expect(b.config.plate).toEqual(getPreset('de-2x1h')!.config.plate);
    expect(b.config.modules).toEqual(getPreset('de-2x1h')!.config.modules);
    expect(b.config.bilresa.strip).toEqual(getPreset('de-2x1h')!.config.bilresa.strip);
  });

  it('committed v2 fixtures decode to the expected presets', () => {
    const a = decodeHash(V2_HASH_FIXTURES['ch-sd-1x2v-switch-socket']);
    expect(a.warnings).toEqual([]);
    expect(a.config).toEqual(withGridOffsets(V2_SWITCH_SOCKET_EXPECTED));
    expect(a.config).toEqual(getPreset('ch-sd-1x2v-switch-socket')!.config);
  });

  it('links without grid offsets (every link before they existed) parse with offset 0, no warnings', () => {
    const payload = JSON.parse(LZString.decompressFromEncodedURIComponent(V2_HASH_FIXTURES['ch-sd-1x2v-switch-socket'].slice(4))!);
    expect(payload.grid).toEqual({ cols: 1, rows: 2, pitchX: 60, pitchY: 60 }); // the fixture predates the offsets
    const { config, warnings } = decodeHash(V2_HASH_FIXTURES['ch-sd-1x2v-switch-socket']);
    expect(warnings).toEqual([]);
    expect(config.grid).toEqual({ cols: 1, rows: 2, pitchX: 60, pitchY: 60, offsetX: 0, offsetY: 0 });
    // the schema alone fills them in too (zod default), so hand-built configs need not carry them
    const bare = { ...payload, grid: { cols: 1, rows: 2, pitchX: 60, pitchY: 60 } };
    expect(CoverConfigSchema.parse(bare).grid).toMatchObject({ offsetX: 0, offsetY: 0 });
  });

  it('round-trips grid offsets', () => {
    const c = presetConfig('ch-sd-1x2v-switch-socket');
    c.grid.offsetX = -4.25;
    c.grid.offsetY = 3.5;
    const back = decodeHash(encodeHash(c));
    expect(back.warnings).toEqual([]);
    expect(back.config.grid).toEqual({ ...c.grid });
  });
});
