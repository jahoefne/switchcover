/**
 * CoverConfig v2 — the complete, serialisable description of one cover.
 *
 * This is what the URL hash stores (see urlCodec.ts) and what the worker receives.
 * Everything is in mm / degrees, in the conventions documented in README.md.
 * Semantic checks (module inside the grid, duplicates, overlaps) are NOT done here but in
 * resolveLayout, which warns instead of rejecting so half-edited configs still render.
 *
 * v2 (2026-10-21, Bilresa orientation rework; v1 links are migrated by migrate.ts):
 *  - bilresa.stripMargin → bilresa.stripLedge (glue ledge at each strip end; the single access
 *    hole spans the strip between the ledges),
 *  - bilresa.access is { w } (the hole length follows the strip),
 *  - pocketDepth (global and per module) ≥ MIN_POCKET_DEPTH (the nested pocket follows the
 *    Bilresa's 8 mm back fillet).
 *
 * Additive within v2 (no version bump; every older v2 link still parses):
 *  - grid.offsetX / grid.offsetY (mm, default 0): shift every module anchor, for plates whose
 *    devices do not sit on a grid centred on the plate (e.g. the Swiss switch + socket combo).
 *  - part (default: a cap): the part kind. 'extension' is a flat slab beside the existing plate
 *    (which stays in use) that holds the Bilresa in a raised pocket; see PartSchema.
 */
import { z } from 'zod';
import {
  CH_STANDARDDUE,
  DEFAULT_BILRESA,
  DEFAULT_COVER,
  DEFAULT_PART,
  DEFAULT_PRINT,
  MIN_POCKET_DEPTH,
  plateSpan,
} from './defaults';

export const CONFIG_VERSION = 2 as const;

const mm = (min: number, max: number) => z.number().min(min).max(max);

export const ModuleRoleSchema = z.enum(['bilresa', 'outlet', 'blank', 'passthrough']);
export const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export const BilresaVariantSchema = z.enum(['2button', 'wheel']);

export const OpeningSpecSchema = z.object({
  shape: z.enum(['circle', 'roundedRect', 'stadium']),
  /** circle diameter */
  d: mm(1, 300).optional(),
  /** roundedRect / stadium width (X before rotation) */
  w: mm(1, 300).optional(),
  /** roundedRect / stadium height (Y before rotation) */
  h: mm(1, 300).optional(),
  /** roundedRect corner radius */
  cornerR: mm(0, 150).optional(),
});

export const ModuleSchema = z.object({
  col: z.number().int().min(0).max(9),
  row: z.number().int().min(0).max(9),
  role: ModuleRoleSchema,
  /** CCW rotation of the feature about +Z (Bilresa: 0 = long axis vertical). */
  rot: RotationSchema,
  /** Feature offset from the module anchor (+dy is up). */
  dx: mm(-100, 100),
  dy: mm(-100, 100),
  bilresa: z
    .object({
      variant: BilresaVariantSchema,
      /** Per-module pocket depth override. */
      pocketDepth: mm(MIN_POCKET_DEPTH, 30).optional(),
      /** Per-module finger notch override. */
      notch: z.boolean().optional(),
    })
    .optional(),
  opening: OpeningSpecSchema.optional(),
});

export const PlateSchema = z.object({
  /** Preset id the plate came from, or 'custom'. Informational. */
  preset: z.string().min(1).max(64),
  w: mm(20, 500),
  h: mm(20, 500),
  /** Protrusion from the wall (frame + key). */
  depth: mm(0, 50),
  cornerR: mm(0, 100),
});

export const GridSchema = z.object({
  cols: z.number().int().min(1).max(10),
  rows: z.number().int().min(1).max(10),
  pitchX: mm(10, 200),
  pitchY: mm(10, 200),
  /**
   * Shift of the whole module grid from the plate centre (mm, +Y is up). Optional with default 0,
   * so links written before it existed parse unchanged.
   */
  offsetX: mm(-200, 200).default(0),
  offsetY: mm(-200, 200).default(0),
});

export const CoverSettingsSchema = z.object({
  /** Style id from the registry (src/styles/index.ts). */
  style: z.string().min(1).max(64),
  /** Style params, validated by the style's own zod schema at build time. */
  styleParams: z.record(z.string(), z.unknown()),
  skinT: mm(0.4, 20),
  skirtT: mm(0.4, 20),
  minWall: mm(0.4, 20),
  clearance: mm(0, 20),
  rockerGap: mm(0, 20),
  margin: mm(0, 100),
  size: z.union([z.literal('auto'), z.object({ w: mm(10, 1000), h: mm(10, 1000) })]),
});

export const BilresaSettingsSchema = z.object({
  pocketDepth: mm(MIN_POCKET_DEPTH, 30),
  pocketClearance: mm(0, 5),
  floorT: mm(0.4, 20),
  hiddenMargin: mm(0, 30),
  notch: z.object({ enabled: z.boolean(), d: mm(2, 60) }),
  /** Access (bridge) hole width across the Bilresa; its length follows the strip. */
  access: z.object({ w: mm(0, 150) }),
  strip: z.object({
    shape: z.enum(['stadium', 'rect']),
    /** Length along the Bilresa's long axis. */
    l: mm(0.5, 150),
    /** Width across the long axis. */
    w: mm(0.5, 100),
    /** How far the strip stands proud of the Bilresa's back (= depth of its floor indent − tolerance). */
    protrusion: mm(0, 10),
    /** Strip offset from the pocket centre, in the Bilresa's own (unrotated) frame. */
    dx: mm(-50, 50),
    dy: mm(-50, 50),
  }),
  /** Floor length (mm) the strip is glued onto at each end; the access hole spans the rest. */
  stripLedge: mm(0, 30),
});

export const PrintSettingsSchema = z.object({
  tolerance: mm(0, 2),
  orientation: z.enum(['style', 'faceDown', 'faceUp']),
});

export const PartKindSchema = z.enum(['cap', 'extension']);
export const ExtensionSideSchema = z.enum(['top', 'bottom', 'left', 'right']);

/**
 * What the printed part is:
 *  - 'cap' (default): the hollow cover over the existing plate (everything else in this file).
 *  - 'extension': a flat slab glued to the wall beside the plate, on `side` of it and `gap` mm
 *    from its edge, with its face flush with the plate's (plate.depth). The plate stays in use
 *    (its switch cannot be replaced), the Bilresa sits in a pocket of the slab whose rim rises
 *    above the face where the pocket is deeper than the slab, through a concave cove `flare` mm
 *    wide. Modules sit on the grid centred on the slab; outlets / passthroughs are ignored there.
 * The whole object is optional with defaults, so links written before it existed parse unchanged.
 */
export const PartSchema = z
  .object({
    kind: PartKindSchema.default(DEFAULT_PART.kind),
    side: ExtensionSideSchema.default(DEFAULT_PART.side),
    gap: mm(0, 50).default(DEFAULT_PART.gap),
    flare: mm(0, 30).default(DEFAULT_PART.flare),
  })
  .default(DEFAULT_PART);

export const CoverConfigSchema = z.object({
  v: z.literal(CONFIG_VERSION),
  plate: PlateSchema,
  grid: GridSchema,
  modules: z.array(ModuleSchema).max(100),
  cover: CoverSettingsSchema,
  bilresa: BilresaSettingsSchema,
  print: PrintSettingsSchema,
  part: PartSchema,
});

export type CoverConfig = z.infer<typeof CoverConfigSchema>;
export type PartSettings = z.infer<typeof PartSchema>;
export type PartKind = z.infer<typeof PartKindSchema>;
export type ExtensionSide = z.infer<typeof ExtensionSideSchema>;
export type PlateSettings = z.infer<typeof PlateSchema>;
export type GridSettings = z.infer<typeof GridSchema>;
export type ModuleConfig = z.infer<typeof ModuleSchema>;
export type ModuleRole = z.infer<typeof ModuleRoleSchema>;
export type Rotation = z.infer<typeof RotationSchema>;
export type OpeningSpec = z.infer<typeof OpeningSpecSchema>;
export type CoverSettings = z.infer<typeof CoverSettingsSchema>;
export type BilresaSettings = z.infer<typeof BilresaSettingsSchema>;
export type PrintSettings = z.infer<typeof PrintSettingsSchema>;

/** Recursively freeze plain data (presets and DEFAULT_CONFIG are frozen; clone to edit). */
export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/**
 * Default config = preset 'ch-sd-1x1' (one two-button Bilresa on a Swiss 1×1 plate).
 * Deep-frozen: use cloneConfig(DEFAULT_CONFIG) for an editable copy.
 */
export const DEFAULT_CONFIG: CoverConfig = deepFreeze(CoverConfigSchema.parse({
  v: CONFIG_VERSION,
  plate: {
    preset: 'ch-sd-1x1',
    w: plateSpan(CH_STANDARDDUE, 1),
    h: plateSpan(CH_STANDARDDUE, 1),
    depth: CH_STANDARDDUE.depth,
    cornerR: CH_STANDARDDUE.cornerR,
  },
  grid: { cols: 1, rows: 1, pitchX: CH_STANDARDDUE.pitch, pitchY: CH_STANDARDDUE.pitch, offsetX: 0, offsetY: 0 },
  modules: [{ col: 0, row: 0, role: 'bilresa', rot: 0, dx: 0, dy: 0, bilresa: { variant: '2button' } }],
  cover: DEFAULT_COVER,
  bilresa: DEFAULT_BILRESA,
  print: DEFAULT_PRINT,
  part: DEFAULT_PART,
} satisfies CoverConfig));

/** Deep copy (configs are plain JSON data). */
export function cloneConfig(c: CoverConfig): CoverConfig {
  return structuredClone(c);
}
