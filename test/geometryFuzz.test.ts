/**
 * Seeded random layouts (see randomConfig): every build must be a valid single solid, and,
 * unless the resolver already reports overlapping features, have exactly the predicted
 * number of through-holes. Catches topology bugs the presets do not reach (rotated wheel
 * pockets next to openings, thin skins / skirts, notches near the edge, style params).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCover } from '../src/geometry/buildCover';
import type { Kit } from '../src/geometry/contract';
import { liveObjectCount, withScope } from '../src/geometry/kit';
import { randomConfig } from './helpers/configs';
import { getKit } from './helpers/manifold';

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

let kit: Kit;
beforeAll(async () => {
  kit = await getKit('preview');
});

describe('random layouts', () => {
  it.each(SEEDS)('seed %i builds a valid cover', (seed) => {
    const before = liveObjectCount();
    withScope(() => {
      const b = buildCover(kit, randomConfig(seed));
      expect(b.manifold.status()).toBe('NoError');
      expect(b.manifold.isEmpty()).toBe(false);
      expect(b.warnings.filter((w) => w.code.startsWith('geometry-'))).toEqual([]);
      if (b.expectedGenus !== null) expect(b.manifold.genus()).toBe(b.expectedGenus);
    });
    expect(liveObjectCount()).toBe(before);
  });
});
