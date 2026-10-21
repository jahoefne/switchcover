// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presetConfig } from '../src/config/presets';
import { DEFAULT_CONFIG } from '../src/config/schema';
import { decodeHash, encodeHash } from '../src/config/urlCodec';
import { HASH_DEBOUNCE_MS, useConfig } from '../src/ui/hooks/useConfig';

function setHash(hash: string) {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
}

const flushHash = () => act(() => void vi.advanceTimersByTime(HASH_DEBOUNCE_MS + 10));

beforeEach(() => {
  vi.useFakeTimers();
  setHash('');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useConfig', () => {
  it('starts from the defaults without a hash and does not write one until edited', () => {
    const { result } = renderHook(() => useConfig());
    expect(result.current.config).toEqual(DEFAULT_CONFIG);
    expect(result.current.hashWarnings).toEqual([]);
    flushHash();
    expect(window.location.hash).toBe('');
  });

  it('round-trips: update → debounced hash → decode equals state', () => {
    const { result } = renderHook(() => useConfig());
    let ok = false;
    act(() => {
      ok = result.current.update((c) => {
        c.plate.depth = 14.5;
        c.bilresa.pocketClearance = 0.1 + 0.2; // float noise is rounded like the codec
        c.modules[0].dx = 3;
      });
    });
    expect(ok).toBe(true);
    expect(result.current.config.bilresa.pocketClearance).toBe(0.3);
    expect(window.location.hash).toBe(''); // still debouncing
    flushHash();
    expect(window.location.hash.startsWith('#v1.')).toBe(true);
    expect(window.location.hash).toBe(encodeHash(result.current.config));
    const decoded = decodeHash(window.location.hash);
    expect(decoded.warnings).toEqual([]);
    expect(decoded.config).toEqual(result.current.config);
    expect(decoded.config.plate.depth).toBe(14.5);
  });

  it('coalesces rapid edits into one replaceState', () => {
    const spy = vi.spyOn(window.history, 'replaceState');
    const { result } = renderHook(() => useConfig());
    act(() => {
      for (let i = 1; i <= 5; i++) result.current.update((c) => void (c.plate.depth = 10 + i));
    });
    flushHash();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(decodeHash(window.location.hash).config.plate.depth).toBe(15);
  });

  it('loads the config from an existing hash', () => {
    const cfg = presetConfig('ch-sd-2x2');
    cfg.cover.margin = 7;
    setHash(encodeHash(cfg));
    const { result } = renderHook(() => useConfig());
    expect(result.current.config).toEqual(cfg);
    expect(result.current.hashWarnings).toEqual([]);
  });

  it('rejects invalid updates and keeps the state', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useConfig());
    const before = result.current.config;
    let ok = true;
    act(() => {
      ok = result.current.update((c) => void (c.grid.cols = 0));
    });
    expect(ok).toBe(false);
    expect(result.current.config).toBe(before);
  });

  it('switches presets but keeps style and advanced settings', () => {
    const { result } = renderHook(() => useConfig());
    act(() => {
      result.current.update((c) => {
        c.bilresa.pocketDepth = 8;
        c.cover.size = { w: 200, h: 200 };
      });
    });
    act(() => result.current.loadPreset('ch-sd-1x3v-switch-two-sockets'));
    const p = presetConfig('ch-sd-1x3v-switch-two-sockets');
    const c = result.current.config;
    expect(c.plate).toEqual(p.plate);
    expect(c.grid).toEqual(p.grid);
    expect(c.modules).toEqual(p.modules);
    expect(c.bilresa.pocketDepth).toBe(8);
    expect(c.cover.size).toBe('auto');
    flushHash();
    expect(decodeHash(window.location.hash).config).toEqual(c);
  });

  it('garbage hash → defaults + warning surfaced; the link is kept until an edit', () => {
    setHash('#v1.this-is-not-a-config');
    const { result } = renderHook(() => useConfig());
    expect(result.current.config).toEqual(DEFAULT_CONFIG);
    expect(result.current.hashWarnings).toHaveLength(1);
    expect(result.current.hashWarnings[0]).toMatchObject({ code: 'hash-invalid', severity: 'warning' });
    flushHash();
    expect(window.location.hash).toBe('#v1.this-is-not-a-config');
    act(() => result.current.dismissHashWarnings());
    expect(result.current.hashWarnings).toEqual([]);
    act(() => void result.current.update((c) => void (c.plate.depth = 13)));
    flushHash();
    expect(decodeHash(window.location.hash).config.plate.depth).toBe(13);
  });

  it('picks up external hash changes (pasted link, back/forward)', () => {
    const { result } = renderHook(() => useConfig());
    const other = presetConfig('de-2x1h');
    act(() => {
      setHash(encodeHash(other));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.config).toEqual(other);
    act(() => {
      setHash('#junk');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.config).toEqual(DEFAULT_CONFIG);
    expect(result.current.hashWarnings[0]?.code).toBe('hash-invalid');
  });

  it('reset restores the defaults and clears warnings', () => {
    setHash('#garbage');
    const { result } = renderHook(() => useConfig());
    act(() => void result.current.update((c) => void (c.cover.skinT = 4)));
    act(() => result.current.reset());
    expect(result.current.config).toEqual(DEFAULT_CONFIG);
    expect(result.current.hashWarnings).toEqual([]);
  });

  it('shareUrl encodes the current state immediately', () => {
    const { result } = renderHook(() => useConfig());
    act(() => void result.current.update((c) => void (c.plate.cornerR = 5)));
    const url = result.current.shareUrl();
    expect(url.startsWith(`${window.location.origin}${window.location.pathname}#v1.`)).toBe(true);
    expect(decodeHash(new URL(url).hash).config.plate.cornerR).toBe(5);
  });
});
