/**
 * "extension" — the internal style of an extension plate (part.kind 'extension'; not in the
 * registry, `partStyle` in src/styles picks it). A solid rounded-rect slab with the plate's
 * corner radius and a small 45° top chamfer, flat face at frontZ (= the plate's face), and around
 * every pocket that is deeper than the slab a raised rim (minWall wide) reached through a
 * concave cove (part.flare wide; see ./hump.ts). The pocket features cut the nested pocket and
 * the strip indent into it exactly as into a cap; there is no cavity (features/cavity.ts).
 *
 * Body = hull of three rings (base, below the chamfer, chamfered top) ∪ one loft per rim.
 * Printed face up: the base lies flat on the bed, the nested pocket widens upwards and the cove
 * narrows upwards, so nothing overhangs.
 */
import type { Manifold } from 'manifold-3d';
import { z } from 'zod';
import { EXTENSION_EDGE_CHAMFER, EXTENSION_RIM_CHAMFER } from '../../config/defaults';
import type { CoverStyle, EdgeProfile, StyleLimits } from '../../geometry/contract';
import { outerPlaced } from '../../layout/resolve';
import { humpSlices, humpSurfaceZ } from './hump';

export { coveZ, humpFoot, humpSlices, humpSurfaceZ } from './hump';

const params = z.object({});

/** How far a cove's foot reaches down into the slab (robust union). */
const FOOT = 0.5;
/** Rim edge (the resolver keeps EXTENSION_RIM_CHAMFER of room for it, see resolveExtension.ts). */
const POCKET_EDGE: EdgeProfile = { kind: 'chamfer', size: EXTENSION_RIM_CHAMFER };

export const EXTENSION_STYLE_ID = 'extension';

export const extensionStyle: CoverStyle<typeof params> = {
  id: EXTENSION_STYLE_ID,
  version: 1,
  label: 'Extension plate',
  description: 'A flat slab beside the plate, flush with its face, with a raised, curved rim around each Bilresa pocket.',
  params,
  printOrientation: 'faceUp',
  printHint:
    'Print face up (the flat base on the bed): the nested pocket widens upwards and the rim narrows upwards, so nothing needs support.',
  // Informational: the extension resolver uses the same constants itself (it ignores limits).
  limits: (): StyleLimits => ({ minFrame: 0, minFrontZ: 0, maxEdgeR: 0, edgeAllowance: 0, pocketEdgeAllowance: EXTENSION_RIM_CHAMFER }),
  surfaceZ: ({ frame }, x, y) => humpSurfaceZ(frame, x, y),
  outerBody: ({ frame, kit }) => {
    const o = outerPlaced(frame);
    const n = kit.segments(frame.outer.cornerR);
    const top = frame.frontZ;
    const c = Math.min(EXTENSION_EDGE_CHAMFER, top / 2);
    let body =
      c > 1e-6
        ? kit.hull([...kit.ring(o, 0, 0, n), ...kit.ring(o, 0, top - c, n), ...kit.ring(o, c, top, n)])
        : kit.hull([...kit.ring(o, 0, 0, n), ...kit.ring(o, 0, top, n)]);
    if (frame.part.kind !== 'extension') return body;
    const { flare } = frame.part;
    const humps: Manifold[] = [];
    for (const f of frame.features) {
      if (f.kind !== 'pocket' || f.rimZ === undefined || f.rimZ <= top + 1e-6) continue;
      const segs = Math.max(4, Math.ceil(kit.segments(Math.max(flare, f.rimZ - top)) / 4));
      humps.push(kit.loft(f.placed, humpSlices(top, f.rimZ, frame.minWall, flare, segs, FOOT)));
    }
    if (humps.length === 1) body = body.add(humps[0]);
    else if (humps.length > 1) body = body.add(kit.wasm.Manifold.union(humps));
    return body;
  },
  openingEdge: () => ({ kind: 'chamfer', size: 0.6 }),
  pocketEdge: () => POCKET_EDGE,
};
