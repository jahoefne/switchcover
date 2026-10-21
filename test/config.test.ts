import { describe, expect, it } from 'vitest';
import { BILRESA_VARIANTS, DEFAULT_BILRESA, DEFAULT_COVER, DEFAULT_PRINT } from '../src/config/defaults';
import { migrateConfig } from '../src/config/migrate';
import { DEFAULT_PRESET_ID, getPreset, listPresets, presetConfig } from '../src/config/presets';
import { CoverConfigSchema, DEFAULT_CONFIG, cloneConfig } from '../src/config/schema';

describe('defaults', () => {
  it('Bilresa variants match the measured STLs', () => {
    expect(BILRESA_VARIANTS['2button'].outline).toEqual({ kind: 'stadium', w: 40, h: 70 });
    expect(BILRESA_VARIANTS.wheel.outline).toEqual({ kind: 'stadium', w: 45, h: 70 });
    expect(BILRESA_VARIANTS['2button'].depth).toBe(19.5);
    expect(BILRESA_VARIANTS.wheel.depth).toBe(19.5);
  });

  it('uses the plan defaults for clearances and the placeholder strip', () => {
    expect(DEFAULT_BILRESA).toMatchObject({
      pocketDepth: 9,
      pocketClearance: 0.3,
      floorT: 2.2,
      hiddenMargin: 4,
      access: { w: 32, h: 56 },
      stripMargin: 3,
      strip: { shape: 'stadium', l: 44, w: 7, protrusion: 1, dx: 0, dy: 0 },
    });
    expect(DEFAULT_COVER).toMatchObject({ skinT: 3, skirtT: 2.4, minWall: 2, clearance: 1, rockerGap: 2, margin: 4 });
    expect(DEFAULT_PRINT.tolerance).toBe(0.2);
  });

  it('DEFAULT_CONFIG is the frozen ch-sd-1x1 preset', () => {
    expect(DEFAULT_CONFIG).toEqual(getPreset('ch-sd-1x1')?.config);
    expect(DEFAULT_PRESET_ID).toBe('ch-sd-1x1');
    expect(Object.isFrozen(DEFAULT_CONFIG.cover)).toBe(true);
    const copy = cloneConfig(DEFAULT_CONFIG);
    copy.cover.margin = 9;
    expect(DEFAULT_CONFIG.cover.margin).toBe(4);
  });
});

describe('presets', () => {
  const expected: Array<[string, number, number, number, number]> = [
    // id, plate w, plate h, cols, rows
    ['ch-sd-1x1', 90, 90, 1, 1],
    ['ch-sd-1x2v-switch-socket', 90, 150, 1, 2],
    ['ch-sd-2x1h-two-switches', 150, 90, 2, 1],
    ['ch-sd-1x2v-two-switches', 90, 150, 1, 2],
    ['ch-sd-1x3v-switch-two-sockets', 90, 210, 1, 3],
    ['ch-sd-3x1h-three-switches', 210, 90, 3, 1],
    ['ch-sd-2x2', 150, 150, 2, 2],
    ['de-1x1', 81, 81, 1, 1],
    ['de-1x2v', 81, 152, 1, 2],
    ['de-2x1h', 152, 81, 2, 1],
    ['custom', 90, 90, 1, 1],
  ];

  it('lists Swiss presets first, then DE, then custom', () => {
    expect(listPresets().map((p) => p.id)).toEqual(expected.map((e) => e[0]));
  });

  it.each(expected)('%s has the right plate and grid and validates', (id, w, h, cols, rows) => {
    const p = getPreset(id);
    expect(p).toBeDefined();
    const c = p!.config;
    expect(CoverConfigSchema.safeParse(c).success).toBe(true);
    expect([c.plate.w, c.plate.h, c.grid.cols, c.grid.rows]).toEqual([w, h, cols, rows]);
    expect(c.plate.preset).toBe(id);
    expect(c.modules).toHaveLength(cols * rows);
    const swiss = id.startsWith('ch-') || id === 'custom';
    expect(c.grid.pitchX).toBe(swiss ? 60 : 71);
    expect(c.plate.depth).toBe(swiss ? 12 : 10);
  });

  it('module roles follow the presets table', () => {
    const roles = (id: string) => getPreset(id)!.config.modules.map((m) => `${m.role}${m.rot ? `@${m.rot}` : ''}`);
    expect(roles('ch-sd-1x2v-switch-socket')).toEqual(['bilresa', 'outlet']);
    expect(roles('ch-sd-1x2v-two-switches')).toEqual(['bilresa@90', 'bilresa@90']);
    expect(roles('ch-sd-1x3v-switch-two-sockets')).toEqual(['bilresa', 'outlet', 'outlet']);
    expect(roles('ch-sd-2x2')).toEqual(['bilresa', 'bilresa', 'outlet', 'outlet']);
    const outlet = getPreset('ch-sd-1x2v-switch-socket')!.config.modules[1];
    expect(outlet.opening).toEqual({ shape: 'circle', d: 46 });
  });

  it('presetConfig returns a mutable copy and falls back to the default', () => {
    const c = presetConfig('ch-sd-2x2');
    c.plate.w = 1;
    expect(getPreset('ch-sd-2x2')!.config.plate.w).toBe(150);
    expect(presetConfig('nope').plate.preset).toBe('ch-sd-1x1');
  });
});

describe('migrateConfig', () => {
  it('passes a valid v1 config through unchanged', () => {
    const c = presetConfig('ch-sd-2x2');
    const r = migrateConfig(JSON.parse(JSON.stringify(c)));
    expect(r.warnings).toEqual([]);
    expect(r.config).toEqual(c);
  });

  it.each([null, 42, 'hello', [], {}, { v: 'x' }, { v: 0 }])('garbage %j → defaults + warning', (raw) => {
    const r = migrateConfig(raw);
    expect(r.config).toEqual(DEFAULT_CONFIG);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].code).toBe('config-invalid');
  });

  it('newer versions fall back to defaults with a warning', () => {
    const r = migrateConfig({ ...presetConfig('ch-sd-2x2'), v: 2 });
    expect(r.config).toEqual(DEFAULT_CONFIG);
    expect(r.warnings[0].message).toMatch(/newer/);
  });

  it('fills missing fields from the defaults without warnings', () => {
    const raw = JSON.parse(JSON.stringify(presetConfig('ch-sd-2x1h-two-switches')));
    delete raw.cover.margin;
    delete raw.print;
    delete raw.modules[0].dx;
    const r = migrateConfig(raw);
    expect(r.warnings).toEqual([]);
    expect(r.config.cover.margin).toBe(4);
    expect(r.config.print).toEqual(DEFAULT_PRINT);
    expect(r.config.modules[0].dx).toBe(0);
    expect(r.config.plate.w).toBe(150);
  });

  it('drops invalid modules and resets invalid sections, keeping the rest', () => {
    const raw = JSON.parse(JSON.stringify(presetConfig('ch-sd-2x1h-two-switches')));
    raw.modules[1].role = 'toaster';
    raw.bilresa.pocketDepth = -5;
    const r = migrateConfig(raw);
    expect(r.config.modules).toHaveLength(1);
    expect(r.config.bilresa).toEqual(DEFAULT_BILRESA);
    expect(r.config.plate.w).toBe(150);
    expect(r.warnings.map((w) => w.code)).toEqual(['config-repaired', 'config-repaired']);
  });
});
