import { beforeAll, describe, expect, it } from 'vitest';
import { listPresets, presetConfig } from '../src/config/presets';
import { buildCover } from '../src/geometry/buildCover';
import type { Kit } from '../src/geometry/contract';
import { parseBinaryStl, stlTriangleCount, toBinaryStl } from '../src/geometry/export/stl';
import { withScope } from '../src/geometry/kit';
import { listStyles } from '../src/styles';
import { getKit } from './helpers/manifold';

/** Degenerate faces and edges not shared by exactly two faces, judged by float32 position. */
function soupReport(buffer: ArrayBuffer): { triangles: number; degenerate: number; nonManifoldEdges: number } {
  const { indices } = parseBinaryStl(buffer);
  const edges = new Map<string, number>();
  let degenerate = 0;
  const nTri = indices.length / 3;
  for (let t = 0; t < nTri; t++) {
    const i = indices[3 * t];
    const j = indices[3 * t + 1];
    const k = indices[3 * t + 2];
    if (i === j || j === k || k === i) {
      degenerate++;
      continue;
    }
    for (const [u, v] of [
      [i, j],
      [j, k],
      [k, i],
    ]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let nonManifoldEdges = 0;
  for (const n of edges.values()) if (n !== 2) nonManifoldEdges++;
  return { triangles: nTri, degenerate, nonManifoldEdges };
}

describe('exported STL soup is a closed surface by float32 position (slicers report no repairs)', () => {
  let kit: Kit;
  beforeAll(async () => {
    kit = await getKit('export');
  });

  it.each(listPresets().map((p) => p.id))('%s, default style, face-down', (id) => {
    withScope(() => {
      const { manifold } = buildCover(kit, presetConfig(id));
      const stl = toBinaryStl(manifold, { orientation: 'faceDown' });
      const r = soupReport(stl);
      expect(stlTriangleCount(stl)).toBe(r.triangles);
      expect(r.degenerate).toBe(0);
      expect(r.nonManifoldEdges).toBe(0);
      return null;
    });
  });

  it.each(listStyles().map((s) => s.id))('switch + socket, style %s, both orientations', (styleId) => {
    withScope(() => {
      const c = presetConfig('ch-sd-1x2v-switch-socket');
      c.cover.style = styleId;
      const { manifold } = buildCover(kit, c);
      for (const orientation of ['faceDown', 'faceUp'] as const) {
        const r = soupReport(toBinaryStl(manifold, { orientation }));
        expect(r.degenerate).toBe(0);
        expect(r.nonManifoldEdges).toBe(0);
      }
      return null;
    });
  });
});
