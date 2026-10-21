/**
 * manifold-3d initialisation (memoised).
 *
 *  - Browser: the worker entry passes a factory that hands Emscripten the bundled WASM URL:
 *      import Module from 'manifold-3d';
 *      import wasmUrl from 'manifold-3d/manifold.wasm?url';
 *      initManifold(() => Module({ locateFile: () => wasmUrl }));
 *    Keep the `?url` import in the worker entry only (Node cannot resolve it).
 *  - Node / vitest: call `initManifold()`; plain `Module()` finds manifold.wasm next to
 *    manifold.js.
 *
 * After `setup()` the toplevel is instrumented so every Manifold / CrossSection is tracked
 * by kit/scope.ts.
 */
import Module, { type ManifoldToplevel } from 'manifold-3d';
import { instrumentManifold } from './scope';

export type ManifoldFactory = () => Promise<ManifoldToplevel>;

let pending: Promise<ManifoldToplevel> | null = null;

export function initManifold(factory?: ManifoldFactory): Promise<ManifoldToplevel> {
  if (!pending) {
    const load = factory ?? (() => Module());
    pending = load().then((wasm) => {
      wasm.setup();
      instrumentManifold(wasm);
      return wasm;
    });
    // Allow a retry after a failed load (e.g. network hiccup fetching the .wasm).
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
