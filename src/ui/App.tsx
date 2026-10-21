/**
 * Phase-0 app shell: preset picker + 3D preview of the stub build. WP3 replaces it.
 * The URL hash (#v1.…) is the source of truth for the config.
 */
import { useEffect, useState } from 'react';
import { listPresets, presetConfig } from '../config/presets';
import type { CoverConfig } from '../config/schema';
import { decodeHash, encodeHash } from '../config/urlCodec';
import type { BuildResult, Warning } from '../geometry/contract';
import { GeometryClient, isBenignBuildError } from '../worker/client';
import { Viewer, type ViewerMesh } from './Viewer';

function initialState(): { config: CoverConfig; warnings: Warning[] } {
  if (!window.location.hash) return { config: presetConfig('ch-sd-1x1'), warnings: [] };
  return decodeHash(window.location.hash);
}

export function App() {
  const [{ config, warnings: hashWarnings }, setState] = useState(initialState);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<GeometryClient | null>(null);

  // Created in an effect (not useMemo) so StrictMode's mount/unmount/mount cycle never
  // leaves the app holding a disposed client.
  useEffect(() => {
    const c = new GeometryClient();
    const unsubscribe = c.onBusyChange(setBusy);
    setClient(c);
    return () => {
      unsubscribe();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    const onHash = () => setState(decodeHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!client) return;
    let live = true;
    client.build(config).then(
      (r) => {
        if (!live) return;
        setResult(r);
        setError(null);
      },
      (e: unknown) => {
        if (!live || isBenignBuildError(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [client, config]);

  const selectPreset = (id: string) => {
    const next = presetConfig(id);
    window.history.replaceState(null, '', encodeHash(next));
    setState({ config: next, warnings: [] });
  };

  const mesh: ViewerMesh | null = result ? { positions: result.positions, indices: result.indices } : null;
  const frame = result?.frame;
  const warnings = [...hashWarnings, ...(frame?.warnings ?? [])];

  return (
    <div className="app">
      <aside className="panel">
        <h1>switchcover</h1>
        <label>
          Preset
          <select value={config.plate.preset} onChange={(e) => selectPreset(e.target.value)}>
            {listPresets().map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {frame && (
          <dl>
            <dt>Cover</dt>
            <dd>
              {frame.outer.w.toFixed(1)} × {frame.outer.h.toFixed(1)} × {frame.frontZ.toFixed(1)} mm
            </dd>
            <dt>Build</dt>
            <dd>
              {result.stats.tris} triangles, {result.stats.ms.toFixed(0)} ms{busy ? ' (updating…)' : ''}
            </dd>
          </dl>
        )}
        {error && <p className="error">{error}</p>}
        {warnings.length > 0 && (
          <ul className="warnings">
            {warnings.map((w, i) => (
              <li key={i} className={w.severity}>
                {w.message}
              </li>
            ))}
          </ul>
        )}
        <p className="note">Phase-0 preview: outer body and cavity only.</p>
      </aside>
      <main className="stage">
        <Viewer mesh={mesh} />
      </main>
    </div>
  );
}
