// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { presetConfig } from '../src/config/presets';
import type { CoverConfig } from '../src/config/schema';
import type { CoverStyle } from '../src/geometry/contract';
import { listStyles, type AnyCoverStyle } from '../src/styles';
import { StylePanel } from '../src/ui/panels/StylePanel';
import { describeStyleParams, humanize } from '../src/ui/styleParams';

const params = z.object({
  edgeR: z.number().min(0).max(20).default(8),
  sag: z.number().min(0).max(3).default(1.5),
  frameWidth: z.number().min(2).max(40).default(10),
  steps: z.number().int().min(2).max(3).default(2),
  groove: z.boolean().default(true),
  finish: z.enum(['matte', 'gloss']).default('matte'),
});

const fakeStyle: CoverStyle<typeof params> = {
  id: 'fake',
  version: 1,
  label: 'Fake',
  description: 'A test style.',
  params,
  ui: {
    edgeR: { label: 'Top edge radius', min: 0, max: 12, step: 0.5, unit: 'mm' },
    sag: { label: 'Dome', min: 0, max: 3, step: 0.1, unit: 'mm' },
  },
  printOrientation: 'faceUp',
  printHint: 'Print face up.',
  limits: (p) => ({ minFrame: 0, minFrontZ: 0, maxEdgeR: 6 + p.sag }),
  surfaceZ: (c) => c.frame.frontZ,
  outerBody: () => {
    throw new Error('not used');
  },
  openingEdge: () => ({ kind: 'sharp' }),
};
const style = fakeStyle as unknown as AnyCoverStyle;
const defaults = params.parse({}) as Record<string, unknown>;

afterEach(() => cleanup());

describe('describeStyleParams', () => {
  it('maps zod fields + ui metadata to controls and clamps edge radii to maxEdgeR', () => {
    const controls = describeStyleParams(style, defaults, { minFrame: 0, minFrontZ: 0, maxEdgeR: 7.5 });
    const byKey = Object.fromEntries(controls.map((c) => [c.key, c]));
    expect(byKey.edgeR).toMatchObject({ kind: 'number', label: 'Top edge radius', min: 0, max: 7.5, step: 0.5, unit: 'mm', slider: true, clampedBy: 'maxEdgeR', value: 8 });
    expect(byKey.sag).toMatchObject({ kind: 'number', min: 0, max: 3, slider: true, value: 1.5 });
    expect(byKey.sag).not.toHaveProperty('clampedBy', 'maxEdgeR');
    // No ui metadata: schema bounds, plain number input, humanized label.
    expect(byKey.frameWidth).toMatchObject({ kind: 'number', label: 'Frame width', min: 2, max: 40, slider: false, step: 0.1 });
    expect(byKey.steps).toMatchObject({ kind: 'number', step: 1, min: 2, max: 3 });
    expect(byKey.groove).toEqual({ key: 'groove', kind: 'boolean', label: 'Groove', value: true });
    expect(byKey.finish).toMatchObject({ kind: 'enum', options: ['matte', 'gloss'], value: 'matte' });
  });

  it('does not clamp when maxEdgeR is infinite or larger than the range', () => {
    const controls = describeStyleParams(style, defaults, { minFrame: 0, minFrontZ: 0, maxEdgeR: Infinity });
    expect(controls.find((c) => c.key === 'edgeR')).toMatchObject({ max: 12 });
    expect(controls.find((c) => c.key === 'edgeR')).not.toHaveProperty('clampedBy', 'maxEdgeR');
  });

  it('humanizes camelCase keys', () => {
    expect(humanize('topEdgeR')).toBe('Top edge r');
    expect(humanize('frame_width')).toBe('Frame width');
  });
});

describe('StylePanel', () => {
  function renderPanel(config: CoverConfig, update = vi.fn(() => true)) {
    const p = style.params.parse(config.cover.styleParams) as Record<string, unknown>;
    const limits = style.limits(p, { w: 90, h: 90, protrusion: 12, cornerR: 3, clearance: 1 });
    render(<StylePanel config={config} style={style} params={p} limits={limits} update={update} />);
    return update;
  }

  it('reflects the style limit clamp on the slider and stores only valid overrides', () => {
    const config = presetConfig('ch-sd-1x1');
    config.cover.style = 'fake';
    const update = renderPanel(config);
    const slider = screen.getByLabelText('Top edge radius slider') as HTMLInputElement;
    expect(slider.max).toBe('7.5'); // maxEdgeR = 6 + sag 1.5
    expect(screen.getByText(/Limited to 7\.5 mm/)).toBeTruthy();
    expect(screen.getByText('A test style.')).toBeTruthy();
    expect(screen.getByText(/Print face up\./)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Groove'));
    const updater = (update.mock.calls.at(-1) as unknown as [(c: CoverConfig) => void])[0];
    const draft = structuredClone(config);
    updater(draft);
    expect(draft.cover.styleParams).toEqual({ groove: false });

    const lastParams = () => {
      const fn = (update.mock.calls.at(-1) as unknown as [(c: CoverConfig) => void])[0];
      const d = structuredClone(config);
      fn(d);
      return d.cover.styleParams;
    };
    fireEvent.change(slider, { target: { value: '5' } });
    expect(lastParams()).toEqual({ edgeR: 5 });

    // Typed values above the limit are clamped on blur before they are stored.
    const input = screen.getByLabelText('Top edge radius') as HTMLInputElement;
    expect(input.max).toBe('7.5');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '11' } });
    fireEvent.blur(input);
    expect(lastParams()).toEqual({ edgeR: 7.5 });
  });

  it('resets params when switching styles', () => {
    const config = presetConfig('ch-sd-1x1');
    config.cover.style = 'fake';
    config.cover.styleParams = { edgeR: 3 };
    const update = renderPanel(config);
    const select = screen.getByLabelText('Style') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([...listStyles().map((s) => s.id), 'fake']);
    fireEvent.change(select, { target: { value: 'box' } });
    const updater = (update.mock.calls.at(-1) as unknown as [(c: CoverConfig) => void])[0];
    const draft = structuredClone(config);
    updater(draft);
    expect(draft.cover).toMatchObject({ style: 'box', styleParams: {} });
  });
});
