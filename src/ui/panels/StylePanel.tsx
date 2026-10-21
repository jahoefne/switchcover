import type { CoverConfig } from '../../config/schema';
import type { StyleLimits } from '../../geometry/contract';
import { listStyles, type AnyCoverStyle } from '../../styles';
import type { ConfigUpdater } from '../hooks/useConfig';
import { fmt } from '../derive';
import { CheckField, NumberField, SelectField, SliderField } from '../components/fields';
import { clampControl, describeStyleParams } from '../styleParams';

interface StylePanelProps {
  config: CoverConfig;
  style: AnyCoverStyle;
  params: Record<string, unknown>;
  limits: StyleLimits;
  update(fn: ConfigUpdater): boolean;
}

export function StylePanel({ config, style, params, limits, update }: StylePanelProps) {
  const styles = listStyles();
  const controls = describeStyleParams(style, params, limits);
  const known = styles.some((s) => s.id === config.cover.style);

  const setParam = (key: string, value: unknown) =>
    update((c) => {
      // Store only overrides (short links); fall back to the parsed params if the stored ones
      // were invalid. Values the style rejects are not stored at all.
      const next = { ...c.cover.styleParams, [key]: value };
      const repaired = { ...params, [key]: value };
      if (style.params.safeParse(next).success) c.cover.styleParams = next;
      else if (style.params.safeParse(repaired).success) c.cover.styleParams = repaired;
    });

  const options = styles.map((s) => ({ value: s.id, label: s.label }));
  if (!known) options.push({ value: config.cover.style, label: `${config.cover.style} (unknown)` });

  return (
    <>
      <SelectField
        label="Style"
        value={config.cover.style}
        options={options}
        onChange={(id) =>
          update((c) => {
            if (c.cover.style === id) return;
            c.cover.style = id;
            c.cover.styleParams = {};
          })
        }
      />
      <p className="panel-note">{style.description}</p>
      {controls.length === 0 && <p className="muted small">This style has no parameters.</p>}
      {controls.map((ctl) => {
        switch (ctl.kind) {
          case 'number': {
            const hint =
              ctl.clampedBy === 'maxEdgeR'
                ? `Limited to ${fmt(limits.maxEdgeR, 2)} mm by this cover's size.`
                : undefined;
            const onChange = (v: number) => setParam(ctl.key, clampControl(ctl, v));
            return ctl.slider ? (
              <SliderField
                key={ctl.key}
                label={ctl.label}
                value={ctl.value}
                min={ctl.min}
                max={ctl.max}
                step={ctl.step}
                unit={ctl.unit}
                hint={hint}
                onChange={onChange}
              />
            ) : (
              <NumberField
                key={ctl.key}
                label={ctl.label}
                value={ctl.value}
                min={ctl.min}
                max={ctl.max}
                step={ctl.step}
                unit={ctl.unit}
                hint={hint}
                onChange={onChange}
              />
            );
          }
          case 'boolean':
            return <CheckField key={ctl.key} label={ctl.label} checked={ctl.value} onChange={(v) => setParam(ctl.key, v)} />;
          case 'enum':
            return (
              <SelectField
                key={ctl.key}
                label={ctl.label}
                value={ctl.value}
                options={ctl.options.map((o) => ({ value: o, label: o }))}
                onChange={(v) => setParam(ctl.key, v)}
              />
            );
          default:
            return (
              <p key={ctl.key} className="muted small">
                {ctl.label}: {JSON.stringify(ctl.value)} (not editable here)
              </p>
            );
        }
      })}
      <p className="print-hint">
        <strong>Print:</strong> {style.printOrientation === 'faceDown' ? 'face down' : 'face up'} by default. {style.printHint}
      </p>
    </>
  );
}
