/**
 * Turn any parsed JSON value into a valid CoverConfig, never throwing.
 *
 *  - v1: missing fields are filled from DEFAULT_CONFIG, then zod-validated. Invalid modules
 *    are dropped and invalid sections reset to their defaults (with a warning each), so a
 *    single bad value does not throw away a whole shared layout.
 *  - Unknown / newer versions or garbage: DEFAULT_CONFIG + warning.
 *
 * Future versions add `if (v === 1) raw = v1ToV2(raw)` steps before validation.
 */
import type { Warning } from '../geometry/contract';
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

function fallback(message: string): MigrateResult {
  return {
    config: cloneConfig(DEFAULT_CONFIG),
    warnings: [{ code: 'config-invalid', severity: 'warning', message }],
  };
}

export function migrateConfig(raw: unknown): MigrateResult {
  if (!isObject(raw)) return fallback('Configuration is not an object; using the default layout.');
  const v = raw.v;
  if (typeof v !== 'number') return fallback('Configuration has no version; using the default layout.');
  if (v > CONFIG_VERSION) {
    return fallback(`Configuration version ${v} is newer than this app (v${CONFIG_VERSION}); using the default layout.`);
  }
  if (v !== CONFIG_VERSION) return fallback(`Unknown configuration version ${v}; using the default layout.`);

  const filled = fillDefaults(raw, DEFAULT_CONFIG) as Json;
  // Fill per-module defaults (rot/dx/dy) – modules is an array, so fillDefaults keeps it as-is.
  if (Array.isArray(filled.modules)) {
    filled.modules = filled.modules.map((m) => (isObject(m) ? { ...MODULE_DEFAULTS, ...m } : m));
  }

  const first = CoverConfigSchema.safeParse(filled);
  if (first.success) return { config: first.data, warnings: [] };

  // Repair: drop broken modules, reset other broken sections to defaults.
  const warnings: Warning[] = [];
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
