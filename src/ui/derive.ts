/**
 * Pure helpers that turn a CoverConfig into the numbers the UI shows. Everything here runs
 * on the main thread on every edit (resolveLayout is pure TS and cheap).
 */
import { BILRESA_VARIANTS, OUTLET_CH, OUTLET_DE } from '../config/defaults';
import type { CoverConfig, OpeningSpec } from '../config/schema';
import type { CoverFrame, StyleLimits, Warning } from '../geometry/contract';
import { resolveLayout } from '../layout/resolve';
import { parseStyleParams, resolveStyle, stylePrintOrientation, type AnyCoverStyle } from '../styles';

export interface Derived {
  style: AnyCoverStyle;
  /** Style params parsed with the style's schema (defaults filled in). */
  params: Record<string, unknown>;
  limits: StyleLimits;
  /** Live layout; `warnings` include style / style-param warnings. */
  frame: CoverFrame;
}

/** Same chain as the worker's buildCover: style → params → limits → resolveLayout. */
export function deriveFrame(config: CoverConfig): Derived {
  const { style, warnings: styleWarnings } = resolveStyle(config.cover.style);
  const { params, warnings: paramWarnings } = parseStyleParams(style, config.cover.styleParams);
  const plate: CoverFrame['plate'] = {
    w: config.plate.w,
    h: config.plate.h,
    protrusion: config.plate.depth,
    cornerR: config.plate.cornerR,
    clearance: config.cover.clearance,
  };
  const limits = style.limits(params, plate);
  const resolved = resolveLayout(config, { limits, allowsNotchInEdge: style.allowsNotchInEdge });
  return {
    style,
    params,
    limits,
    frame: { ...resolved, warnings: [...styleWarnings, ...paramWarnings, ...resolved.warnings] },
  };
}

export interface HeightSummary {
  /** Face height above the wall. */
  frontZ: number;
  /** Highest point incl. the Bilresa standing in its pocket. */
  total: number;
  /** How far the Bilresa stands proud of the face (0 without pockets). */
  proud: number;
}

export function heightSummary(frame: CoverFrame): HeightSummary {
  let total = frame.frontZ;
  for (const f of frame.features) {
    if (f.kind === 'pocket') total = Math.max(total, f.floorZ + BILRESA_VARIANTS[f.variant].depth);
  }
  return { frontZ: frame.frontZ, total, proud: Math.max(0, total - frame.frontZ) };
}

/** The orientation an export would use: config.print.orientation, 'style' → the style's default for `params`. */
export function effectiveOrientation(config: CoverConfig, style: AnyCoverStyle, params: Record<string, unknown>): 'faceDown' | 'faceUp' {
  return config.print.orientation === 'style' ? stylePrintOrientation(style, params) : config.print.orientation;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';

export function stlFilename(config: CoverConfig, kind: 'export' | 'testFit'): string {
  const base = `switchcover-${slug(config.plate.preset)}-${slug(config.cover.style)}`;
  return kind === 'testFit' ? `${base}-testfit.stl` : `${base}.stl`;
}

/**
 * Where the cover's centre sits relative to the plate centre, in words ("" when centred): the
 * automatic outline grows only where something needs room, so it can be off-centre.
 */
export function outlineOffsetText(outer: Pick<CoverFrame['outer'], 'cx' | 'cy'>): string {
  const parts: string[] = [];
  if (Math.abs(outer.cy) >= 0.05) parts.push(`${fmt(Math.abs(outer.cy))} mm ${outer.cy > 0 ? 'above' : 'below'}`);
  if (Math.abs(outer.cx) >= 0.05) parts.push(`${fmt(Math.abs(outer.cx))} mm ${outer.cx > 0 ? 'right of' : 'left of'}`);
  if (parts.length === 0) return '';
  return `centred ${parts.join(' and ')} the plate centre`;
}

/** Outlet opening matching the plate system (DE presets get the Schuko size). */
export function defaultOutlet(config: CoverConfig): OpeningSpec {
  return { ...(config.plate.preset.startsWith('de-') ? OUTLET_DE : OUTLET_CH) };
}

/** Parse a feature id like "c0r1" back into a grid cell. */
export function parseFeatureId(id: string | undefined): { col: number; row: number } | null {
  const m = id ? /^c(\d+)r(\d+)$/.exec(id) : null;
  return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
}

/** Merge warning lists, dropping exact duplicates (same code, message and feature). */
export function mergeWarnings(...lists: Warning[][]): Warning[] {
  const seen = new Set<string>();
  const out: Warning[] = [];
  for (const list of lists) {
    for (const w of list) {
      const key = `${w.code}|${w.featureId ?? ''}|${w.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
  }
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Format a number with at most `digits` decimals (trailing zeros dropped). */
export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '–';
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return (r === 0 ? 0 : r).toString();
}
