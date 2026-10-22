import { BILRESA_VARIANTS, MIN_POCKET_DEPTH, PASSTHROUGH_DEFAULT } from '../../config/defaults';
import type { CoverConfig, ModuleConfig, ModuleRole, OpeningSpec, Rotation } from '../../config/schema';
import type { BilresaVariant, CoverFrame, Shape2D } from '../../geometry/contract';
import { featureId, openingShape } from '../../layout/resolve';
import type { ConfigUpdater } from '../hooks/useConfig';
import { defaultOutlet } from '../derive';
import { Group } from '../components/Section';
import { CheckField, NumberField, Segmented, SelectField, type SelectOption } from '../components/fields';
import { LayoutSvg, type Cell } from './LayoutSvg';
import { GridOffsetFields } from './PlatePanel';

const ROLE_OPTIONS: SelectOption<ModuleRole>[] = [
  { value: 'bilresa', label: 'Bilresa pocket' },
  { value: 'outlet', label: 'Outlet opening' },
  { value: 'passthrough', label: 'Passthrough (keep device reachable)' },
  { value: 'blank', label: 'Blank (covered)' },
];

const VARIANT_OPTIONS: SelectOption<BilresaVariant>[] = (Object.keys(BILRESA_VARIANTS) as BilresaVariant[]).map((v) => ({
  value: v,
  label: BILRESA_VARIANTS[v].label,
}));

const ROTATIONS: { value: Rotation; label: string }[] = [
  { value: 0, label: '0°' },
  { value: 90, label: '90°' },
  { value: 180, label: '180°' },
  { value: 270, label: '270°' },
];

type NotchMode = 'default' | 'on' | 'off';

const SHAPE_OPTIONS: SelectOption<OpeningSpec['shape']>[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'roundedRect', label: 'Rounded rectangle' },
  { value: 'stadium', label: 'Stadium' },
];

/**
 * New opening spec from the effective (resolved) shape plus a patch. Switching shapes keeps
 * the current size (circle d ↔ min(w, h)).
 */
export function patchOpening(current: Shape2D, patch: Partial<OpeningSpec>): OpeningSpec {
  const cur =
    current.kind === 'circle'
      ? { d: current.d, w: current.d, h: current.d, cornerR: 4 }
      : { d: Math.min(current.w, current.h), w: current.w, h: current.h, cornerR: current.kind === 'roundedRect' ? current.r : 4 };
  const shape = patch.shape ?? current.kind;
  const v = { ...cur, ...patch };
  if (shape === 'circle') return { shape, d: v.d };
  if (shape === 'stadium') return { shape, w: v.w, h: v.h };
  return { shape, w: v.w, h: v.h, cornerR: v.cornerR };
}

/** Switch a module's role, filling in sensible defaults for the new role. */
export function applyRole(m: ModuleConfig, role: ModuleRole, config: CoverConfig): void {
  if (m.role === role) return;
  m.role = role;
  delete m.bilresa;
  delete m.opening;
  if (role === 'bilresa') m.bilresa = { variant: '2button' };
  else if (role === 'outlet') m.opening = defaultOutlet(config);
  else if (role === 'passthrough') m.opening = { ...PASSTHROUGH_DEFAULT };
}

interface ModulesPanelProps {
  config: CoverConfig;
  frame: CoverFrame;
  update(fn: ConfigUpdater): boolean;
  selected: Cell;
  onSelect(cell: Cell): void;
}

export function ModulesPanel({ config, frame, update, selected, onSelect }: ModulesPanelProps) {
  const { grid } = config;
  const extension = config.part.kind === 'extension';
  const cell =
    selected.col < grid.cols && selected.row < grid.rows ? selected : { col: 0, row: 0 };
  const module = config.modules.find((m) => m.col === cell.col && m.row === cell.row);
  const id = featureId(cell.col, cell.row);
  const cellWarnings = frame.warnings.filter((w) => w.featureId === id);

  const edit = (fn: (m: ModuleConfig, c: CoverConfig) => void) =>
    update((c) => {
      const m = c.modules.find((x) => x.col === cell.col && x.row === cell.row);
      if (m) fn(m, c);
    });

  return (
    <>
      <LayoutSvg
        config={config}
        frame={frame}
        interactive
        selected={cell}
        onSelect={onSelect}
        className="module-grid"
        title="Module grid (front view). Select a cell to edit it."
      />
      <div className="legend" aria-hidden="true">
        <span className="lg lg-pocket">Bilresa</span>
        {!extension && <span className="lg lg-outlet">Outlet</span>}
        {!extension && <span className="lg lg-pass">Passthrough</span>}
        {extension ? <span className="lg lg-rim">Rim + cove</span> : <span className="lg lg-hole">Access hole</span>}
        <span className="lg lg-cover">{extension ? 'Extension outline' : 'Cover outline'}</span>
      </div>
      {extension && (
        <p className="panel-note">
          The grid is the extension's own: one cell per module, laid out beside the plate. Only Bilresa pockets (and blanks)
          make sense here; outlets and passthroughs are ignored.
        </p>
      )}
      <GridOffsetFields config={config} update={update} />

      <div className="module-editor">
        <h3>
          Column {cell.col + 1}, row {cell.row + 1} <span className="muted">({id})</span>
        </h3>
        {!module ? (
          <div className="empty-cell">
            <p className="muted">{extension ? 'This cell is empty (plain slab).' : 'This cell is empty (the plate stays covered).'}</p>
            <button
              type="button"
              className="btn"
              onClick={() =>
                update((c) => {
                  c.modules.push({ col: cell.col, row: cell.row, role: 'bilresa', rot: 0, dx: 0, dy: 0, bilresa: { variant: '2button' } });
                })
              }
            >
              Add module
            </button>
          </div>
        ) : (
          <ModuleEditor module={module} config={config} edit={edit} />
        )}
        {module && (
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => update((c) => void (c.modules = c.modules.filter((m) => !(m.col === cell.col && m.row === cell.row))))}
            >
              Remove module
            </button>
          </div>
        )}
        {cellWarnings.length > 0 && (
          <ul className="warning-list compact">
            {cellWarnings.map((w, i) => (
              <li key={i} className={`sev-${w.severity}`}>
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

interface ModuleEditorProps {
  module: ModuleConfig;
  config: CoverConfig;
  edit(fn: (m: ModuleConfig, c: CoverConfig) => void): void;
}

function ModuleEditor({ module: m, config, edit }: ModuleEditorProps) {
  const notchMode: NotchMode = m.bilresa?.notch === undefined ? 'default' : m.bilresa.notch ? 'on' : 'off';
  const isOpening = m.role === 'outlet' || m.role === 'passthrough';
  // An extension holds pockets only; an opening left over from a cap layout stays selectable so it can be changed.
  const roleOptions =
    config.part.kind === 'extension' ? ROLE_OPTIONS.filter((o) => o.value === 'bilresa' || o.value === 'blank' || o.value === m.role) : ROLE_OPTIONS;
  const shape = isOpening ? openingShape(m.opening, m.role as 'outlet' | 'passthrough') : null;

  const setOpening = (patch: Partial<OpeningSpec>) =>
    edit((x) => {
      x.opening = patchOpening(openingShape(x.opening, x.role === 'passthrough' ? 'passthrough' : 'outlet'), patch);
    });

  return (
    <>
      <SelectField label="Role" value={m.role} options={roleOptions} onChange={(role) => edit((x, c) => applyRole(x, role, c))} />
      {m.role !== 'blank' && (
        <>
          <Segmented label="Rotation" value={m.rot} options={ROTATIONS} onChange={(rot) => edit((x) => void (x.rot = rot))} />
          <NumberField
            label="Offset X (dx)"
            unit="mm"
            value={m.dx}
            min={-100}
            max={100}
            step={0.5}
            onChange={(v) => edit((x) => void (x.dx = v))}
          />
          <NumberField
            label="Offset Y (dy, up)"
            unit="mm"
            value={m.dy}
            min={-100}
            max={100}
            step={0.5}
            onChange={(v) => edit((x) => void (x.dy = v))}
          />
        </>
      )}
      {m.role === 'bilresa' && (
        <Group title="Bilresa">
          <SelectField
            label="Variant"
            value={m.bilresa?.variant ?? '2button'}
            options={VARIANT_OPTIONS}
            onChange={(variant) => edit((x) => void (x.bilresa = { ...x.bilresa, variant }))}
          />
          <CheckField
            label="Own pocket depth"
            checked={m.bilresa?.pocketDepth !== undefined}
            onChange={(on) =>
              edit((x, c) => {
                const b = { variant: '2button' as BilresaVariant, ...x.bilresa };
                if (on) b.pocketDepth = c.bilresa.pocketDepth;
                else delete b.pocketDepth;
                x.bilresa = b;
              })
            }
          />
          {m.bilresa?.pocketDepth !== undefined && (
            <NumberField
              label="Pocket depth"
              unit="mm"
              value={m.bilresa.pocketDepth}
              min={MIN_POCKET_DEPTH}
              max={30}
              step={0.5}
              onChange={(v) => edit((x) => void (x.bilresa = { variant: '2button', ...x.bilresa, pocketDepth: v }))}
            />
          )}
          <SelectField<NotchMode>
            label="Finger notch"
            value={notchMode}
            options={[
              { value: 'default', label: `Default (${config.bilresa.notch.enabled ? 'on' : 'off'})` },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(mode) =>
              edit((x) => {
                const b = { variant: '2button' as BilresaVariant, ...x.bilresa };
                if (mode === 'default') delete b.notch;
                else b.notch = mode === 'on';
                x.bilresa = b;
              })
            }
          />
        </Group>
      )}
      {shape && (
        <Group title={m.role === 'outlet' ? 'Outlet opening' : 'Passthrough opening'}>
          <SelectField label="Shape" value={shape.kind} options={SHAPE_OPTIONS} onChange={(kind) => setOpening({ shape: kind })} />
          {shape.kind === 'circle' ? (
            <NumberField label="Diameter" unit="mm" value={shape.d} min={1} max={300} step={0.5} onChange={(d) => setOpening({ d })} />
          ) : (
            <>
              <NumberField label="Width" unit="mm" value={shape.w} min={1} max={300} step={0.5} onChange={(w) => setOpening({ w })} />
              <NumberField label="Height" unit="mm" value={shape.h} min={1} max={300} step={0.5} onChange={(h) => setOpening({ h })} />
              {shape.kind === 'roundedRect' && (
                <NumberField
                  label="Corner radius"
                  unit="mm"
                  value={shape.r}
                  min={0}
                  max={150}
                  step={0.5}
                  onChange={(cornerR) => setOpening({ cornerR })}
                />
              )}
            </>
          )}
        </Group>
      )}
    </>
  );
}
