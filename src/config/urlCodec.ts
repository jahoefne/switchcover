/**
 * URL hash codec: `#v1.<lz-string compressToEncodedURIComponent(JSON)>`.
 *
 * The prefix versions the CODEC (compression + framing), independently of the config's
 * own `v` field, which migrateConfig handles. Numbers are rounded to 0.01 mm before
 * encoding so hashes stay short and stable.
 */
import LZString from 'lz-string';
import type { Warning } from '../geometry/contract';
import { migrateConfig, type MigrateResult } from './migrate';
import { DEFAULT_CONFIG, cloneConfig, type CoverConfig } from './schema';

export const HASH_PREFIX = '#v1.';

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
  if (!normalised.startsWith(HASH_PREFIX)) {
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
    json = LZString.decompressFromEncodedURIComponent(normalised.slice(HASH_PREFIX.length));
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
