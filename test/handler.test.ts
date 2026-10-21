import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { presetConfig } from '../src/config/presets';
import { isBuildError, type BuildRequest, type BuildResult } from '../src/geometry/contract';
import { parseBinaryStl, stlTriangleCount } from '../src/geometry/export/stl';
import { liveObjectCount } from '../src/geometry/kit';
import { handleRequest } from '../src/worker/handler';
import { layoutConfig } from './helpers/configs';
import { getWasm } from './helpers/manifold';
import { manifoldOfMesh, signedVolume } from './helpers/probes';
import { listStyles } from '../src/styles';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await getWasm();
});

function ok(req: BuildRequest): { r: BuildResult; transfer: ArrayBuffer[] } {
  const { response, transfer } = handleRequest(wasm, req);
  if (isBuildError(response)) throw new Error(response.error);
  return { r: response, transfer };
}

/** First vertex of the first STL triangle. */
function firstStlVertex(stl: ArrayBuffer): [number, number, number] {
  const v = new DataView(stl);
  return [v.getFloat32(96, true), v.getFloat32(100, true), v.getFloat32(104, true)];
}

describe('worker handler', () => {
  it('build: copied mesh buffers, frame and stats, no STL', () => {
    const before = liveObjectCount();
    const { r, transfer } = ok({ id: 7, kind: 'build', config: presetConfig('ch-sd-2x2'), quality: 'preview' });
    expect(r.id).toBe(7);
    expect(r.positions).toBeInstanceOf(Float32Array);
    expect(r.indices).toBeInstanceOf(Uint32Array);
    expect(r.indices.length).toBe(3 * r.stats.tris);
    expect(Math.max(...r.indices)).toBeLessThan(r.positions.length / 3);
    expect(r.positions.buffer.byteLength).toBe(r.positions.byteLength); // standalone buffers
    expect(r.indices.buffer.byteLength).toBe(r.indices.byteLength);
    expect(transfer).toEqual([r.positions.buffer, r.indices.buffer]);
    expect(r.stl).toBeUndefined();
    expect(r.frame.outer.w).toBe(156.8);
    expect(r.stats.volume).toBeGreaterThan(0);
    expect(r.stats.genus).toBe(4); // 2 outlets + 2 pockets × 1 bridge access hole
    expect(r.stats.ms).toBeGreaterThanOrEqual(0);
    expect(signedVolume(r.positions, r.indices)).toBeCloseTo(r.stats.volume, 0);
    let maxZ = -Infinity;
    for (let i = 2; i < r.positions.length; i += 3) maxZ = Math.max(maxZ, r.positions[i]);
    expect(maxZ).toBeCloseTo(r.frame.frontZ, 4);
    expect(liveObjectCount()).toBe(before);
  });

  it('export: export quality, STL in the style orientation (face down), transferred', () => {
    const before = liveObjectCount();
    const config = layoutConfig('ch-sd-1x2v-switch-socket', 'minimal');
    const preview = ok({ id: 1, kind: 'build', config, quality: 'preview' }).r;
    const { r, transfer } = ok({ id: 2, kind: 'export', config, quality: 'export' });
    expect(r.stats.tris).toBeGreaterThan(preview.stats.tris);
    expect(r.stl).toBeInstanceOf(ArrayBuffer);
    const stl = r.stl!;
    expect(transfer).toEqual([r.positions.buffer, r.indices.buffer, stl]);
    // the writer drops float32-degenerate triangles, so the STL holds at most stats.tris faces
    expect(stl.byteLength).toBe(84 + 50 * stlTriangleCount(stl));
    expect(stlTriangleCount(stl)).toBeLessThanOrEqual(r.stats.tris);
    expect(stlTriangleCount(stl)).toBeGreaterThan(r.stats.tris * 0.95);
    expect(new TextDecoder().decode(new Uint8Array(stl, 0, 5))).not.toBe('solid');
    // minimal prints face down: STL vertex = (−x, y, frontZ − z) of the preview mesh vertex
    const i0 = r.indices[0];
    const [x, y, z] = firstStlVertex(stl);
    expect(x).toBeCloseTo(-r.positions[3 * i0], 4);
    expect(y).toBeCloseTo(r.positions[3 * i0 + 1], 4);
    expect(z).toBeCloseTo(r.frame.frontZ - r.positions[3 * i0 + 2], 4);
    const mesh = parseBinaryStl(stl);
    expect(signedVolume(mesh.positions, mesh.indices)).toBeCloseTo(r.stats.volume, 0);
    expect(liveObjectCount()).toBe(before);
  });

  it('export honours an explicit print orientation', () => {
    const config = layoutConfig('ch-sd-1x1', 'minimal');
    config.print.orientation = 'faceUp';
    const { r } = ok({ id: 3, kind: 'export', config, quality: 'export' });
    const i0 = r.indices[0];
    const v = firstStlVertex(r.stl!);
    expect(v[0]).toBeCloseTo(r.positions[3 * i0], 4);
    expect(v[2]).toBeCloseTo(r.positions[3 * i0 + 2], 4);
  });

  it("export resolves a style's orientation from its params: organic flat → face down, domed → face up", () => {
    const flat = layoutConfig('ch-sd-1x1', 'organic');
    const domed = layoutConfig('ch-sd-1x1', 'organic');
    domed.cover.styleParams = { domeSag: 3 };
    const check = (config: typeof flat, id: number, expected: 'faceDown' | 'faceUp') => {
      const { r } = ok({ id, kind: 'export', config, quality: 'preview' });
      const i0 = r.indices[0];
      const [x, , z] = firstStlVertex(r.stl!);
      let maxZ = -Infinity;
      for (let i = 2; i < r.positions.length; i += 3) maxZ = Math.max(maxZ, r.positions[i]);
      if (expected === 'faceDown') {
        expect(x).toBeCloseTo(-r.positions[3 * i0], 3);
        expect(z).toBeCloseTo(maxZ - r.positions[3 * i0 + 2], 3);
      } else {
        expect(x).toBeCloseTo(r.positions[3 * i0], 3);
        expect(z).toBeCloseTo(r.positions[3 * i0 + 2], 3);
      }
      expect(new TextDecoder().decode(new Uint8Array(r.stl!, 0, 60))).toContain(expected);
      return maxZ;
    };
    const flatTop = check(flat, 10, 'faceDown');
    const domedTop = check(domed, 11, 'faceUp');
    expect(domedTop).toBeGreaterThan(flatTop + 1); // the dome rises around the pocket (which cuts its apex)
    // an explicit orientation still wins
    domed.print.orientation = 'faceDown';
    check(domed, 12, 'faceDown');
    // the test-fit part follows the same rule
    const fit = ok({ id: 13, kind: 'testFit', config: { ...domed, print: { ...domed.print, orientation: 'style' } }, quality: 'preview' });
    expect(new TextDecoder().decode(new Uint8Array(fit.r.stl!, 0, 60))).toContain('faceUp');
  });

  it.each(listStyles().map((st) => st.id))('export of the combo preset (%s): the STL reads back as one valid piece of genus 2', (styleId) => {
    const config = layoutConfig('ch-sd-1x1-combo', styleId);
    const { r } = ok({ id: 20, kind: 'export', config, quality: 'export' });
    // the style's default: stepped prints face up, the others face down
    const header = new TextDecoder().decode(new Uint8Array(r.stl!, 0, 80));
    expect(header).toContain(styleId === 'stepped' ? 'faceUp' : 'faceDown');
    const both = (['faceDown', 'faceUp'] as const).map((orientation) => {
      const stl = ok({ id: 21, kind: 'export', config: { ...config, print: { ...config.print, orientation } }, quality: 'export' }).r.stl!;
      return manifoldOfMesh(wasm, parseBinaryStl(stl));
    });
    try {
      const { outer, frontZ } = r.frame;
      for (const back of both) {
        expect(back.status()).toBe('NoError');
        expect(back.genus()).toBe(2); // the socket opening + the bridge access hole
        expect(back.decompose().length).toBe(1);
        const box = back.boundingBox();
        expect(box.min[2]).toBeCloseTo(0, 4);
        expect(box.max[2]).toBeCloseTo(frontZ, 3);
        // y is never flipped: the cover still reaches from the plate's bottom to above its top
        expect(box.min[1]).toBeCloseTo(outer.cy - outer.h / 2, 1);
        expect(box.max[1]).toBeCloseTo(outer.cy + outer.h / 2, 1);
      }
      // face down, the front is the bed layer at z = 0: the face-up export's top layer, not its skirt ring
      const [down, up] = both;
      const bed = down.slice(0.05).area();
      expect(Math.abs(bed - up.slice(frontZ - 0.05).area()) / bed).toBeLessThan(0.02);
      expect(bed).toBeGreaterThan(2 * up.slice(0.05).area());
    } finally {
      for (const m of both) m.delete();
    }
  });

  it('testFit: small part with its own STL, base at z = 0', () => {
    const before = liveObjectCount();
    const { r, transfer } = ok({ id: 4, kind: 'testFit', config: presetConfig('ch-sd-1x1'), quality: 'export' });
    expect(r.stl).toBeInstanceOf(ArrayBuffer);
    expect(transfer).toHaveLength(3);
    expect(r.stl!.byteLength).toBe(84 + 50 * stlTriangleCount(r.stl!));
    expect(stlTriangleCount(r.stl!)).toBeLessThanOrEqual(r.stats.tris);
    expect(r.stats.genus).toBe(1); // the bridge access hole
    expect(r.stats.volume).toBeGreaterThan(5_000);
    expect(r.stats.volume).toBeLessThan(25_000); // < 25 cm³ ≈ 30 g PLA
    let minZ = Infinity;
    for (let i = 2; i < r.positions.length; i += 3) minZ = Math.min(minZ, r.positions[i]);
    expect(minZ).toBe(0);
    expect(liveObjectCount()).toBe(before);
  });

  it('testFit: picks the requested pocket', () => {
    const config = presetConfig('ch-sd-3x1h-three-switches');
    const first = ok({ id: 5, kind: 'testFit', config, quality: 'preview' }).r;
    const last = ok({ id: 6, kind: 'testFit', config, quality: 'preview', featureId: 'c2r0' }).r;
    const meanX = (r: BuildResult) => {
      let sum = 0;
      for (let i = 0; i < r.positions.length; i += 3) sum += r.positions[i];
      return sum / (r.positions.length / 3);
    };
    expect(meanX(first)).toBeLessThan(-30);
    expect(meanX(last)).toBeGreaterThan(30);
    const missing = handleRequest(wasm, { id: 7, kind: 'testFit', config, quality: 'preview', featureId: 'c5r5' });
    expect(isBuildError(missing.response) && missing.response.error).toMatch(/c5r5/);
  });

  it('reports invalid configs, layouts without pockets and bad kinds as errors', () => {
    const before = liveObjectCount();
    const bad = handleRequest(wasm, { id: 1, kind: 'build', config: { v: 1 } as never, quality: 'preview' });
    expect(isBuildError(bad.response) && bad.response.error).toMatch(/Invalid configuration/);
    expect(bad.transfer).toEqual([]);
    const noPocket = presetConfig('ch-sd-1x1');
    noPocket.modules = [{ col: 0, row: 0, role: 'outlet', rot: 0, dx: 0, dy: 0 }];
    const fit = handleRequest(wasm, { id: 2, kind: 'testFit', config: noPocket, quality: 'export' });
    expect(isBuildError(fit.response) && fit.response.error).toMatch(/no Bilresa pocket/i);
    expect(fit.response.id).toBe(2);
    expect(liveObjectCount()).toBe(before);
  });
});
