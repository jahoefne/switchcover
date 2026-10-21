/**
 * Geometry probes for cover tests: thin columns, outline prisms, STL → Manifold.
 * All helpers create WASM objects in the caller's scope (wrap calls in withScope).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Kit, Placed, Vec2 } from '../../src/geometry/contract';
import { parseBinaryStl } from '../../src/geometry/export/stl';
import type { PocketFeature } from '../../src/geometry/features';
import { offsetPlaced, pointInPlaced, toWorld } from '../../src/geometry/shape2d';
import { bilresaGhostPlacement } from '../../src/ui/viewer/ghost';

/** A thin square column at (x, y) from z0 to z1. */
export function column(kit: Kit, x: number, y: number, z0: number, z1: number, size = 0.3): Manifold {
  return kit.prism({ shape: { kind: 'roundedRect', w: size, h: size, r: 0 }, x, y, rotDeg: 0 }, z0, z1);
}

/** Highest z of `a ∩ b`, or −Infinity if they do not intersect. */
export function topOfIntersection(a: Manifold, b: Manifold): number {
  const i = a.intersect(b);
  return i.isEmpty() ? -Infinity : i.boundingBox().max[2];
}

/** Volume of `a ∩ b` (0 if they do not intersect). */
export function intersectionVolume(a: Manifold, b: Manifold): number {
  const i = a.intersect(b);
  return i.isEmpty() ? 0 : i.volume();
}

/** Ring between two outward offsets of `p` (inner < outer), as a solid from z0 to z1. */
export function ringPrism(kit: Kit, p: Placed, inner: number, outer: number, z0: number, z1: number): Manifold {
  return kit.prism(offsetPlaced(p, outer), z0, z1).subtract(kit.prism(offsetPlaced(p, inner), z0 - 1, z1 + 1));
}

/**
 * Probe points of a nested pocket, in world coordinates (pocket frame: u across, v along the
 * Bilresa's long axis):
 *  - `ledge`: on the strip's end ledges, ±(strip.l/2 − 2) along the long axis (tops out at
 *    floorZ − stripDepth);
 *  - `hole`: the pocket centre, in the bridge hole (nothing above or below);
 *  - `fillet`: `across` mm from the centre across the long axis (tops out on the fillet wall).
 */
export function pocketProbePoints(f: PocketFeature, stripL: number, across = 19): { ledge: Vec2[]; hole: Vec2; fillet: Vec2 } {
  const along = stripL / 2 - 2;
  const at = (u: number, v: number) => toWorld({ ...f.placed, x: f.strip.x, y: f.strip.y }, [u, v]);
  return { ledge: [at(0, along), at(0, -along)], hole: [f.placed.x, f.placed.y], fillet: toWorld(f.placed, [across, 0]) };
}

/** Expected top of the pocket floor/wall at `across` mm from the centre (horizontal clearance). */
export function filletTopAt(f: PocketFeature, across: number): number {
  // The void's half width at height h is (pocket half width) − backFilletInset(r, h).
  const half = f.placed.shape.kind === 'stadium' ? Math.min(f.placed.shape.w, f.placed.shape.h) / 2 : NaN;
  const r = f.backFilletR;
  const inset = half - across; // = r − √(r² − (r − h)²)
  if (inset >= r) return f.floorZ;
  return f.floorZ + r - Math.sqrt(r * r - (r - inset) * (r - inset));
}

/**
 * A point on the plain pocket floor (no strip indent, no access hole within `keep` mm, at least
 * `keep` mm inside the floor's flat part), as close to the pocket centre as possible.
 */
export function plainFloorPoint(f: PocketFeature, keep = 1): Vec2 {
  const inside = offsetPlaced(f.placed, -(f.backFilletR + keep));
  const avoid = [offsetPlaced(f.strip, keep), ...f.holes.map((h) => offsetPlaced(h, keep))];
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let u = -40; u <= 40; u += 0.25) {
    for (let v = -40; v <= 40; v += 0.25) {
      const pt = toWorld(f.placed, [u, v]);
      if (!pointInPlaced(pt, inside) || avoid.some((a) => pointInPlaced(pt, a))) continue;
      const d = Math.hypot(u, v);
      if (d < bestD) {
        bestD = d;
        best = pt;
      }
    }
  }
  if (!best) throw new Error(`no plain floor in pocket ${f.id}`);
  return best;
}

const stlCache = new Map<string, { positions: Float32Array; indices: Uint32Array }>();

/** Absolute path of a file in the repo's model/ directory. */
export function modelPath(name: string): string {
  return fileURLToPath(new URL(`../../model/${name}`, import.meta.url));
}

/** Indexed mesh of a binary STL file (cached). */
export function readStlMesh(path: string): { positions: Float32Array; indices: Uint32Array } {
  let mesh = stlCache.get(path);
  if (!mesh) {
    mesh = parseBinaryStl(readFileSync(path));
    stlCache.set(path, mesh);
  }
  return mesh;
}

/** Manifold of an indexed mesh (bit-identical vertices already merged). */
export function manifoldOfMesh(wasm: ManifoldToplevel, mesh: { positions: Float32Array; indices: Uint32Array }): Manifold {
  return wasm.Manifold.ofMesh(new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
}

/** Signed volume of a triangle mesh (positive for CCW-outside winding). */
export function signedVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t];
    const b = 3 * indices[t + 1];
    const c = 3 * indices[t + 2];
    v +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return v / 6;
}

/**
 * The Bilresa reference model seated in a pocket exactly like the viewer's ghost
 * (bilresaGhostPlacement): no tilt, rotated by the pocket's rotDeg, moved to the pocket centre
 * with its back flat `lift` mm above floorZ (front at floorZ + depth + lift).
 */
export function seatedBilresa(wasm: ManifoldToplevel, f: PocketFeature, file: string, lift = 0): Manifold {
  const m = manifoldOfMesh(wasm, readStlMesh(modelPath(file)));
  const g = bilresaGhostPlacement(f);
  return m.rotate([0, 0, g.rotZDeg]).translate([g.position[0], g.position[1], g.position[2] + lift]);
}
