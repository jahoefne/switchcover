import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { listPresets, presetConfig } from '../src/config/presets';
import { buildCover } from '../src/geometry/buildCover';
import { isBuildError, type BuildResult, type Kit } from '../src/geometry/contract';
import { liveObjectCount, withScope } from '../src/geometry/kit';
import { getStyle, listStyles, parseStyleParams, resolveStyle } from '../src/styles';
import { handleRequest } from '../src/worker/handler';
import { expectSolid, getKit, getWasm } from './helpers/manifold';

let kit: Kit;
let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await getWasm();
  kit = await getKit('preview');
});

describe('stub buildCover (outerBody − cavity)', () => {
  it.each(listPresets().map((p) => [p.id] as const))('%s: valid, non-empty, bbox = frame', (id) => {
    const before = liveObjectCount();
    withScope(() => {
      const { manifold, frame } = buildCover(kit, presetConfig(id));
      const { w, h, cx, cy } = frame.outer;
      expectSolid(manifold, [cx - w / 2, cy - h / 2, 0], [cx + w / 2, cy + h / 2, frame.frontZ], 1e-4);
      expect(manifold.boundingBox().min[2]).toBe(0);
      expect(manifold.decompose().length).toBe(1);
      expect(manifold.genus()).toBe(0); // open-bottom shell, no through-holes yet
      // hollow: much less than the full box
      expect(manifold.volume()).toBeLessThan(0.5 * w * h * frame.frontZ);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });

  it('also builds at export quality', async () => {
    const exportKit = await getKit('export');
    withScope(() => {
      const preview = buildCover(kit, presetConfig('ch-sd-1x1')).manifold.numTri();
      const fine = buildCover(exportKit, presetConfig('ch-sd-1x1')).manifold.numTri();
      expect(fine).toBeGreaterThan(preview);
      return null;
    });
  });

  it('falls back to the default style for unknown ids, with a warning', () => {
    const c = presetConfig('ch-sd-1x1');
    c.cover.style = 'does-not-exist';
    withScope(() => {
      const { frame, style } = buildCover(kit, c);
      expect(style.id).toBe('box');
      expect(frame.warnings.map((w) => w.code)).toContain('style-unknown');
      return null;
    });
  });
});

describe('style registry', () => {
  it('registers the box placeholder', () => {
    expect(listStyles().map((s) => s.id)).toContain('box');
    expect(getStyle('box')?.printOrientation).toBe('faceDown');
    expect(resolveStyle('box').warnings).toEqual([]);
  });

  it('parses params with defaults and tolerates garbage', () => {
    const box = getStyle('box')!;
    expect(parseStyleParams(box, {}).params).toEqual({});
    expect(parseStyleParams(box, 'garbage').warnings[0].code).toBe('style-params-invalid');
  });
});

describe('worker handler', () => {
  it('returns copied mesh buffers, frame and stats', () => {
    const before = liveObjectCount();
    const { response, transfer } = handleRequest(wasm, { id: 7, kind: 'build', config: presetConfig('ch-sd-2x2'), quality: 'preview' });
    expect(isBuildError(response)).toBe(false);
    const r = response as BuildResult;
    expect(r.id).toBe(7);
    expect(r.positions).toBeInstanceOf(Float32Array);
    expect(r.indices).toBeInstanceOf(Uint32Array);
    expect(r.indices.length).toBe(3 * r.stats.tris);
    expect(Math.max(...r.indices)).toBeLessThan(r.positions.length / 3);
    expect(r.positions.buffer.byteLength).toBe(r.positions.byteLength); // standalone buffer
    expect(transfer).toEqual([r.positions.buffer, r.indices.buffer]);
    expect(r.frame.outer.w).toBe(156.8);
    expect(r.stats.volume).toBeGreaterThan(0);
    expect(r.stats.genus).toBe(0);
    expect(r.stats.ms).toBeGreaterThanOrEqual(0);
    let maxZ = -Infinity;
    for (let i = 2; i < r.positions.length; i += 3) maxZ = Math.max(maxZ, r.positions[i]);
    expect(maxZ).toBeCloseTo(r.frame.frontZ, 4);
    expect(liveObjectCount()).toBe(before);
  });

  it('reports invalid configs and unimplemented kinds as errors', () => {
    const bad = handleRequest(wasm, { id: 1, kind: 'build', config: { v: 1 } as never, quality: 'preview' });
    expect(isBuildError(bad.response) && bad.response.error).toMatch(/Invalid configuration/);
    const fit = handleRequest(wasm, { id: 2, kind: 'testFit', config: presetConfig('ch-sd-1x1'), quality: 'export' });
    expect(isBuildError(fit.response)).toBe(true);
  });
});
