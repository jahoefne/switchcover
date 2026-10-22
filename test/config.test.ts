import { describe, expect, it } from 'vitest';
import {
  BILRESA_VARIANTS,
  DEFAULT_BILRESA,
  DEFAULT_COVER,
  DEFAULT_PART,
  DEFAULT_PRINT,
  MAX_OPENING_TUNNEL,
  MIN_POCKET_DEPTH,
  OUTLET_CH,
  backFilletInset,
} from '../src/config/defaults';
import { V1_STRIP_PLACEHOLDER, migrateConfig } from '../src/config/migrate';
import { DEFAULT_PRESET_ID, getPreset, listPresets, presetConfig } from '../src/config/presets';
import { CoverConfigSchema, DEFAULT_CONFIG, cloneConfig } from '../src/config/schema';
import { moduleAnchor } from '../src/layout/resolve';

describe('defaults', () => {
  it('Bilresa variants match the measured STLs (front outline, back flat, R8 back fillet, strip rim)', () => {
    expect(BILRESA_VARIANTS['2button']).toMatchObject({ outline: { kind: 'stadium', w: 40, h: 70 }, depth: 18.5, backFlat: { w: 24, h: 54 }, backFilletR: 8, stripRim: 1 });
    expect(BILRESA_VARIANTS.wheel).toMatchObject({ outline: { kind: 'stadium', w: 45, h: 70 }, depth: 18.5, backFlat: { w: 29, h: 54 }, backFilletR: 8, stripRim: 1 });
    for (const v of Object.values(BILRESA_VARIANTS)) {
      expect(v.backFlat.w).toBeCloseTo(v.outline.w - 2 * v.backFilletR, 9);
      expect(v.backFlat.h).toBeCloseTo(v.outline.h - 2 * v.backFilletR, 9);
    }
  });

  it('backFilletInset is the exact quarter round (matches the STL slices 6.23 / 4.13 / 2.71 / 1.76)', () => {
    const measured: Array<[number, number]> = [
      [0.2, 6.23],
      [1, 4.13],
      [2, 2.71],
      [3, 1.76],
    ];
    for (const [h, inset] of measured) expect(Math.abs(backFilletInset(8, h) - inset)).toBeLessThan(0.02);
    expect(backFilletInset(8, 0)).toBe(8);
    expect(backFilletInset(8, -1)).toBe(8);
    expect(backFilletInset(8, 8)).toBe(0);
    expect(backFilletInset(8, 12)).toBe(0);
    expect(backFilletInset(0, 1)).toBe(0);
  });

  it('uses the decided defaults: 14 mm nested pocket, measured strip on 16 mm ledges (34 × 20 hole), Ø14 notch off, Ø50 socket', () => {
    expect(DEFAULT_BILRESA).toEqual({
      pocketDepth: 14,
      pocketClearance: 0.3,
      floorT: 2.4,
      hiddenMargin: 3,
      notch: { enabled: false, d: 14 },
      access: { w: 34 },
      strip: { shape: 'stadium', l: 52, w: 22, protrusion: 1, dx: 0, dy: 0 },
      stripLedge: 16,
    });
    // access hole length = strip length − 2 · ledge
    expect(DEFAULT_BILRESA.strip.l - 2 * DEFAULT_BILRESA.stripLedge).toBe(20);
    expect(OUTLET_CH).toEqual({ shape: 'circle', d: 50 });
    expect(MAX_OPENING_TUNNEL).toBe(20);
    expect(MIN_POCKET_DEPTH).toBe(8.5);
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
    ['ch-sd-1x1-combo', 90, 90, 1, 2],
    ['ch-sd-1x2v-switch-socket', 90, 150, 1, 2],
    ['ch-sd-2x1h-two-switches', 150, 90, 2, 1],
    ['ch-sd-1x2v-two-switches', 90, 150, 1, 2],
    ['ch-sd-1x3v-switch-two-sockets', 90, 210, 1, 3],
    ['ch-sd-3x1h-three-switches', 210, 90, 3, 1],
    ['ch-sd-2x2', 150, 150, 2, 2],
    ['ch-sd-ext-top-h', 90, 90, 1, 1],
    ['ch-sd-ext-top-v', 90, 90, 1, 1],
    ['de-1x1', 81, 81, 1, 1],
    ['de-1x2v', 81, 152, 1, 2],
    ['de-2x1h', 152, 81, 2, 1],
    ['custom', 90, 90, 1, 1],
  ];

  it('lists Swiss presets first, then DE, then custom', () => {
    expect(listPresets().map((p) => p.id)).toEqual(expected.map((e) => e[0]));
  });

  it('every preset is a cap except the two extensions, which sit above the plate', () => {
    for (const p of listPresets()) {
      const extension = p.id.startsWith('ch-sd-ext-');
      expect(p.config.part, p.id).toEqual({ ...DEFAULT_PART, kind: extension ? 'extension' : 'cap' });
    }
    expect(getPreset('ch-sd-ext-top-h')!.config.modules).toEqual([{ col: 0, row: 0, role: 'bilresa', rot: 90, dx: 0, dy: 0, bilresa: { variant: '2button' } }]);
    expect(getPreset('ch-sd-ext-top-v')!.config.modules).toEqual([{ col: 0, row: 0, role: 'bilresa', rot: 0, dx: 0, dy: 0, bilresa: { variant: '2button' } }]);
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
    expect(outlet.opening).toEqual({ shape: 'circle', d: 50 });
  });

  it('the combo plate: two rows on ONE 90 × 90 plate, grid shifted onto the key and the socket', () => {
    const c = getPreset('ch-sd-1x1-combo')!.config;
    expect(c.grid).toEqual({ cols: 1, rows: 2, pitchX: 60, pitchY: 31, offsetX: 0, offsetY: 3.5 });
    // key centre 26 mm, socket centre 57 mm below the plate's top edge (45)
    expect(moduleAnchor(c.grid, 0, 0)).toEqual([0, 45 - 26]);
    expect(moduleAnchor(c.grid, 0, 1)).toEqual([0, 45 - 57]);
    expect(c.modules).toEqual([
      { col: 0, row: 0, role: 'bilresa', rot: 90, dx: 0, dy: 17, bilresa: { variant: '2button' } },
      { col: 0, row: 1, role: 'outlet', rot: 0, dx: 0, dy: 0, opening: { shape: 'circle', d: 50 } },
    ]);
    // right after the plain 1×1 in the list
    const ids = listPresets().map((p) => p.id);
    expect(ids.indexOf('ch-sd-1x1-combo')).toBe(ids.indexOf('ch-sd-1x1') + 1);
  });

  it('presetConfig returns a mutable copy and falls back to the default', () => {
    const c = presetConfig('ch-sd-2x2');
    c.plate.w = 1;
    expect(getPreset('ch-sd-2x2')!.config.plate.w).toBe(150);
    expect(presetConfig('nope').plate.preset).toBe('ch-sd-1x1');
  });
});

describe('migrateConfig', () => {
  it('passes a valid v2 config through unchanged', () => {
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
    const r = migrateConfig({ ...presetConfig('ch-sd-2x2'), v: 3 });
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

  it('rejects pocket depths below the nested-pocket minimum', () => {
    const c = presetConfig('ch-sd-1x1');
    c.bilresa.pocketDepth = 8;
    expect(CoverConfigSchema.safeParse(c).success).toBe(false);
    c.bilresa.pocketDepth = 8.5;
    c.modules[0].bilresa = { variant: '2button', pocketDepth: 8 };
    expect(CoverConfigSchema.safeParse(c).success).toBe(false);
  });
});

describe('migrateConfig v1 → v2', () => {
  /** A v1 config as v1 wrote it (v1 field names and defaults). */
  function v1Config(): Record<string, any> {
    const c: Record<string, any> = JSON.parse(JSON.stringify(presetConfig('ch-sd-2x1h-two-switches')));
    c.v = 1;
    c.bilresa = {
      pocketDepth: 9,
      pocketClearance: 0.3,
      floorT: 2.4,
      hiddenMargin: 3,
      notch: { enabled: true, d: 16 },
      access: { w: 34, h: 56 },
      strip: { ...V1_STRIP_PLACEHOLDER },
      stripMargin: 2.5,
    };
    return c;
  }

  it("stripMargin → today's default stripLedge, access {w, h} → {w}, placeholder strip → measured strip; the rest is kept", () => {
    const r = migrateConfig(v1Config());
    expect(r.warnings).toEqual([]);
    expect(r.config.v).toBe(2);
    expect(r.config.bilresa).toEqual({
      pocketDepth: 9,
      pocketClearance: 0.3,
      floorT: 2.4,
      hiddenMargin: 3,
      notch: { enabled: true, d: 16 },
      access: { w: 34 },
      strip: DEFAULT_BILRESA.strip,
      // v1 had no ledges: an old link gets the ledge of today's default (16 mm)
      stripLedge: DEFAULT_BILRESA.stripLedge,
    });
    expect(r.config.modules).toEqual(presetConfig('ch-sd-2x1h-two-switches').modules);
  });

  it("stripLedge is today's default whatever the old stripMargin was", () => {
    const raw = v1Config();
    raw.bilresa.stripMargin = 7;
    expect(migrateConfig(raw).config.bilresa.stripLedge).toBe(DEFAULT_BILRESA.stripLedge);
  });

  it('keeps a user-entered strip (and a partial placeholder that differs)', () => {
    const raw = v1Config();
    raw.bilresa.strip = { shape: 'rect', l: 50, w: 20, protrusion: 0.8, dx: 1, dy: 0 };
    expect(migrateConfig(raw).config.bilresa.strip).toEqual({ shape: 'rect', l: 50, w: 20, protrusion: 0.8, dx: 1, dy: 0 });
    raw.bilresa.strip = { l: 46 };
    expect(migrateConfig(raw).config.bilresa.strip).toEqual({ ...V1_STRIP_PLACEHOLDER, l: 46 });
    raw.bilresa.strip = { l: 44 }; // = the placeholder once its v1 defaults are filled in
    expect(migrateConfig(raw).config.bilresa.strip).toEqual(DEFAULT_BILRESA.strip);
  });

  it('raises pocket depths below 8.5 mm (global and per module) with an info note', () => {
    const raw = v1Config();
    raw.bilresa.pocketDepth = 6;
    raw.modules[1].bilresa = { variant: 'wheel', pocketDepth: 7 };
    const r = migrateConfig(raw);
    expect(r.config.bilresa.pocketDepth).toBe(8.5);
    expect(r.config.modules[1].bilresa).toEqual({ variant: 'wheel', pocketDepth: 8.5 });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: 'config-migrated', severity: 'info' });
  });

  it('a v1 config missing the bilresa section gets the v2 defaults', () => {
    const raw = v1Config();
    delete raw.bilresa;
    const r = migrateConfig(raw);
    expect(r.warnings).toEqual([]);
    expect(r.config.bilresa).toEqual(DEFAULT_BILRESA);
  });
});
