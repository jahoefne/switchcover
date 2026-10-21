/**
 * Worker-side request handling, kept free of worker globals so it runs in Node tests.
 *
 *  - 'build'   → cover mesh (quality as requested; the client sends 'preview').
 *  - 'export'  → cover rebuilt from the config (the client sends 'export' quality) + binary STL
 *                in the print orientation (config.print.orientation, 'style' → the style's).
 *  - 'testFit' → test-fit part of the pocket `req.featureId` (default: the first) + binary STL
 *                (same orientation rule, so the pocket prints exactly like it will in the cover).
 * Mesh buffers are copied out of getMesh() into fresh typed arrays (transferable); the STL is
 * written from those copies. Every WASM object is freed before returning.
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { CoverConfigSchema, type CoverConfig } from '../config/schema';
import { buildCover } from '../geometry/buildCover';
import { buildTestFit } from '../geometry/buildTestFit';
import type { BuildRequest, BuildResponse, BuildResult, CoverFrame } from '../geometry/contract';
import { resolvePrintOrientation, toBinaryStl } from '../geometry/export/stl';
import { createKit, withScope } from '../geometry/kit';
import type { AnyCoverStyle } from '../styles';

export interface HandledResponse {
  response: BuildResponse;
  /** Buffers to transfer with postMessage. */
  transfer: ArrayBuffer[];
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Copy a manifold's mesh into standalone, transferable typed arrays (xyz only). */
export function copyMesh(m: Manifold): { positions: Float32Array; indices: Uint32Array } {
  const mesh = m.getMesh();
  const { numProp, vertProperties, triVerts } = mesh;
  const nVert = vertProperties.length / numProp;
  const positions = new Float32Array(nVert * 3);
  for (let v = 0; v < nVert; v++) {
    positions[3 * v] = vertProperties[v * numProp];
    positions[3 * v + 1] = vertProperties[v * numProp + 1];
    positions[3 * v + 2] = vertProperties[v * numProp + 2];
  }
  return { positions, indices: new Uint32Array(triVerts) };
}

interface Built {
  manifold: Manifold;
  frame: CoverFrame;
  style: AnyCoverStyle;
}

function build(wasm: ManifoldToplevel, req: BuildRequest, config: CoverConfig): Omit<BuildResult, 'id'> {
  const kit = createKit(wasm, req.quality);
  return withScope(() => {
    const built: Built = req.kind === 'testFit' ? buildTestFit(kit, config, req.featureId) : buildCover(kit, config);
    const { manifold, frame, style } = built;
    const { positions, indices } = copyMesh(manifold);
    const stats = { ms: 0, tris: manifold.numTri(), volume: manifold.volume(), genus: manifold.genus() };
    if (req.kind === 'build') return { positions, indices, frame, stats };
    const orientation = resolvePrintOrientation(config.print.orientation, style.printOrientation);
    const header = `switchcover ${req.kind === 'testFit' ? 'test-fit' : 'cover'} ${style.id} ${orientation} mm`;
    const stl = toBinaryStl({ positions, indices }, { orientation, header });
    return { positions, indices, frame, stats, stl };
  });
}

export function handleRequest(wasm: ManifoldToplevel, req: BuildRequest): HandledResponse {
  const t0 = now();
  try {
    const parsed = CoverConfigSchema.safeParse(req.config);
    if (!parsed.success) {
      const where = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
      return { response: { id: req.id, error: `Invalid configuration: ${where}` }, transfer: [] };
    }
    const out = build(wasm, req, parsed.data);
    out.stats.ms = now() - t0;
    const transfer = [out.positions.buffer as ArrayBuffer, out.indices.buffer as ArrayBuffer];
    if (out.stl) transfer.push(out.stl);
    return { response: { id: req.id, ...out }, transfer };
  } catch (err) {
    return { response: { id: req.id, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}
