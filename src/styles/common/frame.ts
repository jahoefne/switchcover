/**
 * Frame helpers shared by the organic, faceted and stepped styles (pure TS, no WASM).
 *
 *  - `bodyPlaced`: the style's outline (frame size, style corner radius).
 *  - `cornerFrame`: the minFrame a corner radius needs so the resolver's outline is at least
 *    as round as the style's (see below).
 *  - `edgeRoom`: how wide an opening/pocket edge treatment may be at the face before it eats
 *    into a neighbouring feature's wall or leaves the flat part of the face.
 *
 * Corner radius rule: WP1's cavity is the FRAME outline (corner radius frame.outer.cornerR)
 * inset by skirtT. A body with a larger corner radius than the frame would thin (or pierce)
 * the skirt at the corners, so the body radius is clamped to frame.outer.cornerR. The resolver
 * derives that radius as plate.cornerR + clearance + max(skirtT, minFrame), so a style asks for
 * its radius through `limits().minFrame ≥ cornerFrame(cornerR, plate)`.
 */
import type { CoverFrame, Placed, ResolvedFeature, Vec2 } from '../../geometry/contract';
import { outlineWorld, placedDistance, shapeCore, toLocal } from '../../geometry/shape2d';

/** Outline samples used to measure a feature's distance to the plateau edge. */
const ROOM_SAMPLES = 72;

/** The style's body outline: frame size and centre, style corner radius (≤ frame radius). */
export function bodyPlaced(frame: CoverFrame, cornerR: number): Placed {
  const { w, h, cx, cy } = frame.outer;
  const r = Math.max(0, Math.min(cornerR, frame.outer.cornerR, Math.min(w, h) / 2));
  return { shape: { kind: 'roundedRect', w, h, r }, x: cx, y: cy, rotDeg: 0 };
}

/** minFrame needed so the resolver's outline corner radius reaches `cornerR` (see header). */
export function cornerFrame(cornerR: number, plate: CoverFrame['plate']): number {
  return cornerR - plate.cornerR - plate.clearance;
}

/** The plate grown by its clearance (the zone the cover must never fill), centred on the origin. */
export function plateZone(plate: CoverFrame['plate']): Placed {
  const c = plate.clearance;
  return {
    shape: { kind: 'roundedRect', w: plate.w + 2 * c, h: plate.h + 2 * c, r: plate.cornerR + c },
    x: 0,
    y: 0,
    rotDeg: 0,
  };
}

/**
 * Signed distance from `pt` to the boundary of a placed shape, POSITIVE INSIDE (exact for every
 * Shape2D: each is a rectangle/segment/point core ⊕ a disc, see shape2d.ts).
 */
export function insideDistance(p: Placed, pt: Vec2): number {
  const { hx, hy, r } = shapeCore(p.shape);
  const [lx, ly] = toLocal(p, pt);
  const qx = Math.abs(lx) - hx;
  const qy = Math.abs(ly) - hy;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return r - (outside + inside);
}

/**
 * Largest outward widening (mm) an edge treatment of feature `f` may have at the face:
 *  - the wall to every other feature (incl. pocket notches) keeps ≥ frame.minWall, with the
 *    spare split evenly between the two features (a passthrough has no edge, so its
 *    neighbour may use all of it);
 *  - the widened outline stays ≥ `margin` inside `plateau` (the flat part of the face).
 * The resolver only spaces features by minWall, so this is often 0 between a pocket and the
 * outlet below it.
 */
export function edgeRoom(frame: CoverFrame, f: ResolvedFeature, plateau: Placed, margin = 0.5): number {
  let room = Infinity;
  for (const g of frame.features) {
    if (g.id === f.id) continue;
    const others = g.kind === 'pocket' && g.notch ? [g.placed, g.notch] : [g.placed];
    const gap = Math.min(...others.map((o) => placedDistance(f.placed, o)));
    const share = g.kind === 'opening' && g.role === 'passthrough' ? 1 : 0.5;
    room = Math.min(room, (gap - frame.minWall) * share);
  }
  for (const pt of outlineWorld(f.placed, 0, ROOM_SAMPLES)) {
    room = Math.min(room, insideDistance(plateau, pt) - margin);
  }
  // Floor to µm so "exactly minWall apart" reads as 0, never as float noise.
  return Math.max(0, Math.floor(room * 1e6 + 1e-6) / 1e6);
}
