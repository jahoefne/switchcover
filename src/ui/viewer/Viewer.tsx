/**
 * React shell around CoverScene: owns the canvas host, the toolbar (ghost / wireframe
 * toggles, fit view), the busy spinner and the error banner. The scene lives in a ref; React
 * re-renders only when props or toolbar toggles change.
 */
import { useEffect, useRef, useState } from 'react';
import type { CoverFrame } from '../../geometry/contract';
import { fmt } from '../derive';
import { CoverScene, type SceneOptions, type ViewerMesh } from './scene';

export type { ViewerMesh } from './scene';

export interface ViewerProps {
  mesh: ViewerMesh | null;
  /** Live layout (ghost placement + initial framing). */
  frame: CoverFrame | null;
  busy?: boolean;
  error?: string | null;
}

const TOGGLES: { key: keyof SceneOptions; label: string; title: string }[] = [
  { key: 'showPlate', label: 'Plate', title: 'Show the existing plate (x-ray)' },
  { key: 'showBilresa', label: 'Bilresa', title: 'Show the Bilresa switches in their pockets' },
  { key: 'wireframe', label: 'Wireframe', title: 'Show the cover as a wireframe' },
];

export function Viewer({ mesh, frame, busy = false, error = null }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<CoverScene | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [ghostError, setGhostError] = useState<string | null>(null);
  const [options, setOptions] = useState<SceneOptions>({ showPlate: true, showBilresa: true, wireframe: false });

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

  const banner = error ?? glError;

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={host} />
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
      </div>
      {busy && (
        <div className="viewer-busy" role="status" aria-label="Building geometry">
          <span className="spinner" aria-hidden="true" />
          <span>Building…</span>
        </div>
      )}
      {frame && (
        <div className="viewer-dims" aria-hidden="true">
          {fmt(frame.outer.w)} × {fmt(frame.outer.h)} × {fmt(frame.frontZ)} mm
        </div>
      )}
      {(banner || ghostError) && (
        <div className="viewer-banner" role="alert">
          {banner && <p>{banner}</p>}
          {ghostError && <p className="muted">{ghostError}</p>}
        </div>
      )}
    </div>
  );
}
