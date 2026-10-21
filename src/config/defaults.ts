/**
 * Physical reference data and default parameters. This is the ONE place to correct
 * measurements (Bilresa outline, magnet strip, plate systems, clearances).
 *
 * Only type imports from schema.ts are allowed here (schema.ts imports these values).
 */
import type { BilresaSettings, CoverSettings, OpeningSpec, PrintSettings } from './schema';
import type { BilresaVariant, Shape2D } from '../geometry/contract';

// ---------------------------------------------------------------------------
// IKEA Bilresa, measured from model/*.stl (long axis along Y, XY-centred). In the STLs the
// flat z = 0 face (full stadium outline, the two button pockets) is the FRONT. The body keeps
// its full outline for 10 mm, then rounds off with an exact R8 quarter round into the flat
// BACK at z = −18.5, i.e. at height h above the back flat the outline is inset by
//     backFilletInset(h) = R − √(R² − (R − h)²)      (R = backFilletR, 0 ≤ h ≤ R).
// On the back flat sits a 1 mm proud stadium rim (outer 22 × 52 (y from −25.4 to +26.0) along
// Y): the recess of IKEA's glue-on metal strip, which fills it and stands ≈ 1 mm proud.
// The Bilresa sits back-first in its pocket: back flat on the pocket floor, front outwards.
// ---------------------------------------------------------------------------

export interface BilresaVariantDef {
  label: string;
  /** Plan outline of the device body at the front (long axis along Y). */
  outline: Extract<Shape2D, { kind: 'stadium' }>;
  /** Body depth from the back flat to the front face (mm), without the strip rim. */
  depth: number;
  /** Flat area on the back (w × h, mm) = outline inset by backFilletR. */
  backFlat: { w: number; h: number };
  /** Radius of the quarter round between the side wall and the back flat (mm). */
  backFilletR: number;
  /** Height of the strip-recess rim on the back flat (mm); the metal strip fills it. */
  stripRim: number;
  /** Reference model served from public/ (prefix with import.meta.env.BASE_URL). */
  model: string;
}

export const BILRESA_VARIANTS: Record<BilresaVariant, BilresaVariantDef> = {
  '2button': {
    label: 'Bilresa — two buttons',
    outline: { kind: 'stadium', w: 40, h: 70 },
    depth: 18.5,
    backFlat: { w: 24, h: 54 },
    backFilletR: 8,
    stripRim: 1,
    model: 'models/Bilresa_twobutton.stl',
  },
  wheel: {
    label: 'Bilresa — scroll wheel',
    outline: { kind: 'stadium', w: 45, h: 70 },
    depth: 18.5,
    backFlat: { w: 29, h: 54 },
    backFilletR: 8,
    stripRim: 1,
    model: 'models/Bilresa_scrollwheel.stl',
  },
};

/** Inward offset of a Bilresa's outline at height h above its back flat (exact quarter round of radius r). */
export function backFilletInset(r: number, h: number): number {
  if (!(r > 0) || h >= r) return 0;
  if (h <= 0) return r;
  return r - Math.sqrt(r * r - (r - h) * (r - h));
}

/** Shallowest pocket: the 8 mm back fillet + 0.5 mm of straight wall. */
export const MIN_POCKET_DEPTH = 8.5;

// ---------------------------------------------------------------------------
// Pocket / Bilresa seat defaults
// ---------------------------------------------------------------------------

export const DEFAULT_BILRESA: BilresaSettings = {
  /**
   * Pocket depth below the face: the nested pocket follows the 8 mm back fillet, then has
   * 2 mm of straight wall. The Bilresa stands 18.5 − depth proud of the face.
   */
  pocketDepth: 10,
  /** Gap between the Bilresa and the pocket wall, per side (horizontal, also along the fillet). */
  pocketClearance: 0.3,
  /** Pocket floor thickness (clamped to ≥ stripDepth + 1.2 by the resolver). */
  floorT: 2.4,
  /** The access hole stays this far inside the pocket outline (hidden by the Bilresa). */
  hiddenMargin: 3,
  /** Finger notch at the pocket's far end from the plate centre (exposes the Bilresa's rounded edge). */
  notch: { enabled: true, d: 14 },
  /** Access (bridge) hole width across the Bilresa, centred on the pocket. */
  access: { w: 34 },
  /**
   * IKEA's glue-on metal strip (user-confirmed 2026-10-21): it fills the ≈ 22 × 51–52 mm stadium (the indentation uses 52, the rim length, so the model and the strip both fit)
   * recess on the Bilresa's back and stands ≈ 1.0 mm proud. The pocket floor gets an indent
   * of strip + 2 · print.tolerance, protrusion + tolerance deep.
   */
  strip: { shape: 'stadium', l: 52, w: 22, protrusion: 1.0, dx: 0, dy: 0 },
  /**
   * Length of floor (mm) the strip rests on at each end. The strip is glued onto these two
   * ledges and spans the access hole between them (hole length = strip length − 2 · ledge).
   */
  stripLedge: 4,
};

export const DEFAULT_COVER: CoverSettings = {
  style: 'minimal',
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
/** Below this width (mm) the access gaps beside the strip get an info note (tool, not fingertip). */
export const MIN_ACCESS_GAP = 8;
/** Corner radius of access holes (mm, clamped to half the narrow side). */
export const ACCESS_HOLE_CORNER_R = 1.5;
/** The finger notch stops this far (mm) above the pocket floor (it must not cut the floor). */
export const NOTCH_FLOOR_LIFT = 2;
/** Covers larger than this (either side, mm) probably do not fit the print bed. */
export const MAX_PRINT_SIZE = 250;
/** Opening tunnels deeper than this (frontZ − plate depth, mm) may stop plugs seating. */
export const MAX_OPENING_TUNNEL = 15;
