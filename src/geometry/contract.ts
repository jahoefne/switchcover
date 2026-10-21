/**
 * switchcover geometry contracts.
 *
 * This file is the single source of truth for the data that flows between
 * config → layout (resolveLayout) → geometry (kit, features, styles) → worker → UI.
 * Phase 1 work packages code against these types; change them only with care.
 *
 * Conventions (identical everywhere, see README "Coordinate conventions"):
 *  - Units are millimetres, angles are degrees.
 *  - X right, Y up along the wall, Z out of the wall. Origin = plate centre on the wall.
 *  - The cover occupies z ∈ [0, frontZ]; z = 0 is the glued base on the wall.
 *  - Rotations are counter-clockwise about +Z.
 *  - Shapes are centred on their Placed (x, y) and, unrotated, their `h` runs along Y.
 *
 * Deviations from the plan's contract sketch (all additive; nothing was removed or renamed):
 *  - `ResolvedFeature` 'opening' carries `role` ('outlet' | 'passthrough') and `anchor`,
 *    so features can treat outlets (styled edge) and passthroughs (plain cut) differently.
 *  - `CoverFrame.plate` also carries `cornerR` and `clearance` (needed for the plate
 *    collision box); `CoverFrame.outer` carries `autoW`/`autoH` (the automatic size, which
 *    is the lower bound for a manual size); `CoverFrame.floorT` is the effective
 *    (possibly clamped) floor thickness under every pocket.
 *  - `Warning` has an optional `featureId` so the UI can point at the offending module.
 *  - `Kit.ring` accepts an optional `segments` override so callers can force identical
 *    sample counts across rings (loft does this internally).
 *  - Named helper types for things the sketch wrote inline: `StyleLimits` (return of
 *    `CoverStyle.limits`), `LoftSlice`, `FeatureParts`, `Quality`, `BuildKind`, `Severity`,
 *    `BilresaVariant`, and the protocol messages `BuildRequest` / `BuildResult` /
 *    `BuildError` / `BuildResponse` (+ `isBuildError`).
 *  - `CoverStyle`'s schema bound is `z.ZodObject` (zod 4's default generics, which accept
 *    any concrete object schema incl. strict ones) instead of `z.ZodObject<any>`.
 *  - WP1 (additive): `BuildRequest.featureId` picks the pocket of a 'testFit' build.
 *
 * Phase 2 (integration):
 *  - `StyleLimits` gains optional `edgeAllowance` / `pocketEdgeAllowance` (room the style's
 *    edge treatments need beyond a feature outline; the resolver spaces features and sizes the
 *    frame with it), `cornerR` (desired outer corner radius; the resolver sets
 *    `frame.outer.cornerR` from it and grows the frame just enough for the plate to fit the
 *    cavity's rounded corner) and `edgeInset` (the style's edge profile, inverted, so the
 *    resolver keeps the plate under the part of the face that is high enough).
 *  - SEMANTIC CHANGE: `StyleLimits.minFrame` now applies to pocket/opening outlines only, no
 *    longer to the plate. Phase 1 styles used it to buy a corner radius (minFrame ≥ cornerR −
 *    plate.cornerR − clearance), which grew every cover; `cornerR` replaces that, `edgeInset`
 *    replaces the plate protection it gave to deep edge profiles.
 *  - `CoverStyle.ui` entries are a union: numbers (`kind` omitted or 'number', optional
 *    `clampTo: 'maxEdgeR'`) and booleans (`kind: 'boolean'`). See `StyleParamUi`.
 */
import type { z } from 'zod';
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { CoverConfig } from '../config/schema';

// ---------------------------------------------------------------------------
// Basic vectors (tuples, so they can be handed to manifold-3d unchanged)
// ---------------------------------------------------------------------------

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// 2D shapes
// ---------------------------------------------------------------------------

/**
 * A convex 2D outline, centred on the origin, unrotated.
 *  - circle: diameter `d`.
 *  - roundedRect: `w` along X, `h` along Y, corner radius `r` (clamped to min(w, h)/2).
 *  - stadium: `w` × `h`, end radius = min(w, h)/2 (a Bilresa outline is a stadium with
 *    the long axis along Y, i.e. h > w).
 */
export type Shape2D =
  | { kind: 'circle'; d: number }
  | { kind: 'roundedRect'; w: number; h: number; r: number }
  | { kind: 'stadium'; w: number; h: number };

/** A shape placed on the wall plane: centre (x, y) and CCW rotation about +Z. */
export interface Placed {
  shape: Shape2D;
  x: number;
  y: number;
  rotDeg: number;
}

/**
 * Edge treatment where a cut meets the face (opening edges, pocket rims).
 * Styles return this as DATA; WP1's features turn it into cutting tools via `kit.edgeTool`.
 *  - sharp: straight wall.
 *  - chamfer: 45° chamfer of `size` mm (size 0 ≡ sharp).
 *  - fillet: quarter-round of radius `r`.
 *  - flare: elliptical trumpet, `r` mm wider at the face, blending out over `depth` mm.
 *  - step: counterbore widened by `inset` mm for `depth` mm below the face.
 */
export type EdgeProfile =
  | { kind: 'sharp' }
  | { kind: 'chamfer'; size: number }
  | { kind: 'fillet'; r: number }
  | { kind: 'flare'; r: number; depth: number }
  | { kind: 'step'; inset: number; depth: number };

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export type Severity = 'info' | 'warning' | 'error';

/**
 * A user-facing diagnostic. `code` is a stable kebab-case identifier (resolve.ts exports
 * the codes it emits as `WARNING_CODES`); `message` is human-readable English.
 */
export interface Warning {
  code: string;
  message: string;
  severity: Severity;
  /** Feature id (see ResolvedFeature.id) this warning refers to, if any. */
  featureId?: string;
}

// ---------------------------------------------------------------------------
// Resolved layout (output of resolveLayout, input of every geometry stage)
// ---------------------------------------------------------------------------

export type BilresaVariant = '2button' | 'wheel';

export type ResolvedFeature =
  | {
      kind: 'pocket';
      /** Stable id, e.g. "c0r1" (column 0, row 1). */
      id: string;
      /** Physical rocker/socket centre on the grid (never moves). */
      anchor: Vec2;
      /** Pocket void outline (Bilresa outline + pocketClearance) incl. dx/dy and spreading. */
      placed: Placed;
      variant: BilresaVariant;
      /** Z of the pocket floor's top surface (where the Bilresa's back rests). */
      floorZ: number;
      /** Strip indent outline (strip + print tolerance), in world coordinates. */
      strip: Placed;
      /** Depth of the strip indent below floorZ (strip protrusion + print tolerance). */
      stripDepth: number;
      /** Access holes through the floor (0–2 rounded rects), hidden under the Bilresa. */
      holes: Placed[];
      /** Finger notch (circle) centred on the pocket's far end, floor → face. */
      notch?: Placed;
    }
  | {
      kind: 'opening';
      id: string;
      /** 'outlet' gets the style's opening edge; 'passthrough' is a plain cut. */
      role: 'outlet' | 'passthrough';
      anchor: Vec2;
      /** Opening outline at its narrowest (the through-hole), incl. dx/dy. */
      placed: Placed;
    };

export interface CoverFrame {
  /** Cover outline: rounded rect of w × h centred on (cx, cy) with corner radius cornerR. */
  outer: {
    w: number;
    h: number;
    cx: number;
    cy: number;
    cornerR: number;
    /** Automatic size (lower bound for cover.size = {w, h}). */
    autoW: number;
    autoH: number;
  };
  /** The existing plate on the wall: w × h, protruding `protrusion` mm (= config plate.depth). */
  plate: { w: number; h: number; protrusion: number; cornerR: number; clearance: number };
  /** Z of the (flat) face. Styles may raise the local face via surfaceZ (dome). */
  frontZ: number;
  /** Face (skin) thickness above the hollow cavity. */
  skinT: number;
  /** Side wall (skirt) thickness around the cavity. */
  skirtT: number;
  /** Minimum wall between pockets / openings. */
  minWall: number;
  /** Effective pocket floor thickness (config value, clamped to ≥ stripDepth + 1.2). */
  floorT: number;
  features: ResolvedFeature[];
  warnings: Warning[];
}

// ---------------------------------------------------------------------------
// Geometry kit (implemented in src/geometry/kit/kit.ts)
// ---------------------------------------------------------------------------

export type Quality = 'preview' | 'export';

/** One loft slice: height z and OUTWARD offset (mm) of the outline at that height. */
export interface LoftSlice {
  z: number;
  offset: number;
}

export interface Kit {
  wasm: ManifoldToplevel;
  quality: Quality;
  /**
   * Register a WASM object with the active scope (see kit/scope.ts). All Manifold and
   * CrossSection objects are tracked automatically once `initManifold` ran; keep() is
   * idempotent and returns its argument so it can wrap expressions.
   */
  keep<T extends { delete(): void }>(o: T): T;
  /** Circular segment count for radius r (multiple of 4) under the current quality. */
  segments(r: number): number;
  /** CrossSection of a placed shape (rotated + translated). */
  cross(p: Placed): CrossSection;
  /** Convex hull of points. */
  hull(pts: Vec3[]): Manifold;
  /**
   * Outline points of `p` offset INWARD by `inset` (negative = outward) at height z, CCW.
   * Arc sampling depends only on the shape and `segments` (if given), so rings of the same
   * shape at different insets line up.
   */
  ring(p: Placed, inset: number, z: number, segments?: number): Vec3[];
  /** Union of pairwise hulls of consecutive slices (z strictly increasing, ≥ 2 slices). */
  loft(p: Placed, slices: LoftSlice[]): Manifold;
  /**
   * Cutting tool for an opening of outline `p` whose face is at `zTop` and which goes
   * `through` mm deep, with `edge` applied at the face. Circles are revolved, other shapes
   * lofted. The tool overshoots both the face and the bottom by 0.1 mm.
   */
  edgeTool(p: Placed, zTop: number, edge: EdgeProfile, through: number): Manifold;
  /** Straight extrusion of `p` from z0 to z1 (no implicit overshoot). */
  prism(p: Placed, z0: number, z1: number): Manifold;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export interface StyleCtx<P> {
  frame: CoverFrame;
  params: P;
  kit: Kit;
}

export interface StyleLimits {
  /**
   * Minimum frame width (mm): the resolver keeps at least this much between the outer edge
   * and every pocket/opening outline (plus the feature's edge allowance, below). It does NOT
   * apply to the plate (Phase 2); see `cornerR` and `edgeInset` for what the plate needs.
   */
  minFrame: number;
  /** Minimum frontZ the style needs (e.g. for tiers); the resolver raises frontZ to it. */
  minFrontZ: number;
  /** Largest edge radius the style can honour; the UI clamps sliders tagged `clampTo: 'maxEdgeR'` to it. */
  maxEdgeR: number;
  /**
   * How far (mm) the style's edge treatment widens an OUTLET opening at the face beyond its
   * outline (flare radius, chamfer size, step inset). Default 0. The resolver keeps
   * minWall + allowance(a) + allowance(b) between two features (automatic spreading moves
   * pockets until it holds) and the allowance inside the frame, so full-size edges fit.
   */
  edgeAllowance?: number;
  /** Same for pocket rims (and their finger notches). Default: `edgeAllowance`. */
  pocketEdgeAllowance?: number;
  /**
   * Desired outer corner radius (mm). The resolver sets `frame.outer.cornerR` to it, clamped to
   * ≥ plate.cornerR + clearance + skirtT and ≤ half the smaller side, and widens the frame just
   * enough for the plate (+clearance) to fit inside the cavity's rounded corner. Default: the
   * plate's corner radius + clearance + skirtT (concentric with the plate).
   */
  cornerR?: number;
  /**
   * The style's edge profile, inverted: the smallest inset (mm, from the outer edge) beyond which
   * the outer surface lies at most `drop` mm below frontZ. The resolver keeps the plate
   * (+clearance) at least `edgeInset(frontZ − zClear − skinT − skirtT)` inside the outer edge
   * (zClear: plate top + clearance, or the pocket floors' underside if higher), so a deep bevel,
   * fillet or tier never comes closer to the plate than the walls. Omit it when the edge never
   * drops that far (flat or lightly chamfered styles).
   */
  edgeInset?(drop: number): number;
}

/** UI metadata of a number param: slider range (intersected with the schema's own bounds). */
export interface NumberParamUi {
  /** Optional; omitted means 'number'. */
  kind?: 'number';
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Lower the slider max to this style limit (e.g. an edge radius limited by the corner radius). */
  clampTo?: 'maxEdgeR';
}

/** UI metadata of a boolean param (a checkbox). */
export interface BooleanParamUi {
  kind: 'boolean';
  label: string;
}

export type StyleParamUi = NumberParamUi | BooleanParamUi;

/**
 * A cover style plugin. Register it in src/styles/index.ts.
 *
 * `S` is the zod schema of the style's params; `P` the parsed params type.
 */
export interface CoverStyle<S extends z.ZodObject, P = z.infer<S>> {
  id: string;
  version: number;
  label: string;
  description: string;
  /** Param schema. Every field must have a default so `params.parse({})` yields defaults. */
  params: S;
  migrate?(old: unknown, from: number): unknown;
  /** Form metadata per param (labels, slider ranges, limit clamps); params without it get defaults. */
  ui?: Partial<Record<keyof P, StyleParamUi>>;
  printOrientation: 'faceDown' | 'faceUp';
  printHint: string;
  /** Clamps sliders and feeds resolveLayout(config, { limits }). */
  limits(p: P, plate: CoverFrame['plate']): StyleLimits;
  /** Local face height (dome); pockets/flares are placed relative to it. */
  surfaceZ(c: StyleCtx<P>, x: number, y: number): number;
  /** The solid outer body; flat base exactly at z = 0. */
  outerBody(c: StyleCtx<P>): Manifold;
  decorate?(c: StyleCtx<P>): { add?: Manifold; subtract?: Manifold };
  /** Edge profile for outlet openings (styles return DATA; WP1's features build the tools). */
  openingEdge(c: StyleCtx<P>, f: ResolvedFeature): EdgeProfile;
  pocketEdge?(c: StyleCtx<P>, f: ResolvedFeature): EdgeProfile;
}

/**
 * Features: (kit, frame, f, style) => { add?: Manifold[]; subtract?: Manifold[] }.
 * Test-fit reuses the pocket feature. Implemented by WP1 in src/geometry/features/.
 */
export interface FeatureParts {
  add?: Manifold[];
  subtract?: Manifold[];
}

// ---------------------------------------------------------------------------
// Worker protocol (src/worker/geometry.worker.ts ⇄ src/worker/client.ts)
// ---------------------------------------------------------------------------

export type BuildKind = 'build' | 'export' | 'testFit';

export interface BuildRequest {
  id: number;
  kind: BuildKind;
  config: CoverConfig;
  quality: Quality;
  /** 'testFit' only: id of the pocket to print (default: the first pocket). */
  featureId?: string;
}

export interface BuildStats {
  /** Wall-clock build time inside the worker (ms). */
  ms: number;
  tris: number;
  /** mm³ */
  volume: number;
  genus: number;
}

/** Successful build. `positions`/`indices` (and `stl`) are transferred, not copied. */
export interface BuildResult {
  id: number;
  /** xyz per vertex. */
  positions: Float32Array;
  /** Three vertex indices per triangle, CCW seen from outside. */
  indices: Uint32Array;
  frame: CoverFrame;
  stats: BuildStats;
  /** Binary STL, only for kind 'export' / 'testFit'. */
  stl?: ArrayBuffer;
}

export interface BuildError {
  id: number;
  error: string;
}

export type BuildResponse = BuildResult | BuildError;

export function isBuildError(r: BuildResponse): r is BuildError {
  return 'error' in r;
}
