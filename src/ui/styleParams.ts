/**
 * Turn a style's zod param schema + `ui` metadata + `limits` into a list of form controls.
 *
 * Numbers become sliders when the style supplies `ui` ranges (intersected with the schema's
 * own min/max), plain number inputs otherwise. Booleans become checkboxes, enums selects.
 * Edge-radius params (key or label mentions edge / fillet / chamfer / round) are clamped to
 * `limits.maxEdgeR`, as the contract asks the UI to do.
 */
import type { StyleLimits } from '../geometry/contract';
import type { AnyCoverStyle } from '../styles';

export type ParamControl =
  | {
      key: string;
      kind: 'number';
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      unit?: string;
      /** True when the style supplied ui metadata (rendered as a slider). */
      slider: boolean;
      /** The style limit that lowered `max`, if any. */
      clampedBy?: 'maxEdgeR';
    }
  | { key: string; kind: 'boolean'; label: string; value: boolean }
  | { key: string; kind: 'enum'; label: string; value: string; options: string[] }
  | { key: string; kind: 'unsupported'; label: string; value: unknown };

/** Param keys / labels the UI clamps to `limits.maxEdgeR`. */
export const EDGE_PARAM_RE = /edge|fillet|chamfer|round/i;

/** Minimal view of a zod 4 schema node (we only read `def`). */
interface ZodNode {
  def: { type: string; innerType?: ZodNode; in?: ZodNode; entries?: Record<string, string | number> };
  minValue?: number | null;
  maxValue?: number | null;
  isInt?: boolean;
  options?: readonly unknown[];
}

const WRAPPERS = new Set(['default', 'prefault', 'optional', 'nullable', 'catch', 'readonly', 'nonoptional']);

function unwrap(node: ZodNode): ZodNode {
  let n = node;
  for (let i = 0; i < 10; i++) {
    if (WRAPPERS.has(n.def.type) && n.def.innerType) n = n.def.innerType;
    else if (n.def.type === 'pipe' && n.def.in) n = n.def.in;
    else break;
  }
  return n;
}

export function humanize(key: string): string {
  const s = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e12;

export function describeStyleParams(
  style: AnyCoverStyle,
  params: Record<string, unknown>,
  limits: StyleLimits,
): ParamControl[] {
  const shape = (style.params as unknown as { shape: Record<string, ZodNode> }).shape ?? {};
  const ui = (style.ui ?? {}) as Record<string, { label: string; min: number; max: number; step: number; unit?: string } | undefined>;
  const controls: ParamControl[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    const node = unwrap(raw);
    const meta = ui[key];
    const label = meta?.label ?? humanize(key);
    const value = params[key];
    switch (node.def.type) {
      case 'number': {
        const schemaMin = finite(node.minValue) ? node.minValue : undefined;
        const schemaMax = finite(node.maxValue) ? node.maxValue : undefined;
        let min = Math.max(meta?.min ?? -Infinity, schemaMin ?? -Infinity);
        let max = Math.min(meta?.max ?? Infinity, schemaMax ?? Infinity);
        if (!Number.isFinite(min)) min = Math.min(0, typeof value === 'number' ? value : 0);
        if (!Number.isFinite(max)) max = Math.max(min + 100, typeof value === 'number' ? value * 4 : 0);
        let clampedBy: 'maxEdgeR' | undefined;
        if ((EDGE_PARAM_RE.test(key) || EDGE_PARAM_RE.test(label)) && Number.isFinite(limits.maxEdgeR) && limits.maxEdgeR < max) {
          max = Math.max(min, limits.maxEdgeR);
          clampedBy = 'maxEdgeR';
        }
        const step = meta?.step ?? (node.isInt ? 1 : 0.1);
        controls.push({
          key,
          kind: 'number',
          label,
          value: typeof value === 'number' ? value : min,
          min,
          max,
          step,
          unit: meta?.unit,
          slider: !!meta,
          clampedBy,
        });
        break;
      }
      case 'boolean':
        controls.push({ key, kind: 'boolean', label, value: value === true });
        break;
      case 'enum': {
        const options = (node.options ?? Object.values(node.def.entries ?? {})).map(String);
        controls.push({ key, kind: 'enum', label, value: String(value ?? options[0] ?? ''), options });
        break;
      }
      default:
        controls.push({ key, kind: 'unsupported', label, value });
    }
  }
  return controls;
}

/** Clamp a number control's value into its (possibly limit-clamped) range. */
export function clampControl(c: Extract<ParamControl, { kind: 'number' }>, v: number): number {
  return Math.min(c.max, Math.max(c.min, v));
}
