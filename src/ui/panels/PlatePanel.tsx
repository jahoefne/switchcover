import { useEffect, useState } from 'react';
import { getPreset } from '../../config/presets';
import type { CoverConfig, ExtensionSide, PartKind } from '../../config/schema';
import type { ConfigUpdater } from '../hooks/useConfig';
import { Group } from '../components/Section';
import { NumberField, Segmented, SelectField } from '../components/fields';

const SIDE_OPTIONS: { value: ExtensionSide; label: string }[] = [
  { value: 'top', label: 'Above the plate' },
  { value: 'bottom', label: 'Below the plate' },
  { value: 'left', label: 'Left of the plate' },
  { value: 'right', label: 'Right of the plate' },
];

/**
 * What the printed part is: a cap over the plate, or an extension beside it (the plate stays in
 * use; the slab is flush with its face and holds the Bilresa in a raised pocket).
 */
export function PartFields({ config, update }: PlatePanelProps) {
  const { part } = config;
  const extension = part.kind === 'extension';
  return (
    <Group title="Part">
      <Segmented<PartKind>
        label="Kind"
        value={part.kind}
        options={[
          { value: 'cap', label: 'Cap over the plate' },
          { value: 'extension', label: 'Extension beside it' },
        ]}
        onChange={(kind) => update((c) => void (c.part.kind = kind))}
      />
      <p className="muted small">
        {extension
          ? 'The plate stays in use. A solid slab glued to the wall beside it, flush with its face, holds the Bilresa; where the pocket is deeper than the slab its rim rises from the face through a curved cove. Printed face up.'
          : 'A hollow cover glued over the plate; the Bilresa sits in a pocket of its face, the old switch stays reachable through an access hole.'}
      </p>
      {extension && (
        <>
          <SelectField label="Side" value={part.side} options={SIDE_OPTIONS} onChange={(side) => update((c) => void (c.part.side = side))} />
          <NumberField
            label="Gap to the plate"
            unit="mm"
            value={part.gap}
            min={0}
            max={50}
            step={0.5}
            hint="Between the plate's edge and the extension (0 = touching)."
            onChange={(v) => update((c) => void (c.part.gap = v))}
          />
          <NumberField
            label="Rim cove"
            unit="mm"
            value={part.flare}
            min={0}
            max={30}
            step={0.5}
            hint="Width of the curved rise from the face up to the pocket rim (0 = a straight step)."
            onChange={(v) => update((c) => void (c.part.flare = v))}
          />
        </>
      )}
    </Group>
  );
}

interface PlatePanelProps {
  config: CoverConfig;
  update(fn: ConfigUpdater): boolean;
}

/**
 * Grid offset inputs (shift of the whole module grid from the plate centre), behind an
 * "advanced" disclosure: most plates centre their devices, a few (the Swiss switch + socket
 * combo) do not. Used by the Plate panel and the module editor.
 */
export function GridOffsetFields({ config, update }: PlatePanelProps) {
  const { grid } = config;
  const shifted = grid.offsetX !== 0 || grid.offsetY !== 0;
  // Opens by itself for a shifted grid (e.g. after loading the combo preset), never closes by itself.
  const [open, setOpen] = useState(shifted);
  useEffect(() => {
    if (shifted) setOpen(true);
  }, [shifted]);
  return (
    <details className="advanced-disclosure" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Advanced: grid offset{shifted && <span className="muted"> ({grid.offsetX}, {grid.offsetY} mm)</span>}
      </summary>
      <NumberField
        label="Grid offset X"
        unit="mm"
        value={grid.offsetX}
        min={-200}
        max={200}
        step={0.5}
        hint="Moves every module (and its anchor) right of the plate centre."
        onChange={(v) => update((c) => void (c.grid.offsetX = v))}
      />
      <NumberField
        label="Grid offset Y"
        unit="mm"
        value={grid.offsetY}
        min={-200}
        max={200}
        step={0.5}
        hint="Moves every module up (devices not centred on the plate)."
        onChange={(v) => update((c) => void (c.grid.offsetY = v))}
      />
    </details>
  );
}

/** Drop modules that no longer fit the grid (resolveLayout would only warn about them). */
function pruneModules(c: CoverConfig): void {
  c.modules = c.modules.filter((m) => m.col < c.grid.cols && m.row < c.grid.rows);
}

export function PlatePanel({ config, update }: PlatePanelProps) {
  const { plate, grid } = config;
  const preset = getPreset(plate.preset);
  const extension = config.part.kind === 'extension';
  const setSize = (key: 'w' | 'h', v: number) =>
    update((c) => {
      c.plate[key] = v;
      const p = getPreset(c.plate.preset);
      if (!p || p.id === 'custom' || p.config.plate.w !== c.plate.w || p.config.plate.h !== c.plate.h) c.plate.preset = 'custom';
    });

  return (
    <>
      <PartFields config={config} update={update} />
      <p className="panel-note">
        Measure the existing plate (frame) on the wall. Source: <strong>{preset && preset.id !== 'custom' ? preset.label : 'custom size'}</strong>.
        {extension && ' The extension takes its face height, width and corner radius from it.'}
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
          hint={extension ? "How far the plate stands off the wall: the extension's face sits at the same height." : 'How far frame + rocker stand off the wall.'}
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
      <Group title="Module grid" note={extension ? "The extension's own grid, laid out beside the plate: one cell per Bilresa, the slab covers all cells." : undefined}>
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
        <GridOffsetFields config={config} update={update} />
      </Group>
    </>
  );
}
