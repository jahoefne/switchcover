// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presetConfig } from '../src/config/presets';
import type { CoverConfig } from '../src/config/schema';
import type { BuildResult } from '../src/geometry/contract';
import { BUILD_DEBOUNCE_MS, useGeometry, type GeometryClientLike } from '../src/ui/hooks/useGeometry';
import { SupersededError, type BuildOptions } from '../src/worker/client';

interface Pending {
  config: CoverConfig;
  options?: BuildOptions;
  resolve(r: BuildResult): void;
  reject(e: Error): void;
}

function controllableClient() {
  const pending: Pending[] = [];
  let busyListener: ((b: boolean) => void) | null = null;
  const client: GeometryClientLike = {
    build: (config, options) =>
      new Promise<BuildResult>((resolve, reject) => pending.push({ config, options, resolve, reject })),
    dispose: vi.fn(),
    onBusyChange: (l) => {
      busyListener = l;
      return () => (busyListener = null);
    },
  };
  return { client, pending, setBusy: (b: boolean) => busyListener?.(b) };
}

const result = (id: number, stl?: ArrayBuffer): BuildResult => ({
  id,
  positions: new Float32Array(9),
  indices: new Uint32Array([0, 1, 2]),
  frame: {} as never,
  stats: { ms: 1, tris: 1, volume: 1000, genus: 0 },
  stl,
});

const tick = () => act(() => void vi.advanceTimersByTime(BUILD_DEBOUNCE_MS + 5));
const settle = () => act(async () => void (await Promise.resolve()));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useGeometry', () => {
  it('debounces preview builds and shows the newest result', async () => {
    const { client, pending, setBusy } = controllableClient();
    const factory = () => client;
    const a = presetConfig('ch-sd-1x1');
    const b = presetConfig('ch-sd-2x2');
    const { result: hook, rerender } = renderHook(({ config }) => useGeometry(config, factory), { initialProps: { config: a } });
    rerender({ config: b });
    tick();
    expect(pending).toHaveLength(1); // the first config never got built
    expect(pending[0].config).toBe(b);
    act(() => setBusy(true));
    expect(hook.current.busy).toBe(true);
    pending[0].resolve(result(1));
    await settle();
    expect(hook.current.build?.config).toBe(b);
    expect(hook.current.error).toBeNull();
  });

  it('ignores superseded builds and reports real errors of the latest request', async () => {
    const { client, pending } = controllableClient();
    const factory = () => client;
    const { result: hook, rerender } = renderHook(({ config }) => useGeometry(config, factory), {
      initialProps: { config: presetConfig('ch-sd-1x1') },
    });
    tick();
    rerender({ config: presetConfig('ch-sd-2x1h-two-switches') });
    tick();
    pending[0].reject(new SupersededError());
    pending[1].reject(new Error('boom'));
    await settle();
    expect(hook.current.error).toBe('boom');
    expect(hook.current.build).toBeNull();
  });

  it('downloads export-quality STL bytes and rejects when none come back', async () => {
    const { client, pending } = controllableClient();
    const factory = () => client;
    const cfg = presetConfig('ch-sd-1x1');
    const { result: hook } = renderHook(() => useGeometry(cfg, factory));
    const ok = hook.current.download('export', cfg);
    expect(pending.at(-1)?.options).toEqual({ kind: 'export' });
    const bytes = new ArrayBuffer(84);
    pending.at(-1)!.resolve(result(1, bytes));
    await expect(ok).resolves.toBe(bytes);

    const missing = hook.current.download('testFit', cfg);
    expect(pending.at(-1)?.options).toEqual({ kind: 'testFit' });
    pending.at(-1)!.resolve(result(2));
    await expect(missing).rejects.toThrow(/no test-fit STL/);
  });

  it('disposes the client on unmount', () => {
    const { client } = controllableClient();
    const { unmount } = renderHook(() => useGeometry(presetConfig('ch-sd-1x1'), () => client));
    unmount();
    expect(client.dispose).toHaveBeenCalled();
  });
});
