/**
 * Frame helpers shared by the organic, faceted and stepped styles (pure TS, no WASM).
 *
 *  - `bodyPlaced`: the style's outline (frame size, style corner radius).
 *  - `edgeWidth`: how far an EdgeProfile widens a cut at the face.
 *  - `availableEdgeRoom`: how wide an opening/pocket edge treatment may be at the face before it
 *    eats into a neighbouring feature's wall or leaves the flat part of the face.
 *
 * Profile bodies, the shell fill and the plate zone live in the geometry kit
 * (src/geometry/kit/profile.ts); exact 2D distances in src/geometry/shape2d.ts.
 *
 * Corner radius: a style asks for its outer corner radius through `limits().cornerR`; the
 * resolver sets frame.outer.cornerR to it (≥ plate corner + clearance + skirtT) and grows the
 * frame just enough for the plate to fit the cavity's rounded corner. The body radius is still
 * clamped to frame.outer.cornerR (`bodyPlaced`) so the body never cuts the cavity's corners.
 *
 * Edge room: the resolver spaces features by minWall + the two features' edge allowances
 * (`limits().edgeAllowance` / `pocketEdgeAllowance`) and keeps the allowance inside the frame,
 * so in normal layouts every edge gets its full size. `availableEdgeRoom` stays as the safety
 * net for hand-placed (dx/dy) or manual layouts: edges then shrink to the room there is.
 */
import type { CoverFrame, EdgeProfile, Placed, ResolvedFeature } from '../../geometry/contract';
import { insideDistance, outlineWorld, placedDistance } from '../../geometry/shape2d';

/** Outline samples used to measure a feature's distance to the plateau edge. */
const ROOM_SAMPLES = 72;

/** The style's body outline: frame size and centre, style corner radius (≤ frame radius). */
export function bodyPlaced(frame: CoverFrame, cornerR: number): Placed {
  const { w, h, cx, cy } = frame.outer;
  const r = Math.max(0, Math.min(cornerR, frame.outer.cornerR, Math.min(w, h) / 2));
  return { shape: { kind: 'roundedRect', w, h, r }, x: cx, y: cy, rotDeg: 0 };
}

/** How far an edge profile widens a cut at the face (mm, before any depth clamping). */
export function edgeWidth(e: EdgeProfile): number {
  switch (e.kind) {
    case 'sharp':
      return 0;
    case 'chamfer':
      return Math.max(0, e.size);
    case 'fillet':
    case 'flare':
      return Math.max(0, e.r);
    case 'step':
      return Math.max(0, e.inset);
  }
}

/** Full-size edge widths a style wants: outlets and pocket rims (passthroughs have none). */
export interface EdgeWants {
  opening: number;
  pocket: number;
}

function wantOf(g: ResolvedFeature, wants: EdgeWants): number {
  if (g.kind === 'pocket') return wants.pocket;
  return g.role === 'outlet' ? wants.opening : 0;
}

/**
 * Largest outward widening (mm) an edge treatment of feature `f` may have at the face:
 *  - the wall to every other feature g (incl. its finger notch) keeps ≥ frame.minWall. The spare
 *    wall s = gap − minWall is shared: f may use max(s/2, s − want(g)), where want(g) is the
 *    width g's own edge asks for (`wants`). So when s ≥ want(f) + want(g) — what the resolver
 *    arranges with the styles' edge allowances — both edges get their full size, and when it
 *    is less the two never overlap (each gets at least half, and never more than g leaves);
 *  - the widened outline stays ≥ `margin` inside `plateau` (the flat part of the face).
 */
export function availableEdgeRoom(
  frame: CoverFrame,
  f: ResolvedFeature,
  plateau: Placed,
  wants: EdgeWants,
  margin = 0.5,
): number {
  let room = Infinity;
  for (const g of frame.features) {
    if (g.id === f.id) continue;
    const others = g.kind === 'pocket' && g.notch ? [g.placed, g.notch] : [g.placed];
    const spare = Math.min(...others.map((o) => placedDistance(f.placed, o))) - frame.minWall;
    room = Math.min(room, Math.max(spare / 2, spare - wantOf(g, wants)));
  }
  for (const pt of outlineWorld(f.placed, 0, ROOM_SAMPLES)) {
    room = Math.min(room, insideDistance(plateau, pt) - margin);
  }
  // Floor to µm so "exactly minWall apart" reads as 0, never as float noise.
  return Math.max(0, Math.floor(room * 1e6 + 1e-6) / 1e6);
}
