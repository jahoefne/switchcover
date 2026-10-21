/**
 * Geometry regression: the volume of every preset × style cover (preview quality; the 1×1 at
 * export quality too) against committed numbers (test/fixtures/coverVolumes.ts). A refactor that
 * must not change geometry keeps these bit for bit; an intentional geometry change regenerates
 * the fixture:
 *
 *   UPDATE_COVER_VOLUMES=1 npx vitest run test/volumes.test.ts
 *
 * and the diff of the fixture then documents which covers changed and by how much.
 */
import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { listPresets, presetConfig } from '../src/config/presets';
import { buildCover } from '../src/geometry/buildCover';
import type { Kit, Quality } from '../src/geometry/contract';
import { withScope } from '../src/geometry/kit';
import { listStyles } from '../src/styles';
import { COVER_VOLUMES, type CoverVolumeKey } from './fixtures/coverVolumes';
import { getKit } from './helpers/manifold';

const PRESETS = listPresets().map((p) => p.id);
const STYLES = listStyles().map((s) => s.id);
const EXPORT_PRESETS = ['ch-sd-1x1'];

const key = (styleId: string, presetId: string, quality: Quality) => `${styleId} ${presetId} ${quality}` as CoverVolumeKey;

const cases: Array<[string, string, Quality]> = [
  ...STYLES.flatMap((s) => PRESETS.map((p) => [s, p, 'preview'] as [string, string, Quality])),
  ...STYLES.flatMap((s) => EXPORT_PRESETS.map((p) => [s, p, 'export'] as [string, string, Quality])),
];

function volumeOf(kit: Kit, styleId: string, presetId: string): number {
  return withScope(() => {
    const cfg = presetConfig(presetId);
    cfg.cover.style = styleId;
    cfg.cover.styleParams = {};
    const b = buildCover(kit, cfg);
    expect(b.warnings.filter((w) => w.severity === 'error')).toEqual([]);
    return b.manifold.volume();
  });
}

const kits: Partial<Record<Quality, Kit>> = {};
beforeAll(async () => {
  kits.preview = await getKit('preview');
  kits.export = await getKit('export');
});

if (process.env.UPDATE_COVER_VOLUMES) {
  it('regenerates test/fixtures/coverVolumes.ts', () => {
    const lines = cases.map(([s, p, q]) => `  '${key(s, p, q)}': ${volumeOf(kits[q]!, s, p)},`);
    const header = [
      '/**',
      ' * Cover volumes (mm³) of every preset × style at preview quality, and the 1×1 at export quality,',
      ' * as built by buildCover. Checked by test/volumes.test.ts; regenerate with',
      ' *   UPDATE_COVER_VOLUMES=1 npx vitest run test/volumes.test.ts',
      ' * only for an intentional geometry change (the diff then lists what changed).',
      ` * Generated on ${new Date().toISOString().slice(0, 10)}.`,
      ' */',
      'export const COVER_VOLUMES = {',
    ];
    const body = [...header, ...lines, '} as const;', '', 'export type CoverVolumeKey = keyof typeof COVER_VOLUMES;', ''].join('\n');
    writeFileSync(new URL('./fixtures/coverVolumes.ts', import.meta.url), body);
  });
} else {
  describe('cover volumes match the committed fixture (no geometry change)', () => {
    it('covers every preset × style', () => {
      expect(Object.keys(COVER_VOLUMES).sort()).toEqual(cases.map(([s, p, q]) => key(s, p, q)).sort());
    });

    it.each(cases)('%s %s (%s)', (styleId, presetId, quality) => {
      const expected: number = COVER_VOLUMES[key(styleId, presetId, quality)];
      const volume = volumeOf(kits[quality]!, styleId, presetId);
      // identical code paths give identical floats; 1e-6 mm³ leaves room for nothing but noise
      expect(Math.abs(volume - expected), `${styleId} ${presetId} ${quality}: ${volume} vs ${expected}`).toBeLessThan(1e-6);
    });
  });
}
