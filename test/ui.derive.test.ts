import { describe, expect, it } from 'vitest';
import { presetConfig } from '../src/config/presets';
import { outlineOffsetText, stlFilename } from '../src/ui/derive';
import { needsRefit } from '../src/ui/viewer/fit';

describe('UI helpers', () => {
  it('names exports after the preset id and the style', () => {
    const c = presetConfig('ch-sd-1x2v-switch-socket');
    expect(stlFilename(c, 'export')).toBe('switchcover-ch-sd-1x2v-switch-socket-minimal.stl');
    c.cover.style = 'organic';
    expect(stlFilename(c, 'testFit')).toBe('switchcover-ch-sd-1x2v-switch-socket-organic-testfit.stl');
  });

  it('describes an off-centre outline relative to the plate centre', () => {
    expect(outlineOffsetText({ cx: 0, cy: 0 })).toBe('');
    expect(outlineOffsetText({ cx: 0.01, cy: -0.02 })).toBe('');
    expect(outlineOffsetText({ cx: 0, cy: 6.7 })).toBe('centred 6.7 mm above the plate centre');
    expect(outlineOffsetText({ cx: -3.95, cy: -0.5 })).toBe('centred 0.5 mm below and 4 mm left of the plate centre');
  });

  it('refits the camera when the outline grows, shrinks or moves a lot', () => {
    const outer = { w: 96.8, h: 96.8, cx: 0, cy: 0 };
    expect(needsRefit([0, 0, 0, 0], outer)).toBe(true);
    expect(needsRefit([96.8, 96.8, 0, 0], outer)).toBe(false);
    expect(needsRefit([96.8, 96.8, 0, 0], { ...outer, h: 110.2, cy: 6.7 })).toBe(false); // the combo: small change
    expect(needsRefit([96.8, 96.8, 0, 0], { ...outer, h: 156.8 })).toBe(true);
    expect(needsRefit([96.8, 96.8, 0, 0], { ...outer, cy: 20 })).toBe(true);
  });
});
