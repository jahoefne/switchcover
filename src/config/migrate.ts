/**
 * Turn any parsed JSON value into a valid CoverConfig, never throwing.
 *
 *  - v1 is first migrated to v2 (v1ToV2, below).
 *  - v2: missing fields are filled from DEFAULT_CONFIG, then zod-validated. Invalid modules
 *    are dropped and invalid sections reset to their defaults (with a warning each), so a
 *    single bad value does not throw away a whole shared layout.
 *  - Unknown / newer versions or garbage: DEFAULT_CONFIG + warning.
 *
 * Future versions add `if (v === 2) raw = v2ToV3(raw)` steps before validation.
 */
import type { Warning } from '../geometry/contract';
import { DEFAULT_BILRESA, MIN_POCKET_DEPTH } from './defaults';
import { CONFIG_VERSION, CoverConfigSchema, DEFAULT_CONFIG, cloneConfig, type CoverConfig } from './schema';

export interface MigrateResult {
  config: CoverConfig;
  warnings: Warning[];
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Recursively fill keys missing in `value` from `defaults`. Arrays are taken as-is. */
function fillDefaults(value: unknown, defaults: unknown): unknown {
  if (!isObject(defaults)) return value === undefined ? defaults : value;
  if (!isObject(value)) return value === undefined ? structuredClone(defaults) : value;
  const out: Json = { ...value };
  for (const [k, d] of Object.entries(defaults)) out[k] = fillDefaults(value[k], d);
  return out;
}

const MODULE_DEFAULTS = { rot: 0, dx: 0, dy: 0 };

/** The v1 magnet-strip placeholder (never measured); v1 configs still carrying it get the real strip. */
export const V1_STRIP_PLACEHOLDER = { shape: 'stadium', l: 44, w: 7, protrusion: 1, dx: 0, dy: 0 } as const;

const sameStrip = (a: Json, b: Record<string, unknown>) =>
  Object.keys(b).length === Object.keys(a).length && Object.entries(b).every(([k, v]) => a[k] === v);

/**
 * v1 → v2 (Bilresa orientation rework). Pure data rewrite, before defaults are filled in:
 *  - bilresa.stripMargin (keep-out around a strip island) → bilresa.stripLedge = 4 (the strip
 *    now spans one access hole and rests on two end ledges; the old value has no meaning there);
 *  - bilresa.access {w, h} → {w} (the hole length follows the strip);
 *  - bilresa.strip: the old 44 × 7 placeholder becomes the measured strip (DEFAULT_BILRESA.strip);
 *    any other (user-entered) strip is kept;
 *  - pocketDepth (global, per module) below MIN_POCKET_DEPTH is raised to it (info warning),
 *    because the nested pocket needs the Bilresa's 8 mm back fillet.
 */
export function v1ToV2(raw: Json): { raw: Json; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const out: Json = { ...raw, v: 2 };
  let raised = 0;
  const clampDepth = (d: unknown) => {
    if (typeof d === 'number' && d < MIN_POCKET_DEPTH) {
      raised++;
      return MIN_POCKET_DEPTH;
    }
    return d;
  };
  if (isObject(raw.bilresa)) {
    const b: Json = { ...raw.bilresa };
    delete b.stripMargin;
    b.stripLedge = DEFAULT_BILRESA.stripLedge;
    if (isObject(b.access)) b.access = 'w' in b.access ? { w: b.access.w } : {};
    if (isObject(b.strip)) {
      const filled: Json = { ...V1_STRIP_PLACEHOLDER, ...b.strip };
      b.strip = sameStrip(filled, V1_STRIP_PLACEHOLDER) ? { ...DEFAULT_BILRESA.strip } : filled;
    }
    if ('pocketDepth' in b) b.pocketDepth = clampDepth(b.pocketDepth);
    out.bilresa = b;
  }
  if (Array.isArray(raw.modules)) {
    out.modules = raw.modules.map((m) => {
      if (!isObject(m) || !isObject(m.bilresa) || !('pocketDepth' in m.bilresa)) return m;
      return { ...m, bilresa: { ...m.bilresa, pocketDepth: clampDepth(m.bilresa.pocketDepth) } };
    });
  }
  if (raised > 0) {
    warnings.push({
      code: 'config-migrated',
      severity: 'info',
      message: `Pocket depths below ${MIN_POCKET_DEPTH} mm were raised to ${MIN_POCKET_DEPTH} mm (the pocket now follows the Bilresa's rounded back).`,
    });
  }
  return { raw: out, warnings };
}

function fallback(message: string): MigrateResult {
  return {
    config: cloneConfig(DEFAULT_CONFIG),
    warnings: [{ code: 'config-invalid', severity: 'warning', message }],
  };
}

export function migrateConfig(input: unknown): MigrateResult {
  if (!isObject(input)) return fallback('Configuration is not an object; using the default layout.');
  const v = input.v;
  if (typeof v !== 'number') return fallback('Configuration has no version; using the default layout.');
  if (v > CONFIG_VERSION) {
    return fallback(`Configuration version ${v} is newer than this app (v${CONFIG_VERSION}); using the default layout.`);
  }
  const migrated: Warning[] = [];
  let raw: Json = input;
  if (v === 1) {
    const step = v1ToV2(raw);
    raw = step.raw;
    migrated.push(...step.warnings);
  } else if (v !== CONFIG_VERSION) {
    return fallback(`Unknown configuration version ${v}; using the default layout.`);
  }

  const filled = fillDefaults(raw, DEFAULT_CONFIG) as Json;
  // Fill per-module defaults (rot/dx/dy) – modules is an array, so fillDefaults keeps it as-is.
  if (Array.isArray(filled.modules)) {
    filled.modules = filled.modules.map((m) => (isObject(m) ? { ...MODULE_DEFAULTS, ...m } : m));
  }

  const first = CoverConfigSchema.safeParse(filled);
  if (first.success) return { config: first.data, warnings: migrated };

  // Repair: drop broken modules, reset other broken sections to defaults.
  const warnings: Warning[] = [...migrated];
  const badModules = new Set<number>();
  const badSections = new Set<string>();
  for (const issue of first.error.issues) {
    const [section, index] = issue.path;
    if (section === 'modules' && typeof index === 'number') badModules.add(index);
    else if (typeof section === 'string') badSections.add(section);
    else badSections.add('*');
  }
  if (badSections.has('*') || badSections.has('v')) {
    return fallback('Configuration could not be read; using the default layout.');
  }
  const repaired: Json = { ...filled };
  if (badModules.size > 0 && Array.isArray(repaired.modules)) {
    repaired.modules = repaired.modules.filter((_, i) => !badModules.has(i));
    warnings.push({
      code: 'config-repaired',
      severity: 'warning',
      message: `Dropped ${badModules.size} invalid module(s) from the configuration.`,
    });
  }
  for (const section of badSections) {
    if (!(section in DEFAULT_CONFIG)) continue;
    repaired[section] = structuredClone(DEFAULT_CONFIG[section as keyof CoverConfig]);
    warnings.push({
      code: 'config-repaired',
      severity: 'warning',
      message: `Invalid "${section}" settings were reset to defaults.`,
    });
  }
  const second = CoverConfigSchema.safeParse(repaired);
  if (second.success) return { config: second.data, warnings };
  return fallback('Configuration could not be repaired; using the default layout.');
}
