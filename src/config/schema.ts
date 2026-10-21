/**
 * CoverConfig v1 — the complete, serialisable description of one cover.
 *
 * This is what the URL hash stores (see urlCodec.ts) and what the worker receives.
 * Everything is in mm / degrees, in the conventions documented in README.md.
 * Semantic checks (module inside the grid, duplicates, overlaps) are NOT done here but in
 * resolveLayout, which warns instead of rejecting so half-edited configs still render.
 */
import { z } from 'zod';
import {
  CH_STANDARDDUE,
  DEFAULT_BILRESA,
  DEFAULT_COVER,
  DEFAULT_PRINT,
  plateSpan,
} from './defaults';

export const CONFIG_VERSION = 1 as const;

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
      pocketDepth: mm(2, 30).optional(),
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
  pocketDepth: mm(2, 30),
  pocketClearance: mm(0, 5),
  floorT: mm(0.4, 20),
  hiddenMargin: mm(0, 30),
  notch: z.object({ enabled: z.boolean(), d: mm(2, 60) }),
  access: z.object({ w: mm(0, 150), h: mm(0, 150) }),
  strip: z.object({
    shape: z.enum(['stadium', 'rect']),
    /** Length along the Bilresa's long axis. */
    l: mm(0.5, 150),
    /** Width across the long axis. */
    w: mm(0.5, 100),
    /** How far the strip stands proud of the pocket floor. */
    protrusion: mm(0, 10),
    /** Strip offset from the pocket centre, in the Bilresa's own (unrotated) frame. */
    dx: mm(-50, 50),
    dy: mm(-50, 50),
  }),
  stripMargin: mm(0, 30),
});

export const PrintSettingsSchema = z.object({
  tolerance: mm(0, 2),
  orientation: z.enum(['style', 'faceDown', 'faceUp']),
});

export const CoverConfigSchema = z.object({
  v: z.literal(CONFIG_VERSION),
  plate: PlateSchema,
  grid: GridSchema,
  modules: z.array(ModuleSchema).max(100),
  cover: CoverSettingsSchema,
  bilresa: BilresaSettingsSchema,
  print: PrintSettingsSchema,
});

export type CoverConfig = z.infer<typeof CoverConfigSchema>;
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
  grid: { cols: 1, rows: 1, pitchX: CH_STANDARDDUE.pitch, pitchY: CH_STANDARDDUE.pitch },
  modules: [{ col: 0, row: 0, role: 'bilresa', rot: 0, dx: 0, dy: 0, bilresa: { variant: '2button' } }],
  cover: DEFAULT_COVER,
  bilresa: DEFAULT_BILRESA,
  print: DEFAULT_PRINT,
} satisfies CoverConfig));

/** Deep copy (configs are plain JSON data). */
export function cloneConfig(c: CoverConfig): CoverConfig {
  return structuredClone(c);
}
