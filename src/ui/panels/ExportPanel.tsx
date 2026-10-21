import { useState } from 'react';
import type { CoverConfig } from '../../config/schema';
import type { BuildStats, CoverFrame, Warning } from '../../geometry/contract';
import type { AnyCoverStyle } from '../../styles';
import { effectiveOrientation, fmt, heightSummary, parseFeatureId, stlFilename } from '../derive';
import { useToast } from '../components/Toasts';
import type { Cell } from './LayoutSvg';

/** PLA density for the rough mass estimate (g/cm³). */
const PLA_DENSITY = 1.24;

interface ExportPanelProps {
  config: CoverConfig;
  frame: CoverFrame;
  style: AnyCoverStyle;
  /** Parsed style params (the style's default orientation may depend on them). */
  params: Record<string, unknown>;
  /** Stats of the preview build on screen (null before the first build). */
  stats: BuildStats | null;
  /** True when `stats` belong to an older config. */
  statsStale: boolean;
  warnings: Warning[];
  download(kind: 'export' | 'testFit', config: CoverConfig): Promise<ArrayBuffer>;
  shareUrl(): string;
  onSelectModule(cell: Cell): void;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ExportPanel({
  config,
  frame,
  style,
  params,
  stats,
  statsStale,
  warnings,
  download,
  shareUrl,
  onSelectModule,
}: ExportPanelProps) {
  const notify = useToast();
  const [running, setRunning] = useState<'export' | 'testFit' | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const heights = heightSummary(frame);
  const orientation = effectiveOrientation(config, style, params);
  const hasPocket = frame.features.some((f) => f.kind === 'pocket');
  const errors = warnings.filter((w) => w.severity === 'error').length;

  const run = async (kind: 'export' | 'testFit') => {
    setRunning(kind);
    try {
      const stl = await download(kind, config);
      const name = stlFilename(config, kind);
      saveBlob(new Blob([stl], { type: 'model/stl' }), name);
      notify(`Saved ${name} (${fmt(stl.byteLength / 1024, 0)} KB).`, 'success');
    } catch (e) {
      notify(`${kind === 'testFit' ? 'Test-fit export' : 'Export'} failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setRunning(null);
    }
  };

  const copyLink = async () => {
    const url = shareUrl();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setFallbackUrl(null);
      notify('Share link copied to the clipboard.', 'success');
    } catch {
      setFallbackUrl(url);
    }
  };

  return (
    <>
      <dl className="stats">
        <dt>Cover</dt>
        <dd>
          {fmt(frame.outer.w)} × {fmt(frame.outer.h)} mm, face at {fmt(frame.frontZ)} mm
        </dd>
        <dt>Total height</dt>
        <dd>
          {fmt(heights.total)} mm{hasPocket && <> (Bilresa {fmt(heights.proud)} mm proud)</>}
        </dd>
        <dt>Volume</dt>
        <dd className={statsStale ? 'stale' : undefined}>
          {stats ? (
            <>
              {fmt(stats.volume / 1000)} cm³ ≈ {fmt((stats.volume / 1000) * PLA_DENSITY, 0)} g PLA
            </>
          ) : (
            '–'
          )}
        </dd>
        <dt>Mesh</dt>
        <dd className={statsStale ? 'stale' : undefined}>
          {stats ? `${stats.tris.toLocaleString('en-US')} triangles, preview ${fmt(stats.ms, 0)} ms` : '–'}
        </dd>
        <dt>Print</dt>
        <dd>{orientation === 'faceDown' ? 'Face down' : 'Face up'}</dd>
      </dl>
      <p className="print-hint">{style.printHint}</p>
      {orientation === 'faceDown' && (
        <p className="muted small">Face-down exports look mirrored from above in the slicer — that is correct.</p>
      )}

      <div className="export-actions">
        <button type="button" className="btn btn-primary" disabled={running !== null} onClick={() => run('export')}>
          {running === 'export' ? 'Building STL…' : 'Download STL'}
        </button>
        <button type="button" className="btn" disabled={running !== null || !hasPocket} onClick={() => run('testFit')}>
          {running === 'testFit' ? 'Building…' : 'Download test-fit STL'}
        </button>
        <button type="button" className="btn" onClick={copyLink}>
          Copy share link
        </button>
      </div>
      {fallbackUrl && (
        <div className="share-fallback">
          <label htmlFor="share-url">Copy this link:</label>
          <textarea id="share-url" readOnly value={fallbackUrl} rows={3} onFocus={(e) => e.currentTarget.select()} autoFocus />
        </div>
      )}

      <h3 className="warnings-title">
        Checks{' '}
        <span className="muted">
          {warnings.length === 0 ? '— all good' : `— ${warnings.length} note${warnings.length > 1 ? 's' : ''}${errors ? `, ${errors} error${errors > 1 ? 's' : ''}` : ''}`}
        </span>
      </h3>
      {warnings.length > 0 && (
        <ul className="warning-list">
          {warnings.map((w, i) => {
            const cell = parseFeatureId(w.featureId);
            return (
              <li key={`${w.code}-${i}`} className={`sev-${w.severity}`}>
                <span className="sev-badge">{w.severity}</span>
                {cell && (
                  <button type="button" className="chip" title="Select this module" onClick={() => onSelectModule(cell)}>
                    {w.featureId}
                  </button>
                )}
                <span className="msg">{w.message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
