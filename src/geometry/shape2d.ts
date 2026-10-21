/**
 * Pure-TS 2D helpers for Shape2D / Placed (no WASM; used by layout, kit and tests).
 *
 * Every v1 shape is a convex "core" (point, segment or axis-aligned rectangle) Minkowski-
 * summed with a disc of radius r:
 *   circle      → point     ⊕ disc(d/2)
 *   stadium     → segment   ⊕ disc(min(w,h)/2)
 *   roundedRect → rectangle ⊕ disc(r)
 * Offsetting, containment and distances are exact on that representation.
 */
import type { Placed, Shape2D, Vec2 } from './contract';

export interface ShapeCore {
  /** Core half extents (≥ 0) along local X / Y. */
  hx: number;
  hy: number;
  /** Disc radius (≥ 0). */
  r: number;
}

export interface Bounds2D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const DEG = Math.PI / 180;

export function rotateVec([x, y]: Vec2, deg: number): Vec2 {
  if (deg === 0) return [x, y];
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [x * c - y * s, x * s + y * c];
}

/** Local (shape frame) → world. */
export function toWorld(p: Placed, local: Vec2): Vec2 {
  const [x, y] = rotateVec(local, p.rotDeg);
  return [x + p.x, y + p.y];
}

/** World → local (shape frame). */
export function toLocal(p: Placed, world: Vec2): Vec2 {
  return rotateVec([world[0] - p.x, world[1] - p.y], -p.rotDeg);
}

export function shapeCore(shape: Shape2D): ShapeCore {
  switch (shape.kind) {
    case 'circle':
      return { hx: 0, hy: 0, r: Math.max(0, shape.d / 2) };
    case 'stadium': {
      const r = Math.max(0, Math.min(shape.w, shape.h) / 2);
      return { hx: Math.max(0, shape.w / 2 - r), hy: Math.max(0, shape.h / 2 - r), r };
    }
    case 'roundedRect': {
      const r = Math.min(Math.max(0, shape.r), Math.max(0, Math.min(shape.w, shape.h) / 2));
      return { hx: Math.max(0, shape.w / 2 - r), hy: Math.max(0, shape.h / 2 - r), r };
    }
  }
}

/** Core of `shape` offset INWARD by `inset` (negative = outward). Exact for convex shapes. */
export function insetCore(shape: Shape2D, inset: number): ShapeCore {
  const c = shapeCore(shape);
  const r = c.r - inset;
  if (r >= 0) return { hx: c.hx, hy: c.hy, r };
  return { hx: Math.max(0, c.hx + r), hy: Math.max(0, c.hy + r), r: 0 };
}

/** Shape offset OUTWARD by `delta` (negative = inward), same kind. */
export function offsetShape(shape: Shape2D, delta: number): Shape2D {
  switch (shape.kind) {
    case 'circle':
      return { kind: 'circle', d: Math.max(0, shape.d + 2 * delta) };
    case 'stadium':
      return { kind: 'stadium', w: Math.max(0, shape.w + 2 * delta), h: Math.max(0, shape.h + 2 * delta) };
    case 'roundedRect': {
      const c = shapeCore(shape);
      return {
        kind: 'roundedRect',
        w: Math.max(0, shape.w + 2 * delta),
        h: Math.max(0, shape.h + 2 * delta),
        r: Math.max(0, c.r + delta),
      };
    }
  }
}

export function offsetPlaced(p: Placed, delta: number): Placed {
  return { ...p, shape: offsetShape(p.shape, delta) };
}

/** Largest corner/end radius of the shape (used to pick segment counts). */
export function shapeRadius(shape: Shape2D): number {
  return shapeCore(shape).r;
}

/**
 * Outline of `shape` offset inward by `inset`, in the shape's local frame, CCW, starting
 * at the +X/+Y corner. Each rounded corner gets `segments / 4` points (segments is the
 * full-circle count, rounded up to a multiple of 4); sharp corners get one point.
 * Consecutive duplicates are removed.
 */
export function outlineLocal(shape: Shape2D, inset: number, segments: number): Vec2[] {
  const { hx, hy, r } = insetCore(shape, inset);
  const q = Math.max(1, Math.ceil(segments / 4));
  const corners: Array<[number, number, number]> = [
    [hx, hy, 0],
    [-hx, hy, 90],
    [-hx, -hy, 180],
    [hx, -hy, 270],
  ];
  const pts: Vec2[] = [];
  for (const [cx, cy, a0] of corners) {
    if (r <= 0) {
      pts.push([cx, cy]);
      continue;
    }
    for (let i = 0; i < q; i++) {
      const a = (a0 + (90 * i) / q) * DEG;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return dedupe(pts);
}

/** World-space outline of a placed shape (see outlineLocal). */
export function outlineWorld(p: Placed, inset: number, segments: number): Vec2[] {
  return outlineLocal(p.shape, inset, segments).map((v) => toWorld(p, v));
}

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const v of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - v[0]) > 1e-12 || Math.abs(last[1] - v[1]) > 1e-12) out.push(v);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12) out.pop();
  }
  return out;
}

/** Core polygon in world space: 1 point, 2 points (segment) or 4 points (CCW rectangle). */
export function coreWorld(p: Placed): Vec2[] {
  const { hx, hy } = shapeCore(p.shape);
  const local: Vec2[] =
    hx === 0 && hy === 0
      ? [[0, 0]]
      : hx === 0
        ? [
            [0, hy],
            [0, -hy],
          ]
        : hy === 0
          ? [
              [hx, 0],
              [-hx, 0],
            ]
          : [
              [hx, hy],
              [-hx, hy],
              [-hx, -hy],
              [hx, -hy],
            ];
  return local.map((v) => toWorld(p, v));
}

export function placedBounds(p: Placed): Bounds2D {
  const { r } = shapeCore(p.shape);
  const core = coreWorld(p);
  const xs = core.map((v) => v[0]);
  const ys = core.map((v) => v[1]);
  return {
    minX: Math.min(...xs) - r,
    maxX: Math.max(...xs) + r,
    minY: Math.min(...ys) - r,
    maxY: Math.max(...ys) + r,
  };
}

/** Distance from a point to the placed shape's core (0 inside the core). */
function distToCore(pt: Vec2, p: Placed): number {
  const { hx, hy } = shapeCore(p.shape);
  const [lx, ly] = toLocal(p, pt);
  return Math.hypot(Math.max(0, Math.abs(lx) - hx), Math.max(0, Math.abs(ly) - hy));
}

/** True if the point lies inside (or within eps of) the placed shape. */
export function pointInPlaced(pt: Vec2, p: Placed, eps = 1e-6): boolean {
  return distToCore(pt, p) <= shapeCore(p.shape).r + eps;
}

/** True if every point lies inside the placed shape (convex, so vertices suffice for polygons). */
export function pointsInPlaced(pts: Vec2[], p: Placed, eps = 1e-6): boolean {
  return pts.every((v) => pointInPlaced(v, p, eps));
}

/** Corners of a placed roundedRect/stadium's bounding rectangle in world space (CCW). */
export function rectCornersWorld(p: Placed): Vec2[] {
  if (p.shape.kind === 'circle') {
    const r = p.shape.d / 2;
    return [
      [p.x + r, p.y + r],
      [p.x - r, p.y + r],
      [p.x - r, p.y - r],
      [p.x + r, p.y - r],
    ];
  }
  const hw = p.shape.w / 2;
  const hh = p.shape.h / 2;
  return (
    [
      [hw, hh],
      [-hw, hh],
      [-hw, -hh],
      [hw, -hh],
    ] as Vec2[]
  ).map((v) => toWorld(p, v));
}

// --- convex polygon distance ---------------------------------------------------------

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function edges(poly: Vec2[]): Array<[Vec2, Vec2]> {
  if (poly.length === 1) return [[poly[0], poly[0]]];
  if (poly.length === 2) return [[poly[0], poly[1]]];
  return poly.map((v, i) => [v, poly[(i + 1) % poly.length]] as [Vec2, Vec2]);
}

function insideConvex(pt: Vec2, poly: Vec2[]): boolean {
  if (poly.length < 3) return false;
  return poly.every((v, i) => cross2(v, poly[(i + 1) % poly.length], pt) >= -1e-12);
}

function convexDistance(a: Vec2[], b: Vec2[]): number {
  if (a.some((v) => insideConvex(v, b)) || b.some((v) => insideConvex(v, a))) return 0;
  const ea = edges(a);
  const eb = edges(b);
  for (const [p, q] of ea) for (const [r, s] of eb) if (segmentsIntersect(p, q, r, s)) return 0;
  let d = Infinity;
  for (const v of a) for (const [r, s] of eb) d = Math.min(d, pointSegDist(v, r, s));
  for (const v of b) for (const [p, q] of ea) d = Math.min(d, pointSegDist(v, p, q));
  return d;
}

/**
 * Gap between two placed shapes' outlines: > 0 when apart (exact Euclidean distance),
 * ≤ 0 when they touch or overlap (then it is −(rA + rB) at most; not a penetration depth).
 */
export function placedDistance(a: Placed, b: Placed): number {
  return convexDistance(coreWorld(a), coreWorld(b)) - shapeCore(a.shape).r - shapeCore(b.shape).r;
}
