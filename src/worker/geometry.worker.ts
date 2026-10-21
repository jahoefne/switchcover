/**
 * Geometry worker entry. The only module that imports the WASM binary URL.
 * Protocol: BuildRequest in, BuildResponse out (buffers transferred) — see contract.ts.
 */
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { BuildRequest, BuildResponse } from '../geometry/contract';
import { initManifold } from '../geometry/kit/init';
import { handleRequest } from './handler';

const ready = initManifold(() => Module({ locateFile: () => wasmUrl }));
/** The bits of DedicatedWorkerGlobalScope we use (the project compiles against the DOM lib). */
interface WorkerScope {
  onmessage: ((e: MessageEvent<BuildRequest>) => void) | null;
  postMessage(message: BuildResponse, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const req = e.data;
  let wasm;
  try {
    wasm = await ready;
  } catch (err) {
    const error = `Failed to load the geometry engine: ${err instanceof Error ? err.message : String(err)}`;
    scope.postMessage({ id: req.id, error } satisfies BuildResponse);
    return;
  }
  const { response, transfer } = handleRequest(wasm, req);
  scope.postMessage(response, transfer);
};
