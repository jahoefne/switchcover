/**
 * useGeometry — owns the worker client and keeps a preview build in sync with the config.
 *
 *  - The client is created inside an effect (StrictMode double-invokes memos and mounts).
 *  - Preview builds are debounced (BUILD_DEBOUNCE_MS); the client itself coalesces queued
 *    previews newest-wins. A result is shown if it is newer than the one on screen, even if
 *    the config moved on meanwhile (stale-but-recent beats a blank viewer while dragging).
 *  - `download(kind)` asks for an export-quality build ('export' | 'testFit') and returns
 *    the STL bytes; it never reuses the preview mesh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverConfig } from '../../config/schema';
import type { BuildResult } from '../../geometry/contract';
import { GeometryClient, isBenignBuildError } from '../../worker/client';

export const BUILD_DEBOUNCE_MS = 150;

/** What the UI needs from the worker client (inject a fake in tests). */
export type GeometryClientLike = Pick<GeometryClient, 'build' | 'dispose' | 'onBusyChange'>;
export type ClientFactory = () => GeometryClientLike;

export const defaultClientFactory: ClientFactory = () => new GeometryClient();

export interface ShownBuild {
  /** The config this result was built from (compare with the current one for staleness). */
  config: CoverConfig;
  result: BuildResult;
}

export interface GeometryApi {
  build: ShownBuild | null;
  /** Error of the latest preview build (cleared by the next success). */
  error: string | null;
  busy: boolean;
  /** Build an export-quality STL. Rejects with an Error the UI should show. */
  download(kind: 'export' | 'testFit', config: CoverConfig): Promise<ArrayBuffer>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useGeometry(config: CoverConfig, createClient: ClientFactory = defaultClientFactory): GeometryApi {
  const [client, setClient] = useState<GeometryClientLike | null>(null);
  const [busy, setBusy] = useState(false);
  const [build, setBuild] = useState<ShownBuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(0);
  const shown = useRef(0);

  useEffect(() => {
    let c: GeometryClientLike;
    try {
      c = createClient();
    } catch (e) {
      setError(`Could not start the geometry worker: ${message(e)}`);
      return;
    }
    const unsubscribe = c.onBusyChange(setBusy);
    setClient(c);
    return () => {
      unsubscribe();
      c.dispose();
      setClient(null);
      setBusy(false);
    };
  }, [createClient]);

  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => {
      const seq = ++requested.current;
      client.build(config).then(
        (result) => {
          if (seq <= shown.current) return;
          shown.current = seq;
          setBuild({ config, result });
          if (seq === requested.current) setError(null);
        },
        (e: unknown) => {
          if (isBenignBuildError(e)) return;
          if (seq === requested.current) setError(message(e));
        },
      );
    }, BUILD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [client, config]);

  const download = useCallback(
    async (kind: 'export' | 'testFit', cfg: CoverConfig): Promise<ArrayBuffer> => {
      if (!client) throw new Error('The geometry worker is not ready yet.');
      const result = await client.build(cfg, { kind });
      if (!result.stl || result.stl.byteLength === 0) {
        throw new Error(kind === 'testFit' ? 'The worker returned no test-fit STL.' : 'The worker returned no STL data.');
      }
      return result.stl;
    },
    [client],
  );

  return { build, error, busy, download };
}
