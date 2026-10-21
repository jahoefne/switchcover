/**
 * Test configurations: every preset plus a few extra layouts that exercise paths the presets
 * do not (passthrough, rounded-rect outlet, wheel pocket, rotation + spreading against an
 * opening, notch off, per-module depth, dx/dy), and seeded random layouts.
 */
import { listPresets, presetConfig } from '../../src/config/presets';
import { CoverConfigSchema, type CoverConfig, type ModuleConfig, type OpeningSpec } from '../../src/config/schema';

function passthroughWheel(): CoverConfig {
  const c = presetConfig('custom');
  c.plate = { ...c.plate, preset: 'custom', w: 150, h: 90 };
  c.grid = { cols: 2, rows: 1, pitchX: 60, pitchY: 60 };
  c.modules = [
    { col: 0, row: 0, role: 'bilresa', rot: 90, dx: 0, dy: 0, bilresa: { variant: 'wheel' } },
    { col: 1, row: 0, role: 'passthrough', rot: 0, dx: 0, dy: 0 },
  ];
  return c;
}

function rectOutletShallow(): CoverConfig {
  const c = presetConfig('custom');
  c.plate = { ...c.plate, preset: 'custom', w: 90, h: 150 };
  c.grid = { cols: 1, rows: 2, pitchX: 60, pitchY: 60 };
  c.modules = [
    { col: 0, row: 0, role: 'outlet', rot: 0, dx: 5, dy: 0, opening: { shape: 'roundedRect', w: 40, h: 50, cornerR: 6 } },
    { col: 0, row: 1, role: 'bilresa', rot: 180, dx: 0, dy: -3, bilresa: { variant: '2button', pocketDepth: 8.5, notch: false } },
  ];
  return c;
}

const EXTRA: Record<string, () => CoverConfig> = {
  'x-passthrough-wheel': passthroughWheel,
  'x-rect-outlet-shallow': rectOutletShallow,
};

/** Ids of every test layout (presets first). */
export const LAYOUT_IDS: readonly string[] = [...listPresets().map((p) => p.id), ...Object.keys(EXTRA)];

/** A fresh config for a preset or extra layout id, with the given style. */
export function layoutConfig(id: string, style?: string): CoverConfig {
  const c = EXTRA[id] ? EXTRA[id]() : presetConfig(id);
  if (style) {
    c.cover.style = style;
    c.cover.styleParams = {};
  }
  return c;
}

/** Small deterministic PRNG (LCG) in [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const OUTLET_SHAPES: readonly OpeningSpec[] = [
  { shape: 'circle', d: 46 },
  { shape: 'roundedRect', w: 40, h: 50, cornerR: 5 },
  { shape: 'stadium', w: 30, h: 50 },
];

/**
 * A random but schema-valid layout (seeded, deterministic): 1–3 × 1–3 grid, random roles,
 * rotations, dx/dy up to ±15 mm, opening shapes, pocket depths, notch, skin / skirt / wall
 * thickness, minimal style params. Overlapping features are allowed (the resolver warns).
 */
export function randomConfig(seed: number): CoverConfig {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const c = layoutConfig('ch-sd-1x1', pick(['box', 'minimal']));
  const cols = pick([1, 1, 2, 3]);
  const rows = pick([1, 2, 2, 3]);
  c.grid = { cols, rows, pitchX: 60, pitchY: 60 };
  c.plate = { ...c.plate, w: 90 + 60 * (cols - 1), h: 90 + 60 * (rows - 1) };
  c.modules = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const role = pick(['bilresa', 'bilresa', 'outlet', 'blank', 'passthrough'] as const);
      const m: ModuleConfig = {
        col,
        row,
        role,
        rot: pick([0, 90, 180, 270] as const),
        dx: Math.round((r() - 0.5) * 30),
        dy: Math.round((r() - 0.5) * 30),
      };
      if (role === 'bilresa') {
        m.bilresa = {
          variant: pick(['2button', 'wheel'] as const),
          pocketDepth: pick([undefined, 9, 12]),
          notch: pick([undefined, false]),
        };
      }
      if (role === 'outlet') m.opening = { ...pick(OUTLET_SHAPES) };
      c.modules.push(m);
    }
  }
  c.cover.skinT = pick([2, 3, 4]);
  c.cover.skirtT = pick([1.6, 2.4, 3]);
  c.cover.minWall = pick([1.2, 2, 3]);
  c.cover.margin = pick([0, 2, 4]);
  c.bilresa.pocketDepth = pick([8.5, 10, 11]);
  c.bilresa.notch.d = pick([10, 14, 18]);
  if (c.cover.style === 'minimal') c.cover.styleParams = { cornerR: pick([0, 4, 10]), chamfer: pick([0, 1, 2.5]) };
  return CoverConfigSchema.parse(c);
}
