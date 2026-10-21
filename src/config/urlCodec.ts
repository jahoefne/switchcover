/**
 * URL hash codec: `#v2.<lz-string compressToEncodedURIComponent(JSON)>`.
 *
 * The prefix versions the link format. `#v2.` (written since config v2) and `#v1.` (older
 * links) use the same framing and compression and both decode; the config's own `v` field
 * decides the migration (migrateConfig). Numbers are rounded to 0.01 mm before encoding so
 * hashes stay short and stable.
 */
import LZString from 'lz-string';
import type { Warning } from '../geometry/contract';
import { migrateConfig, type MigrateResult } from './migrate';
import { DEFAULT_CONFIG, cloneConfig, type CoverConfig } from './schema';

export const HASH_PREFIX = '#v2.';
/** Prefixes decodeHash accepts (same codec; old links keep working). */
export const ACCEPTED_HASH_PREFIXES = ['#v2.', '#v1.'] as const;

/** Round every number in a JSON value to 0.01 (normalising −0 to 0). */
export function roundDeep<T>(value: T): T {
  if (typeof value === 'number') {
    const r = Math.round(value * 100) / 100;
    return (r === 0 ? 0 : r) as T;
  }
  if (Array.isArray(value)) return value.map((v) => roundDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = roundDeep(v);
    return out as T;
  }
  return value;
}

export function encodeHash(config: CoverConfig): string {
  return HASH_PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(roundDeep(config)));
}

function defaults(warning?: Warning): MigrateResult {
  return { config: cloneConfig(DEFAULT_CONFIG), warnings: warning ? [warning] : [] };
}

/**
 * Decode a location hash (with or without the leading '#'). Never throws:
 * empty → defaults (no warning); garbage / unknown codec → defaults + warning.
 */
export function decodeHash(hash: string | null | undefined): MigrateResult {
  const h = (hash ?? '').trim();
  if (h === '' || h === '#') return defaults();
  const normalised = h.startsWith('#') ? h : `#${h}`;
  const prefix = ACCEPTED_HASH_PREFIXES.find((p) => normalised.startsWith(p));
  if (!prefix) {
    const m = /^#v(\d+)\./.exec(normalised);
    return defaults({
      code: 'hash-invalid',
      severity: 'warning',
      message: m
        ? `Link format v${m[1]} is not supported by this version; showing the default layout.`
        : 'The link does not contain a switchcover configuration; showing the default layout.',
    });
  }
  let json: string | null = null;
  try {
    json = LZString.decompressFromEncodedURIComponent(normalised.slice(prefix.length));
  } catch {
    json = null;
  }
  if (!json) {
    return defaults({
      code: 'hash-invalid',
      severity: 'warning',
      message: 'The link is damaged (could not decompress); showing the default layout.',
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return defaults({
      code: 'hash-invalid',
      severity: 'warning',
      message: 'The link is damaged (invalid JSON); showing the default layout.',
    });
  }
  return migrateConfig(raw);
}
