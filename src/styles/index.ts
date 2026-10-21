/**
 * Style registry. To add a style: create src/styles/<id>/index.ts exporting a
 * CoverStyle, import it here and append it to STYLES (keep the default first).
 */
import type { z } from 'zod';
import type { CoverStyle, Warning } from '../geometry/contract';
import { boxStyle } from './box';
import { facetedStyle } from './faceted';
import { organicStyle } from './organic';
import { steppedStyle } from './stepped';

/**
 * A registered style with its params erased to a plain record. (Methods are bivariant in
 * their parameters, so any concrete CoverStyle<S> is assignable.)
 */
export type AnyCoverStyle = CoverStyle<z.ZodObject, Record<string, unknown>>;

const STYLES: readonly AnyCoverStyle[] = [
  boxStyle,
  organicStyle,
  facetedStyle,
  steppedStyle,
];

export const DEFAULT_STYLE_ID = 'box';

export function listStyles(): readonly AnyCoverStyle[] {
  return STYLES;
}

export function getStyle(id: string): AnyCoverStyle | undefined {
  return STYLES.find((s) => s.id === id);
}

/** Look up a style, falling back to the default style with a warning. */
export function resolveStyle(id: string): { style: AnyCoverStyle; warnings: Warning[] } {
  const style = getStyle(id);
  if (style) return { style, warnings: [] };
  const fallback = getStyle(DEFAULT_STYLE_ID);
  if (!fallback) throw new Error(`default style "${DEFAULT_STYLE_ID}" is not registered`);
  return {
    style: fallback,
    warnings: [
      {
        code: 'style-unknown',
        severity: 'warning',
        message: `Unknown style "${id}"; using "${fallback.label}".`,
      },
    ],
  };
}

/** Validate raw style params with the style's schema; invalid → schema defaults + warning. */
export function parseStyleParams(
  style: AnyCoverStyle,
  raw: unknown,
): { params: Record<string, unknown>; warnings: Warning[] } {
  const parsed = style.params.safeParse(raw ?? {});
  if (parsed.success) return { params: parsed.data as Record<string, unknown>, warnings: [] };
  return {
    params: style.params.parse({}) as Record<string, unknown>,
    warnings: [
      {
        code: 'style-params-invalid',
        severity: 'warning',
        message: `Invalid parameters for style "${style.label}" were reset to defaults.`,
      },
    ],
  };
}
