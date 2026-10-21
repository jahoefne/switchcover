import { MIN_POCKET_DEPTH } from '../../config/defaults';
import type { CoverConfig, PrintSettings } from '../../config/schema';
import type { CoverFrame } from '../../geometry/contract';
import type { AnyCoverStyle } from '../../styles';
import type { ConfigUpdater } from '../hooks/useConfig';
import { fmt } from '../derive';
import { Group } from '../components/Section';
import { CheckField, NumberField, PairField, Segmented, SelectField } from '../components/fields';

interface AdvancedPanelProps {
  config: CoverConfig;
  frame: CoverFrame;
  style: AnyCoverStyle;
  update(fn: ConfigUpdater): boolean;
}

export function AdvancedPanel({ config, frame, style, update }: AdvancedPanelProps) {
  const { bilresa, cover, print } = config;
  const set = (fn: (c: CoverConfig) => void) => update((c) => void fn(c));
  const autoW = Math.ceil(frame.outer.autoW);
  const autoH = Math.ceil(frame.outer.autoH);
  const floorClamped = frame.floorT > bilresa.floorT + 1e-6;

  return (
    <>
      <Group title="Pocket">
        <NumberField
          label="Pocket depth"
          unit="mm"
          value={bilresa.pocketDepth}
          min={MIN_POCKET_DEPTH}
          max={30}
          step={0.5}
          hint={`The pocket follows the Bilresa's rounded back (8 mm), then runs straight. Deeper = Bilresa sits lower, cover gets taller. Face at ${fmt(frame.frontZ)} mm.`}
          onChange={(v) => set((c) => (c.bilresa.pocketDepth = v))}
        />
        <NumberField
          label="Pocket clearance"
          unit="mm"
          value={bilresa.pocketClearance}
          min={0}
          max={5}
          step={0.1}
          hint="Gap per side between Bilresa and pocket wall."
          onChange={(v) => set((c) => (c.bilresa.pocketClearance = v))}
        />
        <NumberField
          label="Floor thickness"
          unit="mm"
          value={bilresa.floorT}
          min={0.4}
          max={20}
          step={0.1}
          hint={floorClamped ? `Raised to ${fmt(frame.floorT, 2)} mm (strip indent + 1.2 mm).` : undefined}
          onChange={(v) => set((c) => (c.bilresa.floorT = v))}
        />
        <NumberField
          label="Hidden margin"
          unit="mm"
          value={bilresa.hiddenMargin}
          min={0}
          max={30}
          step={0.5}
          hint="The access hole stays this far inside the Bilresa outline (hidden behind it)."
          onChange={(v) => set((c) => (c.bilresa.hiddenMargin = v))}
        />
        <CheckField
          label="Finger notch"
          checked={bilresa.notch.enabled}
          onChange={(v) => set((c) => (c.bilresa.notch.enabled = v))}
        />
        <NumberField
          label="Notch diameter"
          unit="mm"
          value={bilresa.notch.d}
          min={2}
          max={60}
          step={1}
          disabled={!bilresa.notch.enabled}
          onChange={(v) => set((c) => (c.bilresa.notch.d = v))}
        />
        <NumberField
          label="Access hole width"
          unit="mm"
          value={bilresa.access.w}
          min={0}
          max={150}
          step={1}
          hint="One hole under the strip, centred on the pocket; the gaps beside the strip let a tool reach the old switch. Clipped to stay under the Bilresa."
          onChange={(v) => set((c) => (c.bilresa.access.w = v))}
        />
      </Group>

      <Group
        title="Magnet strip"
        note={
          <>
            IKEA's metal strip fills the stadium recess on the Bilresa's back (≈ 22 × 51 mm, ≈ 1 mm proud). Glue it onto
            the two end ledges of the pocket floor; it spans the access hole between them.
          </>
        }
      >
        <SelectField
          label="Shape"
          value={bilresa.strip.shape}
          options={[
            { value: 'stadium', label: 'Stadium' },
            { value: 'rect', label: 'Rectangle' },
          ]}
          onChange={(v) => set((c) => (c.bilresa.strip.shape = v))}
        />
        <PairField
          label="Length × width"
          a={{ ariaLabel: 'Strip length', value: bilresa.strip.l, min: 0.5, max: 150, step: 0.5, unit: 'mm', onChange: (v) => set((c) => (c.bilresa.strip.l = v)) }}
          b={{ ariaLabel: 'Strip width', value: bilresa.strip.w, min: 0.5, max: 100, step: 0.5, unit: 'mm', onChange: (v) => set((c) => (c.bilresa.strip.w = v)) }}
        />
        <NumberField
          label="Protrusion"
          unit="mm"
          value={bilresa.strip.protrusion}
          min={0}
          max={10}
          step={0.1}
          hint="How far the strip stands proud of the Bilresa's back (the floor indent gets this + tolerance)."
          onChange={(v) => set((c) => (c.bilresa.strip.protrusion = v))}
        />
        <PairField
          label="Offset dx × dy"
          a={{ ariaLabel: 'Strip offset X', value: bilresa.strip.dx, min: -50, max: 50, step: 0.5, unit: 'mm', onChange: (v) => set((c) => (c.bilresa.strip.dx = v)) }}
          b={{ ariaLabel: 'Strip offset Y', value: bilresa.strip.dy, min: -50, max: 50, step: 0.5, unit: 'mm', onChange: (v) => set((c) => (c.bilresa.strip.dy = v)) }}
        />
        <NumberField
          label="Glue ledge"
          unit="mm"
          value={bilresa.stripLedge}
          min={0}
          max={30}
          step={0.5}
          hint="Floor length the strip rests on at each end; the access hole spans the strip between the ledges."
          onChange={(v) => set((c) => (c.bilresa.stripLedge = v))}
        />
      </Group>

      <Group title="Print">
        <NumberField
          label="Tolerance"
          unit="mm"
          value={print.tolerance}
          min={0}
          max={2}
          step={0.05}
          hint="Added to the strip indent (depth and outline)."
          onChange={(v) => set((c) => (c.print.tolerance = v))}
        />
        <SelectField<PrintSettings['orientation']>
          label="Orientation"
          value={print.orientation}
          options={[
            { value: 'style', label: `Style default (${style.printOrientation === 'faceDown' ? 'face down' : 'face up'})` },
            { value: 'faceDown', label: 'Face down' },
            { value: 'faceUp', label: 'Face up' },
          ]}
          onChange={(v) => set((c) => (c.print.orientation = v))}
        />
      </Group>

      <Group title="Cover shell">
        <NumberField label="Face (skin)" unit="mm" value={cover.skinT} min={0.4} max={20} step={0.1} onChange={(v) => set((c) => (c.cover.skinT = v))} />
        <NumberField label="Side wall (skirt)" unit="mm" value={cover.skirtT} min={0.4} max={20} step={0.1} onChange={(v) => set((c) => (c.cover.skirtT = v))} />
        <NumberField label="Min. wall" unit="mm" value={cover.minWall} min={0.4} max={20} step={0.1} onChange={(v) => set((c) => (c.cover.minWall = v))} />
        <NumberField
          label="Plate clearance"
          unit="mm"
          value={cover.clearance}
          min={0}
          max={20}
          step={0.1}
          onChange={(v) => set((c) => (c.cover.clearance = v))}
        />
        <NumberField
          label="Rocker gap"
          unit="mm"
          value={cover.rockerGap}
          min={0}
          max={20}
          step={0.1}
          hint="Free space above the plate so rocker ends can lift."
          onChange={(v) => set((c) => (c.cover.rockerGap = v))}
        />
        <NumberField
          label="Margin"
          unit="mm"
          value={cover.margin}
          min={0}
          max={100}
          step={0.5}
          hint="Extra face around pockets / openings when the cover grows."
          onChange={(v) => set((c) => (c.cover.margin = v))}
        />
      </Group>

      <Group title="Cover size">
        <Segmented<'auto' | 'manual'>
          label="Size"
          value={cover.size === 'auto' ? 'auto' : 'manual'}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'manual', label: 'Manual' },
          ]}
          onChange={(mode) =>
            set((c) => {
              c.cover.size = mode === 'auto' ? 'auto' : { w: autoW, h: autoH };
            })
          }
        />
        {cover.size === 'auto' ? (
          <p className="muted small">
            Automatic: {fmt(frame.outer.autoW)} × {fmt(frame.outer.autoH)} mm (fits plate and all features).
          </p>
        ) : (
          <PairField
            label="Width × height"
            hint={`At least ${fmt(frame.outer.autoW)} × ${fmt(frame.outer.autoH)} mm.`}
            a={{
              ariaLabel: 'Cover width',
              value: cover.size.w,
              min: autoW,
              max: 1000,
              step: 1,
              unit: 'mm',
              onChange: (v) => set((c) => void (c.cover.size !== 'auto' && (c.cover.size.w = v))),
            }}
            b={{
              ariaLabel: 'Cover height',
              value: cover.size.h,
              min: autoH,
              max: 1000,
              step: 1,
              unit: 'mm',
              onChange: (v) => set((c) => void (c.cover.size !== 'auto' && (c.cover.size.h = v))),
            }}
          />
        )}
      </Group>
    </>
  );
}
