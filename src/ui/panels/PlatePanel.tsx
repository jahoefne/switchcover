import { getPreset } from '../../config/presets';
import type { CoverConfig } from '../../config/schema';
import type { ConfigUpdater } from '../hooks/useConfig';
import { Group } from '../components/Section';
import { NumberField } from '../components/fields';

interface PlatePanelProps {
  config: CoverConfig;
  update(fn: ConfigUpdater): boolean;
}

/** Drop modules that no longer fit the grid (resolveLayout would only warn about them). */
function pruneModules(c: CoverConfig): void {
  c.modules = c.modules.filter((m) => m.col < c.grid.cols && m.row < c.grid.rows);
}

export function PlatePanel({ config, update }: PlatePanelProps) {
  const { plate, grid } = config;
  const preset = getPreset(plate.preset);
  const setSize = (key: 'w' | 'h', v: number) =>
    update((c) => {
      c.plate[key] = v;
      const p = getPreset(c.plate.preset);
      if (!p || p.id === 'custom' || p.config.plate.w !== c.plate.w || p.config.plate.h !== c.plate.h) c.plate.preset = 'custom';
    });

  return (
    <>
      <p className="panel-note">
        Measure the existing plate (frame) on the wall. Source: <strong>{preset && preset.id !== 'custom' ? preset.label : 'custom size'}</strong>.
      </p>
      <Group title="Plate">
        <NumberField label="Width" unit="mm" value={plate.w} min={20} max={500} step={1} onChange={(v) => setSize('w', v)} />
        <NumberField label="Height" unit="mm" value={plate.h} min={20} max={500} step={1} onChange={(v) => setSize('h', v)} />
        <NumberField
          label="Depth (protrusion)"
          unit="mm"
          value={plate.depth}
          min={0}
          max={50}
          step={0.5}
          hint="How far frame + rocker stand off the wall."
          onChange={(v) => update((c) => void (c.plate.depth = v))}
        />
        <NumberField
          label="Corner radius"
          unit="mm"
          value={plate.cornerR}
          min={0}
          max={100}
          step={0.5}
          onChange={(v) => update((c) => void (c.plate.cornerR = v))}
        />
      </Group>
      <Group title="Module grid">
        <NumberField
          label="Columns"
          value={grid.cols}
          min={1}
          max={10}
          step={1}
          integer
          onChange={(v) =>
            update((c) => {
              c.grid.cols = v;
              pruneModules(c);
            })
          }
        />
        <NumberField
          label="Rows"
          value={grid.rows}
          min={1}
          max={10}
          step={1}
          integer
          onChange={(v) =>
            update((c) => {
              c.grid.rows = v;
              pruneModules(c);
            })
          }
        />
        <NumberField
          label="Pitch X"
          unit="mm"
          value={grid.pitchX}
          min={10}
          max={200}
          step={1}
          hint="Centre-to-centre distance of the switch modules."
          onChange={(v) => update((c) => void (c.grid.pitchX = v))}
        />
        <NumberField
          label="Pitch Y"
          unit="mm"
          value={grid.pitchY}
          min={10}
          max={200}
          step={1}
          onChange={(v) => update((c) => void (c.grid.pitchY = v))}
        />
      </Group>
    </>
  );
}
