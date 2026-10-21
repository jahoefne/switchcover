import { useEffect, useState } from 'react';
import { listPresets, type Preset } from '../../config/presets';
import type { CoverFrame } from '../../geometry/contract';
import { resolveLayout } from '../../layout/resolve';
import { LayoutSvg } from './LayoutSvg';

/** Preset frames never change; resolve each once. */
const frames = new Map<string, CoverFrame>();
function presetFrame(p: Preset): CoverFrame {
  let f = frames.get(p.id);
  if (!f) {
    f = resolveLayout(p.config);
    frames.set(p.id, f);
  }
  return f;
}

interface PresetsPanelProps {
  activeId: string;
  onLoad(id: string): void;
  onReset(): void;
}

export function PresetsPanel({ activeId, onLoad, onReset }: PresetsPanelProps) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <>
      <p className="panel-note">Loading a preset replaces plate, grid and modules; style and advanced settings stay.</p>
      <div className="preset-grid">
        {listPresets().map((p) => (
          <button
            key={p.id}
            type="button"
            className={`preset-card${p.id === activeId ? ' active' : ''}`}
            aria-pressed={p.id === activeId}
            aria-label={p.label}
            aria-describedby={`preset-desc-${p.id}`}
            title={p.description}
            onClick={() => onLoad(p.id)}
          >
            <LayoutSvg config={p.config} frame={presetFrame(p)} className="preset-schematic" />
            <span className="preset-label">{p.label}</span>
            <span className="preset-desc" id={`preset-desc-${p.id}`}>
              {p.description}
            </span>
          </button>
        ))}
      </div>
      <div className="row-actions">
        <button
          type="button"
          className={`btn btn-ghost${confirming ? ' btn-danger' : ''}`}
          onClick={() => {
            if (confirming) {
              setConfirming(false);
              onReset();
            } else setConfirming(true);
          }}
        >
          {confirming ? 'Click again to reset everything' : 'Reset all settings'}
        </button>
      </div>
    </>
  );
}
