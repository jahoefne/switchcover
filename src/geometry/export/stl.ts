/**
 * Binary STL writer (and a small reader for tests / dev checks).
 *
 * Format: 80-byte header (never starting with "solid", which would make some readers
 * treat the file as ASCII STL), uint32 triangle count, then per triangle 12 float32s
 * (normal, v0, v1, v2) and a uint16 attribute = 0. Everything little-endian. Normals are
 * computed from the winding (CCW seen from outside, as manifold-3d emits it).
 *
 * Print orientation:
 *  - 'faceUp'   — translate only, so min z = 0 (the cover's glued base is on the bed).
 *  - 'faceDown' — ROTATE 180° about Y, (x, y, z) → (−x, y, −z), then translate to min z = 0.
 *                 A rotation keeps the winding valid; never mirror / negative-scale. Seen from
 *                 above in the slicer the layout looks mirrored, which is correct.
 */
import type { Manifold } from 'manifold-3d';

export type PrintOrientation = 'faceDown' | 'faceUp';

/** Plain triangle mesh: xyz per vertex, three vertex indices per triangle (CCW outside). */
export interface StlMesh {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export interface StlOptions {
  /** Default 'faceUp' (geometry as built, translated to min z = 0). */
  orientation?: PrintOrientation;
  /** Header text (ASCII, truncated to 80 bytes; a leading "solid" is replaced). */
  header?: string;
}

/** config.print.orientation resolved against the style's default ('style' → style default). */
export function resolvePrintOrientation(
  requested: PrintOrientation | 'style',
  styleDefault: PrintOrientation,
): PrintOrientation {
  return requested === 'style' ? styleDefault : requested;
}

export const STL_HEADER_BYTES = 80;
export const STL_TRIANGLE_BYTES = 50;
const DEFAULT_HEADER = 'switchcover binary STL (mm)';

function isManifold(x: Manifold | StlMesh): x is Manifold {
  return typeof (x as Manifold).getMesh === 'function';
}

/** Positions (xyz only) and indices of a Manifold or plain mesh. */
function meshArrays(input: Manifold | StlMesh): StlMesh {
  if (!isManifold(input)) return input;
  const mesh = input.getMesh();
  const { numProp, vertProperties, triVerts } = mesh;
  if (numProp === 3) return { positions: vertProperties, indices: triVerts };
  const nVert = vertProperties.length / numProp;
  const positions = new Float32Array(nVert * 3);
  for (let v = 0; v < nVert; v++) {
    positions[3 * v] = vertProperties[v * numProp];
    positions[3 * v + 1] = vertProperties[v * numProp + 1];
    positions[3 * v + 2] = vertProperties[v * numProp + 2];
  }
  return { positions, indices: triVerts };
}

/** Oriented copy of the vertex positions (Float64 to keep the translation exact). */
export function orientPositions(positions: ArrayLike<number>, orientation: PrintOrientation): Float64Array {
  const n = Math.floor(positions.length / 3);
  const out = new Float64Array(n * 3);
  const flip = orientation === 'faceDown' ? -1 : 1;
  let minZ = Infinity;
  for (let v = 0; v < n; v++) {
    out[3 * v] = flip * positions[3 * v];
    out[3 * v + 1] = positions[3 * v + 1];
    const z = flip * positions[3 * v + 2];
    out[3 * v + 2] = z;
    if (z < minZ) minZ = z;
  }
  if (n > 0 && minZ !== 0) for (let v = 0; v < n; v++) out[3 * v + 2] -= minZ;
  return out;
}

function writeHeader(view: DataView, text: string): void {
  let h = text.replace(/[^\x20-\x7e]/g, '?');
  if (/^\s*solid/i.test(h)) h = `binary ${h.replace(/^\s*solid/i, '')}`;
  for (let i = 0; i < STL_HEADER_BYTES; i++) view.setUint8(i, i < h.length ? h.charCodeAt(i) : 0x20);
}

/** Encode a Manifold or plain mesh as binary STL in the requested print orientation. */
export function toBinaryStl(input: Manifold | StlMesh, options: StlOptions = {}): ArrayBuffer {
  const { positions, indices } = meshArrays(input);
  const p = orientPositions(positions, options.orientation ?? 'faceUp');
  const nTri = Math.floor(indices.length / 3);
  const buffer = new ArrayBuffer(STL_HEADER_BYTES + 4 + STL_TRIANGLE_BYTES * nTri);
  const view = new DataView(buffer);
  writeHeader(view, options.header ?? DEFAULT_HEADER);
  view.setUint32(STL_HEADER_BYTES, nTri, true);
  let o = STL_HEADER_BYTES + 4;
  for (let t = 0; t < nTri; t++) {
    const a = 3 * indices[3 * t];
    const b = 3 * indices[3 * t + 1];
    const c = 3 * indices[3 * t + 2];
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const i of [a, b, c]) {
      view.setFloat32(o, p[i], true);
      view.setFloat32(o + 4, p[i + 1], true);
      view.setFloat32(o + 8, p[i + 2], true);
      o += 12;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buffer;
}

/** Triangle count stored in a binary STL (throws if the buffer is too short). */
export function stlTriangleCount(buffer: ArrayBuffer): number {
  if (buffer.byteLength < STL_HEADER_BYTES + 4) throw new RangeError('not a binary STL: too short');
  return new DataView(buffer).getUint32(STL_HEADER_BYTES, true);
}

/**
 * Decode a binary STL into an indexed mesh, merging bit-identical vertices (enough to make
 * a watertight STL manifold again for `Manifold.ofMesh`).
 */
export function parseBinaryStl(buffer: ArrayBuffer | ArrayBufferView): { positions: Float32Array; indices: Uint32Array } {
  const view =
    buffer instanceof ArrayBuffer ? new DataView(buffer) : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.byteLength < STL_HEADER_BYTES + 4) throw new RangeError('not a binary STL: too short');
  const nTri = view.getUint32(STL_HEADER_BYTES, true);
  if (view.byteLength < STL_HEADER_BYTES + 4 + STL_TRIANGLE_BYTES * nTri) {
    throw new RangeError(`not a binary STL: ${nTri} triangles need ${84 + 50 * nTri} bytes, got ${view.byteLength}`);
  }
  const ids = new Map<string, number>();
  const verts: number[] = [];
  const indices = new Uint32Array(3 * nTri);
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const o = STL_HEADER_BYTES + 4 + STL_TRIANGLE_BYTES * t + 12 + 12 * k;
      const x = view.getFloat32(o, true);
      const y = view.getFloat32(o + 4, true);
      const z = view.getFloat32(o + 8, true);
      const key = `${x},${y},${z}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = verts.length / 3;
        ids.set(key, id);
        verts.push(x, y, z);
      }
      indices[3 * t + k] = id;
    }
  }
  return { positions: new Float32Array(verts), indices };
}
