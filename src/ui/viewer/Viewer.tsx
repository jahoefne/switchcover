/**
 * React shell around CoverScene: owns the canvas host, the toolbar (ghost / wireframe
 * toggles, fit view), the busy spinner and the error banner. The scene lives in a ref; React
 * re-renders only when props or toolbar toggles change.
 */
import { useEffect, useRef, useState } from 'react';
import type { CoverFrame } from '../../geometry/contract';
import { fmt, topZ } from '../derive';
import { CoverScene, type SceneOptions, type ViewerMesh } from './scene';

export type { ViewerMesh } from './scene';

export interface ViewerProps {
  mesh: ViewerMesh | null;
  /** Live layout (ghost placement + initial framing). */
  frame: CoverFrame | null;
  busy?: boolean;
  error?: string | null;
  pulse?: number;
  exportState?: 'idle' | 'building' | 'complete' | 'error';
  onMotionChange?(enabled: boolean): void;
}

const TOGGLES: { key: keyof SceneOptions; label: string; title: string }[] = [
  { key: 'showPlate', label: 'Plate', title: 'Show the existing plate (x-ray)' },
  { key: 'showBilresa', label: 'Bilresa', title: 'Show the Bilresa switches in their pockets' },
  { key: 'wireframe', label: 'Wireframe', title: 'Show the cover as a wireframe' },
];

export function Viewer({ mesh, frame, busy = false, error = null, pulse = 0, exportState = 'idle', onMotionChange }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<CoverScene | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [ghostError, setGhostError] = useState<string | null>(null);
  const [options, setOptions] = useState<SceneOptions>({ showPlate: false, showBilresa: true, wireframe: false });
  const [exploded, setExploded] = useState(false);
  const [motion, setMotion] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [reveal, setReveal] = useState(0);

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => {
      setMotion(!preference?.matches);
      onMotionChange?.(!preference?.matches);
    };
    preference?.addEventListener('change', change);
    return () => preference?.removeEventListener('change', change);
  }, [onMotionChange]);

  // Create / dispose the scene. Runs before the setter effects below (declaration order).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let s: CoverScene;
    try {
      s = new CoverScene(el);
    } catch (e) {
      setGlError(`3D preview unavailable (WebGL could not start): ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    s.onGhostError = setGhostError;
    scene.current = s;
    const resize = () => s.resize(el.clientWidth, el.clientHeight);
    resize();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      ro.observe(el);
    } else window.addEventListener('resize', resize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      s.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setOptions(options);
  }, [options]);

  useEffect(() => {
    scene.current?.setFrame(frame);
  }, [frame]);

  useEffect(() => {
    scene.current?.setMesh(mesh);
  }, [mesh]);

  useEffect(() => { scene.current?.setExploded(exploded); }, [exploded]);
  useEffect(() => { scene.current?.setMotionEnabled(motion); }, [motion]);

  const replayAssembly = () => {
    setExploded(false);
    setReveal((value) => value + 1);
    scene.current?.revealAssembly();
  };

  const banner = error ?? glError;

  return (
    <div className={`viewer${busy ? ' is-building' : ''}${exploded ? ' is-exploded' : ''}${motion ? '' : ' motion-paused'} export-${exportState}`}>
      <div className="reactor-environment" aria-hidden="true">
        <div className="reactor-grid" /><div className="reactor-halo" />
        <div className="reactor-orbit orbit-outer" /><div className="reactor-orbit orbit-inner" />
        <div className="reactor-floor" /><div className="reactor-particles"><i /><i /><i /><i /><i /><i /></div>
      </div>
      <div className="bay-heading"><span className="eyebrow">LIVE 3D</span><h2>Your upgrade,<br /><span>taking shape.</span></h2></div>
      <div className="bay-serial" aria-hidden="true">SC—01<br /><span>RETROFIT SYSTEM</span></div>
      <div className="viewer-canvas" ref={host} />
      <div className="bay-corners" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="circuit-pulse" key={`pulse-${pulse}`} aria-hidden="true"><i /><b /></div>
      <div className="assembly-sweep" key={`reveal-${reveal}-${pulse}`} aria-hidden="true" />
      <div className="viewer-toolbar" role="toolbar" aria-label="Preview options">
        {TOGGLES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tool${options[t.key] ? ' on' : ''}`}
            aria-pressed={options[t.key]}
            title={t.title}
            onClick={() => setOptions((o) => ({ ...o, [t.key]: !o[t.key] }))}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="tool" title="Frame the cover from the front" onClick={() => scene.current?.fitView()}>
          Fit view
        </button>
        <button type="button" className={`tool motion-toggle${motion ? ' on' : ''}`} aria-pressed={motion} onClick={() => { setMotion(!motion); onMotionChange?.(!motion); }} title="Toggle ambient animation">
          {motion ? 'Motion on' : 'Motion off'}
        </button>
      </div>
      {busy && (
        <div className="viewer-busy" role="status" aria-label="Building geometry">
          <span className="spinner" aria-hidden="true" />
          <span>Building…</span>
        </div>
      )}
      {frame && (
        <div className="viewer-dims" aria-hidden="true">
          <span className="dimension-rule" />{fmt(frame.outer.w)} × {fmt(frame.outer.h)} × {fmt(topZ(frame))}<span className="dimension-unit">mm / COVER ENVELOPE</span>
        </div>
      )}
      <div className="assembly-controls" role="group" aria-label="Assembly controls">
        <button type="button" className={`tool${exploded ? ' on' : ''}`} disabled={!mesh} aria-pressed={exploded} onClick={() => setExploded((value) => !value)}>{exploded ? 'Assemble' : 'Explode layers'}<span aria-hidden="true"> ◇</span></button>
        <button type="button" className="tool" disabled={!mesh} onClick={replayAssembly}>Replay reveal <span aria-hidden="true">↻</span></button>
      </div>
      <div className="bay-status"><span className="status-light" /><span role="status">{banner ? 'PREVIEW UNAVAILABLE' : exportState === 'building' ? 'EXPORT / BUILDING STL' : busy ? 'REBUILDING GEOMETRY' : !mesh ? 'INITIALIZING GEOMETRY' : exploded ? 'ASSEMBLY / LAYERS SEPARATED' : 'PREVIEW / ASSEMBLED'}</span><span className="bay-hint">Drag to orbit · Scroll to zoom</span></div>
      {(banner || ghostError) && (
        <div className="viewer-banner" role="alert">
          {banner && <p>{banner}</p>}
          {ghostError && <p className="muted">{ghostError}</p>}
        </div>
      )}
    </div>
  );
}
