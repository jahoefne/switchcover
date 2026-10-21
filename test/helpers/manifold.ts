/**
 * Test helpers for WASM geometry. initManifold() is memoised per test file (vitest isolates
 * files), so calling getKit() in every test is cheap.
 */
import type { Manifold } from 'manifold-3d';
import { expect } from 'vitest';
import type { Quality, Vec3 } from '../../src/geometry/contract';
import { createKit, initManifold } from '../../src/geometry/kit';

export const getWasm = () => initManifold();

export async function getKit(quality: Quality = 'preview') {
  return createKit(await getWasm(), quality);
}

/** Assert a manifold is valid, non-empty and has the expected bounding box (±tol mm). */
export function expectSolid(m: Manifold, min?: Vec3, max?: Vec3, tol = 1e-3): void {
  expect(m.status()).toBe('NoError');
  expect(m.isEmpty()).toBe(false);
  if (!min || !max) return;
  const box = m.boundingBox();
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(box.min[i] - min[i]), `min[${i}] ${box.min[i]} vs ${min[i]}`).toBeLessThanOrEqual(tol);
    expect(Math.abs(box.max[i] - max[i]), `max[${i}] ${box.max[i]} vs ${max[i]}`).toBeLessThanOrEqual(tol);
  }
}
