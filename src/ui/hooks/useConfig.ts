/**
 * useConfig — the app's single source of truth for the CoverConfig, mirrored in the URL hash.
 *
 *  - Initial state comes from `location.hash` (decodeHash never throws: empty → defaults,
 *    garbage → defaults + warning in `hashWarnings`).
 *  - Every accepted change is written back with a debounced `history.replaceState`
 *    (no history spam, no `hashchange` loop). Changes that came FROM the hash are not
 *    written back, so a damaged link stays visible until the user edits something.
 *  - `update(fn)` hands `fn` a deep copy to mutate (or replace by returning a new object);
 *    the result is rounded to 0.01 like the codec and zod-validated. Invalid results are
 *    rejected (returns false) and the state stays unchanged.
 *  - External hash changes (pasted link, back/forward) are picked up via `hashchange`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { presetConfig } from '../../config/presets';
import { CoverConfigSchema, DEFAULT_CONFIG, cloneConfig, type CoverConfig } from '../../config/schema';
import { decodeHash, encodeHash, roundDeep } from '../../config/urlCodec';
import type { Warning } from '../../geometry/contract';

export const HASH_DEBOUNCE_MS = 150;

export type ConfigUpdater = (draft: CoverConfig) => CoverConfig | void;

export interface ConfigApi {
  config: CoverConfig;
  /** Problems found while decoding the URL hash (damaged link, repaired sections). */
  hashWarnings: Warning[];
  /** Patch the config immutably; returns false (and changes nothing) if the result is invalid. */
  update(fn: ConfigUpdater): boolean;
  /** Load a preset: replaces plate, grid and modules; keeps style and advanced settings. */
  loadPreset(id: string): void;
  /** Everything back to the default configuration. */
  reset(): void;
  dismissHashWarnings(): void;
  /** The share link for the current config (does not wait for the debounced hash write). */
  shareUrl(): string;
}

function writeHash(config: CoverConfig): void {
  const hash = encodeHash(config);
  if (window.location.hash === hash) return;
  window.history.replaceState(window.history.state, '', hash);
}

export function useConfig(): ConfigApi {
  const [initial] = useState(() => decodeHash(window.location.hash));
  const [config, setConfig] = useState<CoverConfig>(initial.config);
  const [hashWarnings, setHashWarnings] = useState<Warning[]>(initial.warnings);
  /** Latest config, updated synchronously so several updates in one tick compose. */
  const current = useRef(config);
  /** Config object that came from the hash (must not be written back). */
  const fromHash = useRef<CoverConfig | null>(initial.config);
  const pending = useRef<CoverConfig | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = useCallback((next: CoverConfig) => {
    current.current = next;
    setConfig(next);
  }, []);

  const update = useCallback(
    (fn: ConfigUpdater): boolean => {
      const draft = cloneConfig(current.current);
      const out = fn(draft) ?? draft;
      const parsed = CoverConfigSchema.safeParse(roundDeep(out));
      if (!parsed.success) {
        if (import.meta.env.DEV) console.warn('switchcover: rejected invalid config update', parsed.error.issues);
        return false;
      }
      commit(parsed.data);
      return true;
    },
    [commit],
  );

  const loadPreset = useCallback(
    (id: string) => {
      const p = presetConfig(id);
      update((c) => ({ ...c, plate: p.plate, grid: p.grid, modules: p.modules, cover: { ...c.cover, size: 'auto' } }));
      setHashWarnings([]);
    },
    [update],
  );

  const reset = useCallback(() => {
    commit(cloneConfig(DEFAULT_CONFIG));
    setHashWarnings([]);
  }, [commit]);

  const dismissHashWarnings = useCallback(() => setHashWarnings([]), []);

  const shareUrl = useCallback(() => {
    const { origin, pathname, search } = window.location;
    return `${origin}${pathname}${search}${encodeHash(current.current)}`;
  }, []);

  // Debounced hash write ---------------------------------------------------------------
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const next = pending.current;
    pending.current = null;
    if (next) writeHash(next);
  }, []);

  useEffect(() => {
    if (config === fromHash.current) return;
    pending.current = config;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, HASH_DEBOUNCE_MS);
  }, [config, flush]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  // External hash changes ---------------------------------------------------------------
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (hash === encodeHash(current.current)) return;
      const decoded = decodeHash(hash);
      pending.current = null;
      clearTimeout(timer.current);
      fromHash.current = decoded.config;
      commit(decoded.config);
      setHashWarnings(decoded.warnings);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [commit]);

  return { config, hashWarnings, update, loadPreset, reset, dismissHashWarnings, shareUrl };
}
