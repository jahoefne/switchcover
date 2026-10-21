/**
 * Preset layouts. Swiss Feller STANDARDdue first, then DE/EU (data-only), then custom.
 * Every preset is a complete, validated CoverConfig (deep-frozen: clone before editing).
 */
import {
  CH_STANDARDDUE,
  DEFAULT_BILRESA,
  DEFAULT_COVER,
  DEFAULT_PRINT,
  DE_FRAME,
  plateSpan,
  type PlateSystem,
} from './defaults';
import {
  CONFIG_VERSION,
  CoverConfigSchema,
  cloneConfig,
  deepFreeze,
  type CoverConfig,
  type GridSettings,
  type ModuleConfig,
  type Rotation,
} from './schema';

export interface Preset {
  id: string;
  label: string;
  description: string;
  system: PlateSystem['id'] | 'custom';
  config: CoverConfig;
}

type ModuleSpec =
  | { role: 'bilresa'; rot?: Rotation; dy?: number }
  | { role: 'outlet' }
  | { role: 'blank' }
  | { role: 'passthrough' };

/** Plate / grid overrides for plates whose devices do not sit on the system's module grid. */
interface LayoutOptions {
  /** Plate size in modules of the system (default: the grid's cols × rows). */
  plateModules?: { cols: number; rows: number };
  /** Grid pitch and offset (default: the system pitch, no offset). */
  grid?: Partial<Pick<GridSettings, 'pitchX' | 'pitchY' | 'offsetX' | 'offsetY'>>;
}

/** Build a full config for a plate system with `cells[row][col]` module specs. */
function makeConfig(id: string, system: PlateSystem, cells: ModuleSpec[][], opts: LayoutOptions = {}): CoverConfig {
  const rows = cells.length;
  const cols = cells[0].length;
  const modules: ModuleConfig[] = [];
  cells.forEach((rowCells, row) => {
    if (rowCells.length !== cols) throw new Error(`preset ${id}: ragged grid`);
    rowCells.forEach((spec, col) => {
      const m: ModuleConfig = { col, row, role: spec.role, rot: 0, dx: 0, dy: 0 };
      if (spec.role === 'bilresa') {
        m.rot = spec.rot ?? 0;
        m.dy = spec.dy ?? 0;
        m.bilresa = { variant: '2button' };
      } else if (spec.role === 'outlet') {
        m.opening = { ...system.outlet };
      }
      modules.push(m);
    });
  });
  const span = opts.plateModules ?? { cols, rows };
  return CoverConfigSchema.parse({
    v: CONFIG_VERSION,
    plate: {
      preset: id,
      w: plateSpan(system, span.cols),
      h: plateSpan(system, span.rows),
      depth: system.depth,
      cornerR: system.cornerR,
    },
    grid: { cols, rows, pitchX: system.pitch, pitchY: system.pitch, offsetX: 0, offsetY: 0, ...opts.grid },
    modules,
    cover: DEFAULT_COVER,
    bilresa: DEFAULT_BILRESA,
    print: DEFAULT_PRINT,
  } satisfies CoverConfig);
}

const B: ModuleSpec = { role: 'bilresa' };
const B90: ModuleSpec = { role: 'bilresa', rot: 90 };
const O: ModuleSpec = { role: 'outlet' };

/**
 * Feller STANDARDdue "Kleinkombination": one switch and one Type 13 socket on ONE 90 × 90 plate
 * (user-measured). The switch key (≈ 60 × 22) is centred 26 mm below the plate's top edge
 * (y = 45 − 26 = +19), the socket recess 57 mm below it (y = 45 − 57 = −12). A 1 × 2 grid with
 * pitchY 31 shifted up by offsetY 3.5 puts the two anchors exactly there: (31/2 + 3.5, −31/2 + 3.5).
 *
 * The two-button Bilresa lies horizontally (rot 90: 70.6 wide × 40.6 tall with clearance) above
 * the Ø50 opening. The 34 mm wide bridge hole runs across it (y = pocket centre ± 17), so the key
 * centre (+19) stays inside the hole up to a pocket centre of y = 36: dy = 36 − 19 = 17, the
 * largest dy the access rule allows. That leaves 36 − 20.3 − (−12 + 25) = 2.7 mm of wall to the
 * opening: ≥ minWall 2, but less than minWall + minimal's edge allowances (socket chamfer 1, pocket
 * chamfer 0.6) = 3.6, which would need y = 36.9 and put the key centre outside the hole. So no
 * style spreads the pocket (resolveLayout holds it where the key centre would leave the hole) and
 * every style with edges narrows them between the pocket and the socket (edge-reduced note).
 * The pocket does not fit the plate's height (top 36 + 20.3 = 56.3 > 45), so the cover grows
 * UPWARDS only (user decision): minimal 96.8 × 111.3 mm centred 7.25 mm above the plate centre
 * (bottom at the plate-driven −48.4, top at pocket top + minWall 2 + margin 4 + chamfer 0.6 = 62.9),
 * the socket stays near the bottom.
 *
 * Access: the 34 × 20 bridge hole spans y 19 … 53 (x −10 … 10), so the key centre lies on its lower
 * edge; the strip indent covers y 24.8 … 47.2, leaving the lower tool gap y 19 … 24.8 over the key
 * band (y 8 … 30) and an upper gap y 47.2 … 53 above the key.
 * A finger notch, when switched on, sits at the pocket's +x end (a horizontal pocket's two ends tie).
 */
const COMBO_BILRESA_DY = 17;

function preset(
  id: string,
  label: string,
  description: string,
  system: PlateSystem,
  cells: ModuleSpec[][],
  opts?: LayoutOptions,
): Preset {
  return { id, label, description, system: system.id, config: makeConfig(id, system, cells, opts) };
}

function customPreset(): Preset {
  const config = makeConfig('custom', CH_STANDARDDUE, [[B]]);
  return {
    id: 'custom',
    label: 'Custom',
    description: 'Start from a single Swiss module and edit plate, grid and modules freely.',
    system: 'custom',
    config,
  };
}

export const PRESETS: readonly Preset[] = deepFreeze([
  preset('ch-sd-1x1', 'CH 1×1 — switch', 'STANDARDdue 90×90, one Bilresa.', CH_STANDARDDUE, [[B]]),
  preset(
    'ch-sd-1x1-combo',
    'CH 1×1 — switch + socket combo',
    'STANDARDdue 90×90 combo plate (switch above a Type 13 socket): Bilresa lying above the socket; the cover grows upwards.',
    CH_STANDARDDUE,
    [[{ role: 'bilresa', rot: 90, dy: COMBO_BILRESA_DY }], [O]],
    { plateModules: { cols: 1, rows: 1 }, grid: { pitchY: 31, offsetY: 3.5 } },
  ),
  preset(
    'ch-sd-1x2v-switch-socket',
    'CH 1×2 vertical — switch + socket',
    'STANDARDdue 90×150, Bilresa on top, Type 13 socket below (pocket is spread upwards).',
    CH_STANDARDDUE,
    [[B], [O]],
  ),
  preset(
    'ch-sd-2x1h-two-switches',
    'CH 2×1 horizontal — two switches',
    'STANDARDdue 150×90, two Bilresa side by side.',
    CH_STANDARDDUE,
    [[B, B]],
  ),
  preset(
    'ch-sd-1x2v-two-switches',
    'CH 1×2 vertical — two switches',
    'STANDARDdue 90×150, two Bilresa rotated 90° (lying), one above the other.',
    CH_STANDARDDUE,
    [[B90], [B90]],
  ),
  preset(
    'ch-sd-1x3v-switch-two-sockets',
    'CH 1×3 vertical — switch + two sockets',
    'STANDARDdue 90×210, Bilresa on top, two Type 13 sockets below.',
    CH_STANDARDDUE,
    [[B], [O], [O]],
  ),
  preset(
    'ch-sd-3x1h-three-switches',
    'CH 3×1 horizontal — three switches',
    'STANDARDdue 210×90, three Bilresa side by side.',
    CH_STANDARDDUE,
    [[B, B, B]],
  ),
  preset(
    'ch-sd-2x2',
    'CH 2×2 — two switches + two sockets',
    'STANDARDdue 150×150, two Bilresa on top, two Type 13 sockets below.',
    CH_STANDARDDUE,
    [
      [B, B],
      [O, O],
    ],
  ),
  preset('de-1x1', 'DE 1×1 — switch', '81×81 frame, one Bilresa (approximate data).', DE_FRAME, [[B]]),
  preset(
    'de-1x2v',
    'DE 1×2 vertical — switch + socket',
    '81×152 frame, Bilresa on top, Schuko socket below (approximate data).',
    DE_FRAME,
    [[B], [O]],
  ),
  preset(
    'de-2x1h',
    'DE 2×1 horizontal — two switches',
    '152×81 frame, two Bilresa side by side (approximate data).',
    DE_FRAME,
    [[B, B]],
  ),
  customPreset(),
]);

export const DEFAULT_PRESET_ID = 'ch-sd-1x1';

export function listPresets(): readonly Preset[] {
  return PRESETS;
}

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** A fresh, mutable copy of a preset's config (falls back to the default preset). */
export function presetConfig(id: string): CoverConfig {
  const p = getPreset(id) ?? getPreset(DEFAULT_PRESET_ID);
  if (!p) throw new Error('default preset missing');
  return cloneConfig(p.config);
}
