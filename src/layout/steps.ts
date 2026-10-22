/**
 * Resolver steps shared by the cap resolver (resolve.ts) and the extension resolver
 * (resolveExtension.ts): warning codes, module anchors, drafts, automatic spreading, the bridge
 * access hole, the finger-notch position and the requirement-box growth of the outline. Pure TS.
 *
 * resolve.ts re-exports the public helpers, so callers keep importing from there.
 */
import {
  ACCESS_HOLE_CORNER_R,
  BILRESA_VARIANTS,
  MIN_ACCESS_GAP,
  MIN_FLOOR_UNDER_STRIP,
  OUTLET_CH,
  PASSTHROUGH_DEFAULT,
} from '../config/defaults';
import type { CoverConfig, GridSettings, ModuleConfig, OpeningSpec } from '../config/schema';
import type { CoverFrame, Placed, Shape2D, StyleLimits, Vec2, Warning } from '../geometry/contract';
import {
  containmentMargin,
  coreWorld,
  insideDistance,
  offsetPlaced,
  offsetShape,
  placedBounds,
  placedDistance,
  pointInPlaced,
  shapeCore,
  toWorld,
} from '../geometry/shape2d';

/** Codes of every warning the resolvers can emit. */
export const WARNING_CODES = {
  floorClamped: 'floor-clamped',
  moduleOutsideGrid: 'module-outside-grid',
  moduleDuplicate: 'module-duplicate',
  pocketSpread: 'pocket-spread',
  featureOverlap: 'feature-overlap',
  accessNone: 'access-none',
  accessNarrow: 'access-narrow',
  accessUncovered: 'access-uncovered',
  sizeClamped: 'size-clamped',
  coverTooLarge: 'cover-too-large',
  openingDeep: 'opening-deep',
  cavityLow: 'cavity-low',
  frontRaised: 'front-raised',
  edgeReduced: 'edge-reduced',
  /** Extension plates: an outlet / passthrough module was ignored (nothing sits behind the slab). */
  extensionOpening: 'extension-opening-ignored',
  /** Extension plates: the slab is wider than the plate it sits beside (info). */
  extensionWide: 'extension-wider-than-plate',
} as const;

export const DEFAULT_LIMITS: StyleLimits = { minFrame: 0, minFrontZ: 0, maxEdgeR: Infinity };

export const EPS = 1e-6;
export const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** What the resolver needs to know about the style (see CoverStyle). */
export interface ResolveStyle {
  /** `style.limits(params, plate)`. */
  limits: StyleLimits;
  /** `style.allowsNotchInEdge`: finger notches ignore `limits.minFrame` (default false). */
  allowsNotchInEdge?: boolean;
}

/** The grid fields moduleAnchor needs (the offsets default to 0, as in the schema). */
export type AnchorGrid = Pick<GridSettings, 'cols' | 'rows' | 'pitchX' | 'pitchY'> & Partial<Pick<GridSettings, 'offsetX' | 'offsetY'>>;

/**
 * Module (col, row) anchor: row 0 is the TOP row; Y is up. The grid is centred on the plate
 * centre (an extension: on the slab's grid origin), shifted by (offsetX, offsetY):
 *   x = (col − (cols − 1)/2) · pitchX + offsetX,   y = ((rows − 1)/2 − row) · pitchY + offsetY.
 */
export function moduleAnchor(grid: AnchorGrid, col: number, row: number): Vec2 {
  return [
    (col - (grid.cols - 1) / 2) * grid.pitchX + (grid.offsetX ?? 0),
    ((grid.rows - 1) / 2 - row) * grid.pitchY + (grid.offsetY ?? 0),
  ];
}

export function featureId(col: number, row: number): string {
  return `c${col}r${row}`;
}

/** Opening outline for an outlet/passthrough module (missing sizes fall back to defaults). */
export function openingShape(spec: OpeningSpec | undefined, role: 'outlet' | 'passthrough'): Shape2D {
  const fallback = role === 'outlet' ? OUTLET_CH : PASSTHROUGH_DEFAULT;
  const s = spec ?? fallback;
  const d = s.d ?? fallback.d ?? s.w ?? 50;
  const w = s.w ?? fallback.w ?? s.d ?? 50;
  const h = s.h ?? fallback.h ?? s.d ?? 50;
  switch (s.shape) {
    case 'circle':
      return { kind: 'circle', d };
    case 'stadium':
      return { kind: 'stadium', w, h };
    case 'roundedRect':
      return { kind: 'roundedRect', w, h, r: s.cornerR ?? fallback.cornerR ?? 0 };
  }
}

/** A module on its way to becoming a feature: anchor, base centre and automatic spreading. */
export interface Draft {
  id: string;
  module: ModuleConfig;
  kind: 'pocket' | 'opening';
  anchor: Vec2;
  /** Centre before spreading (anchor + dx/dy). */
  base: Vec2;
  /** Accumulated automatic spreading. */
  spread: Vec2;
  shape: Shape2D;
}

export const placedOf = (d: Draft): Placed => ({
  shape: d.shape,
  x: d.base[0] + d.spread[0],
  y: d.base[1] + d.spread[1],
  rotDeg: d.module.rot,
});

function shifted(p: Placed, dx: number, dy: number): Placed {
  return { ...p, x: p.x + dx, y: p.y + dy };
}

/** Smallest s ≥ 0 with gap(s) ≥ target (gap is non-decreasing for separating shapes). */
function solveSeparation(gap: (s: number) => number, target: number): number {
  if (gap(0) >= target - EPS) return 0;
  let hi = 1;
  while (gap(hi) < target && hi < 4096) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * How far (in units of the pair separation s; the pocket moves by s · share along `dir`) a pocket
 * may still move before its rocker (anchor) leaves its access hole. Infinity when the pocket does
 * not move, has no hole, or its rocker is already outside the hole (e.g. moved there by dx/dy).
 */
function accessReach(d: Draft, share: number, dir: Vec2, holeOf: (d: Draft) => Placed | null): number {
  if (d.kind !== 'pocket' || share <= 0) return Infinity;
  const hole = holeOf(d);
  if (!hole || insideDistance(hole, d.anchor) < 0) return Infinity;
  // insideDistance is concave in the point, the anchor moves linearly relative to the hole: the
  // anchor stays inside on an interval [0, t*].
  const inside = (t: number) => insideDistance(shifted(hole, dir[0] * t * share, dir[1] * t * share), d.anchor) >= 0;
  let hi = 1;
  while (inside(hi) && hi < 4096) hi *= 2;
  if (inside(hi)) return Infinity;
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Spread pockets apart along grid axes until every same-row/column pair keeps its target gap
 * (minWall + both edge allowances). A pocket is never pushed beyond the point where its rocker
 * would leave its access hole (the rocker must stay reachable), unless minWall itself needs it:
 * then the pair stops at its structural minimum and the style's edges between them shrink
 * (edge-reduced). Returns the ids of pockets held back like that.
 */
export function spreadPockets(
  drafts: Draft[],
  target: (a: Draft, b: Draft) => number,
  minGap: number,
  holeOf: (d: Draft) => Placed | null,
): Set<string> {
  const held = new Set<string>();
  for (let iter = 0; iter < 200; iter++) {
    let moved = 0;
    for (let i = 0; i < drafts.length; i++) {
      for (let j = i + 1; j < drafts.length; j++) {
        const a = drafts[i];
        const b = drafts[j];
        if (a.kind !== 'pocket' && b.kind !== 'pocket') continue;
        let pos: Draft; // moves along +axis
        let neg: Draft; // moves along −axis
        let axis: Vec2;
        if (a.module.col === b.module.col && a.module.row !== b.module.row) {
          axis = [0, 1];
          [pos, neg] = a.module.row < b.module.row ? [a, b] : [b, a]; // upper row moves up
        } else if (a.module.row === b.module.row && a.module.col !== b.module.col) {
          axis = [1, 0];
          [pos, neg] = a.module.col > b.module.col ? [a, b] : [b, a]; // right column moves right
        } else continue;
        const posShare = pos.kind === 'pocket' ? (neg.kind === 'pocket' ? 0.5 : 1) : 0;
        const negShare = 1 - posShare;
        const pp = placedOf(pos);
        const pn = placedOf(neg);
        const gap = (t: number) =>
          placedDistance(
            shifted(pp, axis[0] * t * posShare, axis[1] * t * posShare),
            shifted(pn, -axis[0] * t * negShare, -axis[1] * t * negShare),
          );
        const full = solveSeparation(gap, target(pos, neg));
        if (full <= 0) continue;
        const reach = Math.min(
          accessReach(pos, posShare, axis, holeOf),
          accessReach(neg, negShare, [-axis[0], -axis[1]], holeOf),
        );
        let s = full;
        if (reach < full) {
          s = Math.max(reach, solveSeparation(gap, minGap));
          if (s < full - 1e-9) for (const d of [pos, neg]) if (d.kind === 'pocket') held.add(d.id);
        }
        if (s <= 0) continue;
        pos.spread = [pos.spread[0] + axis[0] * s * posShare, pos.spread[1] + axis[1] * s * posShare];
        neg.spread = [neg.spread[0] - axis[0] * s * negShare, neg.spread[1] - axis[1] * s * negShare];
        moved = Math.max(moved, s);
      }
    }
    if (moved < 1e-7) return held;
  }
  return held;
}

interface HoleResult {
  holes: Placed[];
  warnings: Warning[];
}

const MIN_HOLE = 0.5;

/**
 * Geometry of a pocket's bridge access hole (see the policy in resolve.ts), or why there is
 * none. It depends only on the pocket's shape and rotation and the Bilresa settings, and is
 * centred on the pocket.
 */
export function bridgeHoleShape(config: CoverConfig, pocket: Placed): { hole: Placed } | { why: string } {
  const { bilresa } = config;
  const { strip, hiddenMargin, stripLedge } = bilresa;
  const core = shapeCore(pocket.shape);
  const outlineW = 2 * (core.hx + core.r);
  const width = Math.min(bilresa.access.w, outlineW - 2 * hiddenMargin);
  const wanted = strip.l - 2 * stripLedge - 2 * Math.abs(strip.dy);
  if (width < MIN_HOLE || wanted < MIN_HOLE) {
    return { why: 'no access hole fits (check the access width, hidden margin, strip length and glue ledges).' };
  }
  const inset = offsetPlaced(pocket, -hiddenMargin);
  const holeOf = (len: number): Placed => ({
    shape: { kind: 'roundedRect', w: width, h: len, r: Math.min(ACCESS_HOLE_CORNER_R, Math.min(width, len) / 2) },
    x: pocket.x,
    y: pocket.y,
    rotDeg: pocket.rotDeg,
  });
  // Shorten (containment is monotone in the length) until the hole is hidden behind the Bilresa.
  let length = wanted;
  if (containmentMargin(holeOf(wanted), inset) < -1e-9) {
    let lo = 0;
    let hi = wanted;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (containmentMargin(holeOf(mid), inset) >= 0) lo = mid;
      else hi = mid;
    }
    length = Math.floor(lo * 100) / 100;
  }
  if (length < MIN_HOLE) return { why: 'no access hole fits under the Bilresa (check the access width and hidden margin).' };
  return { hole: holeOf(length) };
}

/** The single bridge access hole of one pocket and its warnings (see the policy in resolve.ts). */
export function bridgeHole(config: CoverConfig, id: string, anchor: Vec2, pocket: Placed): HoleResult {
  const { strip } = config.bilresa;
  const warnings: Warning[] = [];
  const shape = bridgeHoleShape(config, pocket);
  if ('why' in shape) {
    return {
      holes: [],
      warnings: [{ code: WARNING_CODES.accessNone, severity: 'warning', featureId: id, message: `Pocket ${id}: ${shape.why}` }],
    };
  }
  const { hole } = shape;
  const width = (hole.shape as Extract<Shape2D, { kind: 'roundedRect' }>).w;

  // Tool access: the gaps beside the strip (in the Bilresa's frame; the strip spans the hole).
  const left = strip.dx - strip.w / 2 + width / 2;
  const right = width / 2 - (strip.dx + strip.w / 2);
  if (left <= MIN_HOLE && right <= MIN_HOLE) {
    return {
      holes: [hole],
      warnings: [
        {
          code: WARNING_CODES.accessNone,
          severity: 'warning',
          featureId: id,
          message: `Pocket ${id}: the ${fmt(strip.w)} mm strip covers the whole ${fmt(width)} mm access hole (widen the hole or narrow the strip).`,
        },
      ],
    };
  }
  const narrowest = Math.min(left, right);
  if (narrowest < MIN_ACCESS_GAP - EPS) {
    warnings.push({
      code: WARNING_CODES.accessNarrow,
      severity: 'info',
      featureId: id,
      message: `Pocket ${id}: the access gaps beside the strip are ${fmt(Math.max(0, left))} and ${fmt(Math.max(0, right))} mm wide (< ${MIN_ACCESS_GAP} mm): reach the old switch with a thin tool rather than a fingertip.`,
    });
  }
  if (!pointInPlaced(anchor, hole, 1e-6)) {
    warnings.push({
      code: WARNING_CODES.accessUncovered,
      severity: 'error',
      featureId: id,
      message: `Pocket ${id}: the rocker centre is not inside the access hole (move the pocket back over its switch).`,
    });
  }
  return { holes: [hole], warnings };
}

/**
 * Pocket end farther from the plate centre (the origin, whatever the grid offset). Ties (within
 * 1 µm): the lower end, then the right (+x) end — so a vertical pocket on the plate's horizontal
 * centre line gets its notch at the bottom and a horizontal pocket on the vertical centre line
 * (the combo plate's Bilresa above its socket) at its +x end, whichever way round it is turned.
 * The notch is one of the outline's requirement boxes (see "Outer size"), so it always lies
 * inside the cover, off-centre or not. (An extension's pockets lie beside the plate, so the far
 * end is the one away from it.)
 */
export function notchCentre(pocket: Placed): Vec2 {
  const c = shapeCore(pocket.shape);
  const alongY = c.hy >= c.hx;
  const half = (alongY ? c.hy : c.hx) + c.r;
  const ends: Vec2[] = alongY
    ? [toWorld(pocket, [0, half]), toWorld(pocket, [0, -half])]
    : [toWorld(pocket, [half, 0]), toWorld(pocket, [-half, 0])];
  ends.sort((p, q) => {
    const dp = Math.hypot(p[0], p[1]);
    const dq = Math.hypot(q[0], q[1]);
    if (Math.abs(dp - dq) > 1e-6) return dq - dp;
    if (Math.abs(p[1] - q[1]) > 1e-6) return p[1] - q[1];
    return q[0] - p[0];
  });
  return ends[0];
}

/** Axis-aligned box in world mm (the outer outline before its corners are rounded). */
export interface Box2D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The degenerate box at the plate centre the cap outline grows from. */
export const ORIGIN_BOX: Box2D = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

/** Corners of a box as (sign x, sign y): +x+y, −x+y, −x−y, +x−y. */
const CORNERS: ReadonlyArray<readonly [1 | -1, 1 | -1]> = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * Grow a rounded rect (box `box`, corner radius R) until `p` fits inside: each side moves out
 * only as far as `p` needs on that side (bounding box), then the corners (growCorners).
 */
export function growToContain(box: Box2D, R: number, p: Placed): Box2D {
  const b = placedBounds(p);
  const grown: Box2D = {
    minX: Math.min(box.minX, b.minX),
    maxX: Math.max(box.maxX, b.maxX),
    minY: Math.min(box.minY, b.minY),
    maxY: Math.max(box.maxY, b.maxY),
  };
  return growCorners(grown, R, p);
}

/**
 * Corner part of growToContain (`p` is assumed to fit the box already): where `p`'s rounded
 * corner pokes out of the outline's corner arc, the two sides of THAT corner grow by the same
 * amount (diagonally) until it fits. Content that is symmetric about the plate centre therefore
 * grows symmetrically, exactly as a centred outline would.
 */
export function growCorners(box: Box2D, R: number, p: Placed): Box2D {
  const { r } = shapeCore(p.shape);
  if (r >= R) return box; // bounding-box containment is sufficient
  const rho = R - r;
  const grow = [0, 0, 0, 0];
  for (const [vx, vy] of coreWorld(p)) {
    CORNERS.forEach(([sx, sy], k) => {
      const ex = sx > 0 ? vx - (box.maxX - R) : box.minX + R - vx;
      const ey = sy > 0 ? vy - (box.maxY - R) : box.minY + R - vy;
      if (ex <= 0 || ey <= 0 || Math.hypot(ex, ey) <= rho + EPS) return;
      let lo = 0;
      let hi = Math.min(ex, ey);
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (Math.hypot(Math.max(0, ex - mid), Math.max(0, ey - mid)) <= rho) hi = mid;
        else lo = mid;
      }
      grow[k] = Math.max(grow[k], hi);
    });
  }
  return {
    maxX: box.maxX + Math.max(grow[0], grow[3]),
    minX: box.minX - Math.max(grow[1], grow[2]),
    maxY: box.maxY + Math.max(grow[0], grow[1]),
    minY: box.minY - Math.max(grow[2], grow[3]),
  };
}

export const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-6) / 100;

/** Edge allowances of a style (see StyleLimits); passthroughs get none (plain cut). */
export function edgeAllowances(limits: StyleLimits): { opening: number; pocket: number } {
  const opening = Math.max(0, limits.edgeAllowance ?? 0);
  return { opening, pocket: Math.max(0, limits.pocketEdgeAllowance ?? opening) };
}

type Outline = Pick<CoverFrame['outer'], 'w' | 'h' | 'cx' | 'cy' | 'cornerR'>;

/**
 * Air gap (mm) between a finger notch's backing (the notch + minWall, see features/pocket.ts) and
 * the skirt: how far the backing lies inside the cavity outline (outer inset by skirtT). ≤ 0
 * means the backing reaches the skirt and merges into it; 0 … minWall means features/pocket.ts
 * bridges it to the skirt (no thin air slot).
 */
export function backingGap(outer: Outline, skirtT: number, backing: Placed): number {
  const { w, h, cx, cy, cornerR } = outer;
  const cav = offsetPlaced({ shape: { kind: 'roundedRect', w, h, r: cornerR }, x: cx, y: cy, rotDeg: 0 }, -skirtT);
  return containmentMargin(backing, cav);
}

/** The outer outline as a Placed rounded rect (handy for styles and the cavity). */
export function outerPlaced(frame: CoverFrame, inset = 0): Placed {
  const { w, h, cx, cy, cornerR } = frame.outer;
  return offsetPlaced({ shape: { kind: 'roundedRect', w, h, r: cornerR }, x: cx, y: cy, rotDeg: 0 }, -inset);
}

// ---------------------------------------------------------------------------
// Steps shared by both resolvers
// ---------------------------------------------------------------------------

/** Height chain, part 1: the strip indent depth and the floor thickness (clamped to hold it). */
export function floorChain(config: CoverConfig, warnings: Warning[]): { stripDepth: number; floorT: number } {
  const { bilresa, print } = config;
  const stripDepth = bilresa.strip.protrusion + print.tolerance;
  const minFloorT = stripDepth + MIN_FLOOR_UNDER_STRIP;
  let floorT = bilresa.floorT;
  if (floorT < minFloorT - EPS) {
    warnings.push({
      code: WARNING_CODES.floorClamped,
      severity: 'info',
      message: `Pocket floor raised from ${fmt(floorT)} to ${fmt(minFloorT)} mm (strip indent ${fmt(stripDepth)} mm + ${MIN_FLOOR_UNDER_STRIP} mm).`,
    });
    floorT = minFloorT;
  }
  return { stripDepth, floorT };
}

/**
 * Modules → drafts (ids cXrY, anchors on the grid, base centres anchor + dx/dy, outlines), in
 * row-then-column order. Modules outside the grid and duplicate cells are dropped with a warning,
 * blanks are skipped.
 */
export function moduleDrafts(config: CoverConfig, warnings: Warning[]): Draft[] {
  const { grid, bilresa } = config;
  const seen = new Set<string>();
  const drafts: Draft[] = [];
  const modules = [...config.modules].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const m of modules) {
    const id = featureId(m.col, m.row);
    if (m.col >= grid.cols || m.row >= grid.rows) {
      warnings.push({
        code: WARNING_CODES.moduleOutsideGrid,
        severity: 'warning',
        featureId: id,
        message: `Module at column ${m.col}, row ${m.row} is outside the ${grid.cols}×${grid.rows} grid and was ignored.`,
      });
      continue;
    }
    if (seen.has(id)) {
      warnings.push({
        code: WARNING_CODES.moduleDuplicate,
        severity: 'warning',
        featureId: id,
        message: `Duplicate module at column ${m.col}, row ${m.row} was ignored.`,
      });
      continue;
    }
    seen.add(id);
    if (m.role === 'blank') continue;
    const anchor = moduleAnchor(grid, m.col, m.row);
    const base: Vec2 = [anchor[0] + m.dx, anchor[1] + m.dy];
    const shape: Shape2D =
      m.role === 'bilresa'
        ? offsetShape(BILRESA_VARIANTS[m.bilresa?.variant ?? '2button'].outline, bilresa.pocketClearance)
        : openingShape(m.opening, m.role);
    drafts.push({ id, module: m, kind: m.role === 'bilresa' ? 'pocket' : 'opening', anchor, base, spread: [0, 0], shape });
  }
  return drafts;
}

/**
 * Automatic spreading of the drafts (spreadPockets) and its notes: how far each pocket moved
 * (pocket-spread), pairs closer than minWall (feature-overlap, error) and pairs that keep minWall
 * but not the room the style's edges want (edge-reduced). `holeOf` gives a pocket's access hole
 * (null: the pocket may move freely).
 */
export function spreadDrafts(
  config: CoverConfig,
  drafts: Draft[],
  allow: { opening: number; pocket: number },
  holeOf: (d: Draft) => Placed | null,
  warnings: Warning[],
): void {
  const { cover } = config;
  const allowOf = (d: Draft) => (d.kind === 'pocket' ? allow.pocket : d.module.role === 'outlet' ? allow.opening : 0);
  const targetGap = (a: Draft, b: Draft) => cover.minWall + allowOf(a) + allowOf(b);
  const held = spreadPockets(drafts, targetGap, cover.minWall, holeOf);
  for (const d of drafts) {
    const dist = Math.hypot(d.spread[0], d.spread[1]);
    if (d.kind === 'pocket' && dist > 1e-3) {
      const dir =
        Math.abs(d.spread[1]) >= Math.abs(d.spread[0]) ? (d.spread[1] > 0 ? 'up' : 'down') : d.spread[0] > 0 ? 'right' : 'left';
      const why = held.has(d.id)
        ? ` (no further, so its rocker stays inside the access hole; the edges between them are narrower)`
        : '';
      warnings.push({
        code: WARNING_CODES.pocketSpread,
        severity: 'info',
        featureId: d.id,
        message:
          allow.opening + allow.pocket > 0
            ? `Pocket ${d.id} moved ${fmt(dist)} mm ${dir} to keep a ${fmt(cover.minWall)} mm wall (plus room for this style's edges) to its neighbour${why}.`
            : `Pocket ${d.id} moved ${fmt(dist)} mm ${dir} to keep a ${fmt(cover.minWall)} mm wall to its neighbour${why}.`,
      });
    }
  }
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      const gap = placedDistance(placedOf(drafts[i]), placedOf(drafts[j]));
      if (gap < cover.minWall - 1e-3) {
        warnings.push({
          code: WARNING_CODES.featureOverlap,
          severity: 'error',
          featureId: drafts[i].id,
          message: `${drafts[i].id} and ${drafts[j].id} are only ${fmt(Math.max(0, gap))} mm apart (minimum wall ${fmt(cover.minWall)} mm).`,
        });
      } else if (gap < targetGap(drafts[i], drafts[j]) - 1e-3) {
        // Structurally fine (≥ minWall), but the style's edges between them have to shrink.
        warnings.push({
          code: WARNING_CODES.edgeReduced,
          severity: 'info',
          featureId: drafts[i].id,
          message: `${drafts[i].id} and ${drafts[j].id} are ${fmt(gap)} mm apart, less than the ${fmt(targetGap(drafts[i], drafts[j]))} mm this style's edges need: the edges between them shrink (or the wall at the face gets thinner).`,
        });
      }
    }
  }
}

/** A pocket's depth: the module's own override or the global one. */
export function pocketDepthOf(config: CoverConfig, d: Draft): number {
  return d.module.bilresa?.pocketDepth ?? config.bilresa.pocketDepth;
}

/** The strip indent outline (strip + 2 · tolerance) of a pocket, in world coordinates. */
export function stripIndentOf(config: CoverConfig, placed: Placed): Placed {
  const { strip } = config.bilresa;
  const tol = config.print.tolerance;
  const shape: Shape2D =
    strip.shape === 'stadium'
      ? { kind: 'stadium', w: strip.w + 2 * tol, h: strip.l + 2 * tol }
      : { kind: 'roundedRect', w: strip.w + 2 * tol, h: strip.l + 2 * tol, r: 0 };
  const [sx, sy] = toWorld(placed, [strip.dx, strip.dy]);
  return { shape, x: sx, y: sy, rotDeg: placed.rotDeg };
}
