import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { buildCover } from '../src/geometry/buildCover';
import type { Kit } from '../src/geometry/contract';
import type { OpeningFeature } from '../src/geometry/features';
import {
  orientPositions,
  parseBinaryStl,
  resolvePrintOrientation,
  stlTriangleCount,
  toBinaryStl,
} from '../src/geometry/export/stl';
import { liveObjectCount, withScope } from '../src/geometry/kit';
import { layoutConfig } from './helpers/configs';
import { getKit, getWasm } from './helpers/manifold';
import { column, intersectionVolume, manifoldOfMesh, signedVolume } from './helpers/probes';

let kit: Kit;
let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await getWasm();
  kit = await getKit('preview');
});

const header = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(new Uint8Array(buf, 0, 80));

describe('toBinaryStl format', () => {
  it('writes 84 + 50·n bytes, a non-"solid" header and the triangle count', () => {
    withScope(() => {
      const cube = wasm.Manifold.cube([10, 20, 30]);
      const stl = toBinaryStl(cube);
      const n = cube.numTri();
      expect(stl.byteLength).toBe(84 + 50 * n);
      expect(stlTriangleCount(stl)).toBe(n);
      expect(header(stl).startsWith('solid')).toBe(false);
      expect(header(stl).trim()).toMatch(/^switchcover/);
      // attribute byte count is zero for every triangle
      const view = new DataView(stl);
      for (let t = 0; t < n; t++) expect(view.getUint16(84 + 50 * t + 48, true)).toBe(0);
    });
  });

  it('never starts the header with "solid", even when asked to', () => {
    const stl = toBinaryStl({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }, { header: 'solid evil' });
    expect(header(stl).toLowerCase().startsWith('solid')).toBe(false);
    expect(() => stlTriangleCount(new ArrayBuffer(10))).toThrow(RangeError);
  });

  it('stores outward unit normals computed from the winding (little-endian)', () => {
    withScope(() => {
      const cube = wasm.Manifold.cube([2, 2, 2], true);
      const stl = toBinaryStl(cube, { orientation: 'faceUp' });
      const view = new DataView(stl);
      for (let t = 0; t < cube.numTri(); t++) {
        const o = 84 + 50 * t;
        const n = [0, 1, 2].map((i) => view.getFloat32(o + 4 * i, true));
        expect(Math.hypot(...n)).toBeCloseTo(1, 5);
        // centroid of the triangle (faceUp moved the cube up by 1)
        const c = [0, 1, 2].map((i) => (view.getFloat32(o + 12 + 4 * i, true) + view.getFloat32(o + 24 + 4 * i, true) + view.getFloat32(o + 36 + 4 * i, true)) / 3);
        c[2] -= 1;
        expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
      }
    });
  });

  it('round-trips through parseBinaryStl with the same signed volume as volume()', () => {
    withScope(() => {
      const { manifold } = buildCover(kit, layoutConfig('ch-sd-1x2v-switch-socket', 'minimal'));
      for (const orientation of ['faceUp', 'faceDown'] as const) {
        const mesh = parseBinaryStl(toBinaryStl(manifold, { orientation }));
        expect(mesh.indices.length / 3).toBe(manifold.numTri());
        expect(signedVolume(mesh.positions, mesh.indices)).toBeCloseTo(manifold.volume(), 0);
        const back = manifoldOfMesh(wasm, mesh);
        expect(back.status()).toBe('NoError');
        expect(back.genus()).toBe(manifold.genus());
      }
    });
  });

  it('resolves the print orientation against the style default', () => {
    expect(resolvePrintOrientation('style', 'faceDown')).toBe('faceDown');
    expect(resolvePrintOrientation('style', 'faceUp')).toBe('faceUp');
    expect(resolvePrintOrientation('faceUp', 'faceDown')).toBe('faceUp');
    expect(resolvePrintOrientation('faceDown', 'faceUp')).toBe('faceDown');
  });
});

describe('print orientation', () => {
  it('faceUp only translates (min z = 0); faceDown rotates 180° about Y, never mirrors', () => {
    const pts = [1, 2, 3, -4, 5, 6, 7, -8, 9];
    expect(Array.from(orientPositions(pts, 'faceUp'))).toEqual([1, 2, 0, -4, 5, 3, 7, -8, 6]);
    // (x, y, z) → (−x, y, −z), then + max z
    expect(Array.from(orientPositions(pts, 'faceDown'))).toEqual([-1, 2, 6, 4, 5, 3, -7, -8, 0]);
  });

  it('puts the face on the bed and keeps an off-centre outlet where the rotation puts it', () => {
    const before = liveObjectCount();
    withScope(() => {
      // Asymmetric marker: the outlet of the switch+socket layout moved 15 mm to the right.
      const config = layoutConfig('ch-sd-1x2v-switch-socket', 'minimal');
      const outletModule = config.modules.find((m) => m.role === 'outlet')!;
      outletModule.dx = 15;
      const { manifold, frame } = buildCover(kit, config);
      const outlet = frame.features.find((f): f is OpeningFeature => f.kind === 'opening')!;
      expect(outlet.placed.x).toBeCloseTo(15, 9);
      const yo = outlet.placed.y;
      expect(yo).toBeLessThan(0);

      const down = manifoldOfMesh(wasm, parseBinaryStl(toBinaryStl(manifold, { orientation: 'faceDown' })));
      const up = manifoldOfMesh(wasm, parseBinaryStl(toBinaryStl(manifold, { orientation: 'faceUp' })));
      for (const m of [down, up]) {
        const box = m.boundingBox();
        expect(box.min[2]).toBe(0);
        expect(box.max[2]).toBeCloseTo(frame.frontZ, 4);
        expect(m.volume()).toBeCloseTo(manifold.volume(), 0);
      }

      // Face down: the face (formerly z = frontZ) is on the bed, so the layer just above the
      // bed is the face skin (big), and the top layer is the skirt ring (small).
      const faceArea = down.slice(0.05).area();
      const skirtArea = down.slice(frame.frontZ - 0.05).area();
      expect(faceArea).toBeGreaterThan(3 * skirtArea);
      expect(up.slice(0.05).area()).toBeCloseTo(skirtArea, 0);

      // The outlet: rotation about Y maps x → −x and keeps y; a mirror would keep it at +x.
      const skin = (m: typeof down, x: number, z0: number) => intersectionVolume(m, column(kit, x, yo, z0, z0 + frame.skinT - 0.2, 1));
      expect(skin(down, -15, 0.1)).toBe(0); // hole at the rotated position
      expect(skin(down, 15, 0.1)).toBeGreaterThan(0); // material where a mirror would have put it
      const upSkin = frame.frontZ - frame.skinT + 0.1;
      expect(skin(up, 15, upSkin)).toBe(0);
      expect(skin(up, -15, upSkin)).toBeGreaterThan(0);
      return null;
    });
    expect(liveObjectCount()).toBe(before);
  });
});
