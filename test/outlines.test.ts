/**
 * The automatic cover outline of every preset × style against the committed numbers
 * (test/fixtures/coverOutlines.ts): symmetric content keeps a centred outline of the former
 * symmetric size; asymmetric content gets the tighter, off-centre union of its requirement boxes.
 */
import { describe, expect, it } from 'vitest';
import { listPresets, presetConfig } from '../src/config/presets';
import { listStyles } from '../src/styles';
import { deriveFrame } from '../src/ui/derive';
import { COVER_OUTLINES } from './fixtures/coverOutlines';

const PRESETS = listPresets().map((p) => p.id);
const STYLES = listStyles().map((s) => s.id);
const cases = STYLES.flatMap((s) => PRESETS.map((p) => [s, p] as const));

function outlineOf(styleId: string, presetId: string) {
  const c = presetConfig(presetId);
  c.cover.style = styleId;
  c.cover.styleParams = {};
  return deriveFrame(c).frame.outer;
}

describe('automatic cover outline of every preset × style', () => {
  it('covers every preset × style', () => {
    expect(Object.keys(COVER_OUTLINES).sort()).toEqual(cases.map(([s, p]) => `${s} ${p}`).sort());
  });

  it.each(cases)('%s %s', (styleId, presetId) => {
    const want = COVER_OUTLINES[`${styleId} ${presetId}`];
    const got = outlineOf(styleId, presetId);
    expect([got.w, got.h, got.autoW, got.autoH]).toEqual([want.w, want.h, want.w, want.h]);
    expect(got.cx).toBeCloseTo(want.cx, 3);
    expect(got.cy).toBeCloseTo(want.cy, 3);
    if (!want.symmetric) {
      // symmetric content: exactly centred on the plate (no float noise), the former size
      expect(Object.is(got.cx, 0) && Object.is(got.cy, 0), `centre ${got.cx}, ${got.cy}`).toBe(true);
    } else {
      // asymmetric content: the former symmetric outline is this one mirrored about the plate centre
      expect(Math.abs(got.cx) + Math.abs(got.cy)).toBeGreaterThan(0.1);
      expect(got.w + 2 * Math.abs(got.cx)).toBeCloseTo(want.symmetric.w, 1);
      expect(got.h + 2 * Math.abs(got.cy)).toBeCloseTo(want.symmetric.h, 1);
      expect(got.w).toBeLessThanOrEqual(want.symmetric.w);
      expect(got.h).toBeLessThanOrEqual(want.symmetric.h);
    }
  });
});
