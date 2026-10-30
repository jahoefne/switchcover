/**
 * switchcover app shell: sidebar of panels on the left, 3D viewer on the right (stacked
 * below 900 px). The URL hash is the source of truth for the config (useConfig); the
 * geometry worker builds previews and exports (useGeometry).
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getPreset } from '../config/presets';
import { featureId } from '../layout/resolve';
import { deriveFrame, extensionPlacementText, fmt, mergeWarnings, topZ } from './derive';
import { useConfig } from './hooks/useConfig';
import { defaultClientFactory, useGeometry, type ClientFactory } from './hooks/useGeometry';
import { Section } from './components/Section';
import { ToastProvider } from './components/Toasts';
import { AdvancedPanel } from './panels/AdvancedPanel';
import { ExportPanel } from './panels/ExportPanel';
import type { Cell } from './panels/LayoutSvg';
import { ModulesPanel } from './panels/ModulesPanel';
import { PlatePanel } from './panels/PlatePanel';
import { PresetsPanel } from './panels/PresetsPanel';
import { StylePanel } from './panels/StylePanel';
import { Viewer, type ViewerMesh } from './viewer/Viewer';

export const GITHUB_URL = 'https://github.com/jahoefne/switchcover';

export interface AppProps {
  /** Worker client factory (tests inject a fake). */
  createClient?: ClientFactory;
}

export function App({ createClient = defaultClientFactory }: AppProps) {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <Main createClient={createClient} />
      </ErrorBoundary>
    </ToastProvider>
  );
}

function Main({ createClient }: { createClient: ClientFactory }) {
  const { config, hashWarnings, update, loadPreset, reset, dismissHashWarnings, shareUrl } = useConfig();
  const derived = useMemo(() => deriveFrame(config), [config]);
  const { frame, style, params, limits } = derived;
  const geometry = useGeometry(config, createClient);
  const shown = geometry.build;
  const [selected, setSelected] = useState<Cell>(() => {
    const m = config.modules[0];
    return m ? { col: m.col, row: m.row } : { col: 0, row: 0 };
  });
  const modulesRef = useRef<HTMLDetailsElement>(null);
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const [activeStep, setActiveStep] = useState('plate');
  const [pulse, setPulse] = useState(0);
  const [motionEnabled, setMotionEnabled] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [exportState, setExportState] = useState<'idle' | 'building' | 'complete' | 'error'>('idle');
  useEffect(() => {
    setPulse((value) => value + 1);
    setExportState('idle');
  }, [config]);

  const navigate = (id: string) => {
    setActiveStep(id);
    const panel = document.getElementById(id) as HTMLDetailsElement | null;
    if (panel) {
      panel.open = true;
      panel.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    }
  };

  const mesh: ViewerMesh | null = useMemo(
    () => (shown ? { positions: shown.result.positions, indices: shown.result.indices } : null),
    [shown],
  );
  const current = shown?.config === config;
  // Build-only warnings (geometry checks) are shown only while they belong to this config.
  const warnings = mergeWarnings(hashWarnings, frame.warnings, current && shown ? shown.result.frame.warnings ?? [] : []);

  const selectModule = useCallback((cell: Cell) => {
    setSelected(cell);
    const el = modulesRef.current;
    if (el) {
      el.open = true;
      el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const onLoadPreset = useCallback(
    (id: string) => {
      loadPreset(id);
      setSelected({ col: 0, row: 0 });
    },
    [loadPreset],
  );

  const pockets = frame.features.filter((f) => f.kind === 'pocket').length;
  const openings = frame.features.length - pockets;
  const extension = frame.part.kind === 'extension' ? frame.part : null;

  return (
    <div className={`app export-${exportState}${motionEnabled ? '' : ' motion-paused'}`}>
      <header className="app-header">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={22} height={22} />
          <h1>switch<span>cover</span></h1>
        </div>
        <p className="tagline">Retrofit your home.<span>BILRESA EDITION</span></p>
        <div className="header-edition" aria-hidden="true">DESIGNED BY YOU.<br />BUILT FOR YOUR HOME.</div>
        <a className="gh-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>
      <nav className="workflow" aria-label="Configuration steps">
        {(['plate', 'modules', 'style', 'export'] as const).map((id, index) => (
          <button type="button" key={id} className={activeStep === id ? 'active' : ''} aria-current={activeStep === id ? 'step' : undefined} onClick={() => navigate(id)}>
            <span className="step-number">0{index + 1}</span><span>{id === 'export' ? 'Print' : id[0].toUpperCase() + id.slice(1)}</span><span className="step-line" aria-hidden="true" />
          </button>
        ))}
        <span className="workflow-caption">YOUR HARDWARE. UPGRADED.</span>
      </nav>
      <div className="app-body">
        <aside className="sidebar" aria-label="Settings" onClickCapture={(event) => {
          const id = (event.target as HTMLElement).closest('details.section')?.id;
          if (id) setActiveStep(id === 'presets' ? 'plate' : id === 'advanced' ? 'export' : id);
        }}>
          <div className="inspector-intro"><span className="eyebrow">THE RETROFIT LAB</span><h2>Build your upgrade<span>.</span></h2><p>Old switch. New possibilities.</p></div>
          {hashWarnings.length > 0 && (
            <div className="banner banner-warning" role="alert">
              {hashWarnings.map((w, i) => (
                <p key={i}>{w.message}</p>
              ))}
              <button type="button" className="btn btn-ghost btn-small" onClick={dismissHashWarnings}>
                Dismiss
              </button>
            </div>
          )}
          <Section id="presets" title="Presets" summary={getPreset(config.plate.preset)?.label ?? 'Custom'} defaultOpen>
            <PresetsPanel activeId={config.plate.preset} onLoad={onLoadPreset} onReset={reset} />
          </Section>
          <Section
            id="plate"
            title="Plate"
            summary={`${fmt(config.plate.w)} × ${fmt(config.plate.h)} mm, ${config.grid.cols}×${config.grid.rows}${extension ? ` · extension ${extensionPlacementText(extension)}` : ''}`}
          >
            <PlatePanel config={config} update={update} />
          </Section>
          <Section
            id="modules"
            ref={modulesRef}
            title="Modules"
            summary={`${pockets} pocket${pockets === 1 ? '' : 's'}, ${openings} opening${openings === 1 ? '' : 's'} · ${featureId(selected.col, selected.row)}`}
            defaultOpen
          >
            <ModulesPanel config={config} frame={frame} update={update} selected={selected} onSelect={setSelected} />
          </Section>
          <Section id="style" title="Style" summary={extension ? 'not used for an extension' : style.label} defaultOpen={!extension}>
            <StylePanel config={config} style={style} params={params} limits={limits} update={update} />
          </Section>
          <Section id="advanced" title="Bilresa & print" summary={`pocket ${fmt(config.bilresa.pocketDepth)} mm`}>
            <AdvancedPanel config={config} frame={frame} style={style} params={params} update={update} />
          </Section>
          <Section id="export" title="Export" summary={`${fmt(frame.outer.w)} × ${fmt(frame.outer.h)} × ${fmt(topZ(frame))} mm`} defaultOpen>
            <ExportPanel
              config={config}
              frame={frame}
              style={style}
              params={params}
              stats={shown?.result.stats ?? null}
              statsStale={!current}
              warnings={warnings}
              download={geometry.download}
              shareUrl={shareUrl}
              onSelectModule={selectModule}
              actionHost={actionHost}
              onExportStateChange={setExportState}
            />
          </Section>
          <footer className="sidebar-footer">
            Units are millimetres. Front view: X right, Y up, Z out of the wall.{' '}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              Source &amp; docs
            </a>
          </footer>
        </aside>
        <main className="stage">
          <Viewer mesh={mesh} frame={frame} busy={geometry.busy} error={geometry.error} pulse={pulse} exportState={exportState} onMotionChange={setMotionEnabled} />
        </main>
      </div>
      <footer className="workshop-dock">
        <div className="dock-summary"><span className="dock-beacon" aria-hidden="true" /><div><span className="eyebrow">{exportState === 'building' ? 'FABRICATING YOUR FILE' : exportState === 'complete' ? 'STL DELIVERED' : 'FROM SCREEN TO REALITY'}</span><strong>{fmt(frame.outer.w)} × {fmt(frame.outer.h)} × {fmt(topZ(frame))} <small>mm</small></strong></div></div>
        <div className="dock-actions" ref={setActionHost} />
      </footer>
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

/** Last-resort guard: a render error shows a reset button instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>switchcover hit a problem</h1>
        <p>{this.state.error.message}</p>
        <p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              window.location.hash = '';
              window.location.reload();
            }}
          >
            Start over with the default layout
          </button>
        </p>
      </div>
    );
  }
}
