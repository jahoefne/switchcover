/**
 * Physical reference data and default parameters. This is the ONE place to correct
 * measurements (Bilresa outline, magnet strip, plate systems, clearances).
 *
 * Only type imports from schema.ts are allowed here (schema.ts imports these values).
 */
import type { BilresaSettings, CoverSettings, OpeningSpec, PrintSettings } from './schema';
import type { BilresaVariant, Shape2D } from '../geometry/contract';

// ---------------------------------------------------------------------------
// IKEA Bilresa (measured from model/*.stl: flat back at z = 0, body to z = −19.5,
// straight sides for 10 mm, then rounding to a flat front; long axis along Y)
// ---------------------------------------------------------------------------

export interface BilresaVariantDef {
  label: string;
  /** Plan outline of the device body (long axis along Y). */
  outline: Extract<Shape2D, { kind: 'stadium' }>;
  /** Body depth from the flat back to the front (mm). */
  depth: number;
  /** Flat area on the front (w × h, mm), informational. */
  frontFlat: { w: number; h: number };
  /** Reference model served from public/ (prefix with import.meta.env.BASE_URL). */
  model: string;
}

export const BILRESA_VARIANTS: Record<BilresaVariant, BilresaVariantDef> = {
  '2button': {
    label: 'Bilresa — two buttons',
    outline: { kind: 'stadium', w: 40, h: 70 },
    depth: 19.5,
    frontFlat: { w: 24, h: 54 },
    model: 'models/Bilresa_twobutton.stl',
  },
  wheel: {
    label: 'Bilresa — scroll wheel',
    outline: { kind: 'stadium', w: 45, h: 70 },
    depth: 19.5,
    frontFlat: { w: 29, h: 54 },
    model: 'models/Bilresa_scrollwheel.stl',
  },
};

// ---------------------------------------------------------------------------
// Pocket / Bilresa seat defaults
// ---------------------------------------------------------------------------

export const DEFAULT_BILRESA: BilresaSettings = {
  /** Pocket depth below the face (8–10 mm recommended). The main height trade-off. */
  pocketDepth: 9,
  /** Gap between the Bilresa outline and the pocket wall, per side. */
  pocketClearance: 0.3,
  /** Pocket floor thickness (clamped to ≥ stripDepth + 1.2 by the resolver). */
  floorT: 2.2,
  /** Access holes stay this far inside the pocket outline (hidden by the Bilresa). */
  hiddenMargin: 4,
  /** Finger notch at the pocket's far end from the plate centre. */
  notch: { enabled: true, d: 16 },
  /** Access rect (w across, h along the Bilresa's long axis), centred on the module anchor. */
  access: { w: 32, h: 56 },
  /**
   * PLACEHOLDER — the real IKEA metal strip has NOT been measured yet.
   * Assumed: stadium 44 × 7 mm centred on the Bilresa's long axis, protruding 1.0 mm from
   * the floor (the two-button STL shows a ~1 mm deep central back feature of roughly this
   * size; the wheel STL shows none). Measure a real strip (e.g. with the test-fit print)
   * and correct these numbers here.
   */
  strip: { shape: 'stadium', l: 44, w: 7, protrusion: 1.0, dx: 0, dy: 0 },
  /** Keep access holes this far from the strip outline (the strip island stays attached). */
  stripMargin: 3,
};

export const DEFAULT_COVER: CoverSettings = {
  style: 'box',
  styleParams: {},
  /** Face thickness above the cavity. */
  skinT: 3,
  /** Side wall thickness around the cavity. */
  skirtT: 2.4,
  /** Minimum wall between pockets / openings (and pocket well wall). */
  minWall: 2,
  /** Gap between the plate and the cavity, per side and on top. */
  clearance: 1,
  /** Free space above the plate so rocker ends can lift when pressed. */
  rockerGap: 2,
  /** Extra face material around pocket wells / openings when the cover auto-grows. */
  margin: 4,
  size: 'auto',
};

export const DEFAULT_PRINT: PrintSettings = {
  /** Added to strip indent depth and outline (printer tolerance). */
  tolerance: 0.2,
  orientation: 'style',
};

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

/** Swiss Type 13 socket: Ø 46 mm round cut-out. */
export const OUTLET_CH: OpeningSpec = { shape: 'circle', d: 46 };
/** German/EU Schuko socket: approximate, verify against a real plate. */
export const OUTLET_DE: OpeningSpec = { shape: 'circle', d: 50 };
/** Default passthrough (keeps an existing device reachable); approximate key size. */
export const PASSTHROUGH_DEFAULT: OpeningSpec = { shape: 'roundedRect', w: 52, h: 52, cornerR: 4 };

// ---------------------------------------------------------------------------
// Plate systems
// ---------------------------------------------------------------------------

export interface PlateSystem {
  id: 'ch-sd' | 'de';
  label: string;
  /** Plate size for n modules along an axis: base + (n − 1) · pitch. */
  base: number;
  pitch: number;
  /** Protrusion from the wall (frame + key). */
  depth: number;
  cornerR: number;
  outlet: OpeningSpec;
}

/** Swiss Feller STANDARDdue: 90 / 150 / 210 mm, 60 mm pitch, ~12 mm proud. */
export const CH_STANDARDDUE: PlateSystem = {
  id: 'ch-sd',
  label: 'Feller STANDARDdue (CH)',
  base: 90,
  pitch: 60,
  depth: 12,
  cornerR: 3,
  outlet: OUTLET_CH,
};

/** DE/EU 81 mm frames on a 71 mm pitch (data-only, approximate). */
export const DE_FRAME: PlateSystem = {
  id: 'de',
  label: 'DE/EU 81 mm frame',
  base: 81,
  pitch: 71,
  depth: 10,
  cornerR: 4,
  outlet: OUTLET_DE,
};

export function plateSpan(system: PlateSystem, modules: number): number {
  return system.base + (modules - 1) * system.pitch;
}

// ---------------------------------------------------------------------------
// Resolver constants
// ---------------------------------------------------------------------------

/** Minimum floor left under the strip indent: floorT ≥ stripDepth + MIN_FLOOR_UNDER_STRIP. */
export const MIN_FLOOR_UNDER_STRIP = 1.2;
/** Narrowest access-hole side a fingertip can use (mm). */
export const MIN_ACCESS_WIDTH = 10;
/** Corner radius of access holes (mm, clamped to half the narrow side). */
export const ACCESS_HOLE_CORNER_R = 1.5;
/** Covers larger than this (either side, mm) probably do not fit the print bed. */
export const MAX_PRINT_SIZE = 250;
/** Opening tunnels deeper than this (frontZ − plate depth, mm) may stop plugs seating. */
export const MAX_OPENING_TUNNEL = 8;
