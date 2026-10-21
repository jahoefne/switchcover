/**
 * Worker-side request handling, kept free of worker globals so it runs in Node tests.
 */
import type { ManifoldToplevel } from 'manifold-3d';
import { CoverConfigSchema } from '../config/schema';
import { buildCover } from '../geometry/buildCover';
import type { BuildRequest, BuildResponse } from '../geometry/contract';
import { createKit, withScope } from '../geometry/kit';

export interface HandledResponse {
  response: BuildResponse;
  /** Buffers to transfer with postMessage. */
  transfer: ArrayBuffer[];
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function handleRequest(wasm: ManifoldToplevel, req: BuildRequest): HandledResponse {
  const t0 = now();
  try {
    if (req.kind === 'testFit') {
      // TODO WP1: buildTestFit (pocket well + all pocket cuts, 3 mm rim).
      return { response: { id: req.id, error: 'Test-fit build is not implemented yet.' }, transfer: [] };
    }
    const parsed = CoverConfigSchema.safeParse(req.config);
    if (!parsed.success) {
      const where = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
      return { response: { id: req.id, error: `Invalid configuration: ${where}` }, transfer: [] };
    }
    const kit = createKit(wasm, req.quality);
    const out = withScope(() => {
      const { manifold, frame } = buildCover(kit, parsed.data);
      const mesh = manifold.getMesh();
      const numProp = mesh.numProp;
      const nVert = mesh.vertProperties.length / numProp;
      const positions = new Float32Array(nVert * 3);
      for (let v = 0; v < nVert; v++) {
        positions[3 * v] = mesh.vertProperties[v * numProp];
        positions[3 * v + 1] = mesh.vertProperties[v * numProp + 1];
        positions[3 * v + 2] = mesh.vertProperties[v * numProp + 2];
      }
      const indices = new Uint32Array(mesh.triVerts);
      return {
        positions,
        indices,
        frame,
        stats: { ms: 0, tris: manifold.numTri(), volume: manifold.volume(), genus: manifold.genus() },
      };
    });
    out.stats.ms = now() - t0;
    // TODO WP1: for kind 'export', attach the binary STL (export/stl.ts) incl. print orientation.
    return {
      response: { id: req.id, ...out },
      transfer: [out.positions.buffer as ArrayBuffer, out.indices.buffer as ArrayBuffer],
    };
  } catch (err) {
    return { response: { id: req.id, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}
