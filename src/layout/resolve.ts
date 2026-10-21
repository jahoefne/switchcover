/**
 * resolveLayout: CoverConfig → CoverFrame. Pure TypeScript (no WASM), deterministic, cheap
 * enough to run on the main thread on every edit.
 *
 * The ONLY place where config conventions (rows top→bottom, module grid) become geometry
 * coordinates (mm, X right, Y up, origin = plate centre). See README "Coordinate conventions".
 *
 * Steps:
 *  1. Height chain: stripDepth, floorT clamp, frontZ.
 *  2. Module anchors (row 0 on top) and feature centres (anchor + dx/dy).
 *  3. Automatic spreading of pockets that are closer than minWall + the two features' edge
 *     allowances (StyleLimits.edgeAllowance / pocketEdgeAllowance) to a neighbour along a grid
 *     axis. Pocket↔pocket conflicts move both symmetrically; pocket↔opening conflicts move only
 *     the pocket (outlets must stay on their socket).
 *  4. Per-pocket strip, access holes (policy below) and finger notch.
 *  5. Outer size (auto or manual ≥ auto), symmetric about the plate centre; see "Outer size".
 *  6. Warnings.
 *
 * Outer size (all containments exact, see growToContain / containmentMargin):
 *  - corner radius R = StyleLimits.cornerR, clamped to ≥ rp + skirtT (rp = plate.cornerR +
 *    clearance, the plate zone's corner) and ≤ half the smaller side; default rp + skirtT.
 *  - plate: the plate zone (plate + clearance) offset by s = max(skirtT, edgeInset(budget)) must
 *    fit inside the outer outline (corner R). For s = skirtT that is exactly "the plate fits the
 *    cavity" (outer inset by skirtT, corner Rc = R − skirtT). On the straight sides that needs a
 *    frame f ≥ 0 between the cavity and the plate zone; in the corners the core corners are
 *    (Rc − rp − f) apart on both axes, so the plate's corner arc stays inside the cavity's iff
 *    √2·(Rc − rp − f) ≤ Rc − rp, i.e.
 *        f ≥ (Rc − rp)·(1 − 1/√2)        (and f ≥ 0; nothing extra when rp ≥ Rc).
 *    With R = 14, rp = 4, skirtT = 2.4 that is 2.23 mm per side (+ ≤ 0.1 mm in tight corners
 *    for the meshed arc's chord error, so the preview mesh clears the plate box too).
 *  - features: outline offset by max(minWall + margin, minFrame) + the feature's edge allowance.
 *  - finger notches: the notch circle offset by max(minWall, minFrame) + the pocket edge
 *    allowance, so the notch (and its rim edge) never cuts into a style's bevel / fillet and its
 *    backing (notch + minWall) always fits. (minWall + margin, as for pockets, would grow plate-
 *    sized covers for a small dimple.) A backing that ends 0 … minWall short of the skirt is
 *    merged into the skirt by features/pocket.ts — the cover does not grow for it.
 *    Styles that allow notches in their edge zone (CoverStyle.allowsNotchInEdge: faceted,
 *    stepped, organic) drop minFrame for the notch: minWall + allowance keeps the backing and the
 *    rim edge inside the outline, and the notch's opening may cut into the bevel / fillet / tier
 *    step. A Ø14 notch then fits the plate-driven size of every 1×1 preset with every style;
 *    where a spread pocket's notch still sets the size (faceted switch + socket) the cover grows
 *    by minWall + the rim allowance only.
 *
 * Access-hole policy (one "bridge" hole per pocket, in the pocket's own unrotated frame):
 *   a rounded rect (corner ACCESS_HOLE_CORNER_R) centred on the POCKET centre,
 *     width  = min(access.w, pocket outline width − 2 · hiddenMargin)
 *     length = strip.l − 2 · stripLedge − 2 · |strip.dy|   (both glue ledges keep ≥ stripLedge)
 *   shortened (never narrowed) until it lies inside the pocket outline inset by hiddenMargin,
 *   i.e. hidden behind the Bilresa. The metal strip is glued onto the two end ledges and spans
 *   the hole; the gaps beside the strip are the tool access. Warnings: no hole → access-none;
 *   the strip covers the whole width → access-none; a gap narrower than MIN_ACCESS_GAP →
 *   access-narrow (info); the anchor (rocker centre) outside the hole → access-uncovered (error).
 */
import {
  ACCESS_HOLE_CORNER_R,
  BILRESA_VARIANTS,
  MAX_OPENING_TUNNEL,
  MAX_PRINT_SIZE,
  MIN_ACCESS_GAP,
  MIN_FLOOR_UNDER_STRIP,
  OUTLET_CH,
  PASSTHROUGH_DEFAULT,
} from '../config/defaults';
import type { CoverConfig, GridSettings, ModuleConfig, OpeningSpec } from '../config/schema';
import type {
  CoverFrame,
  Placed,
  ResolvedFeature,
  Shape2D,
  StyleLimits,
  Vec2,
  Warning,
} from '../geometry/contract';
import {
  containmentMargin,
  coreWorld,
  offsetPlaced,
  offsetShape,
  placedBounds,
  placedDistance,
  pointInPlaced,
  shapeCore,
  toWorld,
} from '../geometry/shape2d';

/** Codes of every warning resolveLayout can emit. */
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
} as const;

export const DEFAULT_LIMITS: StyleLimits = { minFrame: 0, minFrontZ: 0, maxEdgeR: Infinity };

const EPS = 1e-6;
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** Module (col, row) anchor: row 0 is the TOP row; Y is up. */
export function moduleAnchor(grid: GridSettings, col: number, row: number): Vec2 {
  return [(col - (grid.cols - 1) / 2) * grid.pitchX, ((grid.rows - 1) / 2 - row) * grid.pitchY];
}

export function featureId(col: number, row: number): string {
  return `c${col}r${row}`;
}

/** Opening outline for an outlet/passthrough module (missing sizes fall back to defaults). */
export function openingShape(spec: OpeningSpec | undefined, role: 'outlet' | 'passthrough'): Shape2D {
  const fallback = role === 'outlet' ? OUTLET_CH : PASSTHROUGH_DEFAULT;
  const s = spec ?? fallback;
  const d = s.d ?? fallback.d ?? s.w ?? 46;
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

interface Draft {
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

const placedOf = (d: Draft): Placed => ({
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

/** Spread pockets apart along grid axes until every same-row/column pair keeps its target gap. */
function spreadPockets(drafts: Draft[], target: (a: Draft, b: Draft) => number): void {
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
        const s = solveSeparation(
          (t) =>
            placedDistance(
              shifted(pp, axis[0] * t * posShare, axis[1] * t * posShare),
              shifted(pn, -axis[0] * t * negShare, -axis[1] * t * negShare),
            ),
          target(pos, neg),
        );
        if (s <= 0) continue;
        pos.spread = [pos.spread[0] + axis[0] * s * posShare, pos.spread[1] + axis[1] * s * posShare];
        neg.spread = [neg.spread[0] - axis[0] * s * negShare, neg.spread[1] - axis[1] * s * negShare];
        moved = Math.max(moved, s);
      }
    }
    if (moved < 1e-7) return;
  }
}

interface HoleResult {
  holes: Placed[];
  warnings: Warning[];
}

const MIN_HOLE = 0.5;

/** The single bridge access hole of one pocket (see the policy in the file header). */
function bridgeHole(config: CoverConfig, id: string, anchor: Vec2, pocket: Placed): HoleResult {
  const { bilresa } = config;
  const { strip, hiddenMargin, stripLedge } = bilresa;
  const warnings: Warning[] = [];
  const none = (why: string): HoleResult => ({
    holes: [],
    warnings: [{ code: WARNING_CODES.accessNone, severity: 'warning', featureId: id, message: `Pocket ${id}: ${why}` }],
  });

  const core = shapeCore(pocket.shape);
  const outlineW = 2 * (core.hx + core.r);
  const width = Math.min(bilresa.access.w, outlineW - 2 * hiddenMargin);
  const wanted = strip.l - 2 * stripLedge - 2 * Math.abs(strip.dy);
  if (width < MIN_HOLE || wanted < MIN_HOLE) {
    return none('no access hole fits (check the access width, hidden margin, strip length and glue ledges).');
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
  if (length < MIN_HOLE) return none('no access hole fits under the Bilresa (check the access width and hidden margin).');
  const hole = holeOf(length);

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

/** Pocket end farther from the plate centre (ties: lower, then right). */
function notchCentre(pocket: Placed): Vec2 {
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

/** Grow a symmetric rounded rect (half extents hw, hh, corner R) until `p` fits inside. */
function growToContain(hw: number, hh: number, R: number, p: Placed): [number, number] {
  const b = placedBounds(p);
  hw = Math.max(hw, Math.abs(b.minX), Math.abs(b.maxX));
  hh = Math.max(hh, Math.abs(b.minY), Math.abs(b.maxY));
  return growCorners(hw, hh, R, p);
}

/**
 * Corner part of growToContain: grow hw and hh by the same amount until `p`'s rounded corners
 * fit the outline's corner arcs (`p` is assumed to fit the bounding box already).
 */
function growCorners(hw: number, hh: number, R: number, p: Placed): [number, number] {
  const { r } = shapeCore(p.shape);
  if (r >= R) return [hw, hh]; // bounding-box containment is sufficient
  const rho = R - r;
  let grow = 0;
  for (const [vx, vy] of coreWorld(p)) {
    const ex = Math.abs(vx) - (hw - R);
    const ey = Math.abs(vy) - (hh - R);
    if (ex <= 0 || ey <= 0 || Math.hypot(ex, ey) <= rho + EPS) continue;
    let lo = 0;
    let hi = Math.min(ex, ey);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (Math.hypot(Math.max(0, ex - mid), Math.max(0, ey - mid)) <= rho) hi = mid;
      else lo = mid;
    }
    grow = Math.max(grow, hi);
  }
  return [hw + grow, hh + grow];
}

const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-6) / 100;

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

/** What the resolver needs to know about the style (see CoverStyle). */
export interface ResolveStyle {
  /** `style.limits(params, plate)`. */
  limits: StyleLimits;
  /** `style.allowsNotchInEdge`: finger notches ignore `limits.minFrame` (default false). */
  allowsNotchInEdge?: boolean;
}

/**
 * Resolve a validated config into concrete geometry inputs.
 * @param style optional style limits (from `style.limits(params, plate)`) and notch rule.
 */
export function resolveLayout(config: CoverConfig, style?: ResolveStyle): CoverFrame {
  const { plate, grid, cover, bilresa, print } = config;
  const limits = style?.limits ?? DEFAULT_LIMITS;
  const warnings: Warning[] = [];

  // 1. Height chain ---------------------------------------------------------------
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

  // 2. Modules → drafts -----------------------------------------------------------
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

  // 3. Spreading -------------------------------------------------------------------
  const allow = edgeAllowances(limits);
  const allowOf = (d: Draft) => (d.kind === 'pocket' ? allow.pocket : d.module.role === 'outlet' ? allow.opening : 0);
  const targetGap = (a: Draft, b: Draft) => cover.minWall + allowOf(a) + allowOf(b);
  spreadPockets(drafts, targetGap);
  for (const d of drafts) {
    const dist = Math.hypot(d.spread[0], d.spread[1]);
    if (d.kind === 'pocket' && dist > 1e-3) {
      const dir =
        Math.abs(d.spread[1]) >= Math.abs(d.spread[0]) ? (d.spread[1] > 0 ? 'up' : 'down') : d.spread[0] > 0 ? 'right' : 'left';
      warnings.push({
        code: WARNING_CODES.pocketSpread,
        severity: 'info',
        featureId: d.id,
        message:
          allow.opening + allow.pocket > 0
            ? `Pocket ${d.id} moved ${fmt(dist)} mm ${dir} to keep a ${fmt(cover.minWall)} mm wall (plus room for this style's edges) to its neighbour.`
            : `Pocket ${d.id} moved ${fmt(dist)} mm ${dir} to keep a ${fmt(cover.minWall)} mm wall to its neighbour.`,
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

  // Heights ---------------------------------------------------------------------------
  const depthOf = (d: Draft) => d.module.bilresa?.pocketDepth ?? bilresa.pocketDepth;
  const pocketDrafts = drafts.filter((d) => d.kind === 'pocket');
  const maxDepth = pocketDrafts.length ? Math.max(...pocketDrafts.map(depthOf)) : bilresa.pocketDepth;
  let frontZ = plate.depth + cover.rockerGap + floorT + maxDepth;
  if (limits.minFrontZ > frontZ + EPS) {
    warnings.push({
      code: WARNING_CODES.frontRaised,
      severity: 'info',
      message: `Face raised from ${fmt(frontZ)} to ${fmt(limits.minFrontZ)} mm for this style.`,
    });
    frontZ = limits.minFrontZ;
  }

  // 4. Features ---------------------------------------------------------------------
  const tol = print.tolerance;
  const strip = bilresa.strip;
  const stripShapeOf = (): Shape2D =>
    strip.shape === 'stadium'
      ? { kind: 'stadium', w: strip.w + 2 * tol, h: strip.l + 2 * tol }
      : { kind: 'roundedRect', w: strip.w + 2 * tol, h: strip.l + 2 * tol, r: 0 };
  const features: ResolvedFeature[] = drafts.map((d): ResolvedFeature => {
    const placed = placedOf(d);
    if (d.kind === 'opening') {
      return { kind: 'opening', id: d.id, role: d.module.role === 'passthrough' ? 'passthrough' : 'outlet', anchor: d.anchor, placed };
    }
    const [sx, sy] = toWorld(placed, [strip.dx, strip.dy]);
    const stripPlaced: Placed = { shape: stripShapeOf(), x: sx, y: sy, rotDeg: placed.rotDeg };
    const { holes, warnings: hw } = bridgeHole(config, d.id, d.anchor, placed);
    warnings.push(...hw);
    const variant = d.module.bilresa?.variant ?? '2button';
    const notchOn = d.module.bilresa?.notch ?? bilresa.notch.enabled;
    const [nx, ny] = notchCentre(placed);
    return {
      kind: 'pocket',
      id: d.id,
      anchor: d.anchor,
      placed,
      variant,
      floorZ: frontZ - depthOf(d),
      backFilletR: BILRESA_VARIANTS[variant].backFilletR,
      strip: stripPlaced,
      stripDepth,
      holes,
      notch: notchOn ? { shape: { kind: 'circle', d: bilresa.notch.d }, x: nx, y: ny, rotDeg: 0 } : undefined,
    };
  });

  // 5. Outer size (see the file header) -----------------------------------------------
  const plateZone: Placed = {
    shape: { kind: 'roundedRect', w: plate.w + 2 * cover.clearance, h: plate.h + 2 * cover.clearance, r: plate.cornerR + cover.clearance },
    x: 0,
    y: 0,
    rotDeg: 0,
  };
  const rp = shapeCore(plateZone.shape).r;
  let zClear = plate.depth + cover.clearance;
  for (const f of features) if (f.kind === 'pocket') zClear = Math.max(zClear, f.floorZ - floorT);
  const dropBudget = frontZ - zClear - cover.skinT - cover.skirtT;
  const plateFrame = Math.max(cover.skirtT, limits.edgeInset ? Math.max(0, limits.edgeInset(dropBudget)) : 0);
  const plateContent = offsetPlaced(plateZone, plateFrame);
  const contentBox = placedBounds(plateContent);
  // R ≥ rp + skirtT keeps the skirt ≥ skirtT at the corners; R ≤ the content's half extents keeps
  // the rounded rect well formed while it grows (it only grows, so R stays ≤ half the side).
  const cornerR = Math.min(
    Math.max(limits.cornerR ?? 0, rp + cover.skirtT),
    Math.min(contentBox.maxX - contentBox.minX, contentBox.maxY - contentBox.minY) / 2,
  );
  let [hw, hh] = growToContain(0, 0, cornerR, plateContent);
  // Where the plate's corner is tangent to the cavity's, the meshed arcs (chords inside the true
  // arc) would cut into the plate box: leave the largest chord error of the cavity's corner arc
  // at preview quality (10° segments, see kit/init.ts) as extra room in the corners only.
  const chordTol = Math.max(0, cornerR - cover.skirtT) * (1 - Math.cos((5 * Math.PI) / 180)) + 0.01;
  [hw, hh] = growCorners(hw, hh, cornerR, offsetPlaced(plateContent, chordTol));
  const baseMargin = Math.max(cover.minWall + cover.margin, limits.minFrame);
  for (const f of features) {
    const a = f.kind === 'pocket' ? allow.pocket : f.role === 'outlet' ? allow.opening : 0;
    [hw, hh] = growToContain(hw, hh, cornerR, offsetPlaced(f.placed, baseMargin + a));
  }
  // Finger notches (see the file header): keep the notch and its rim edge off the style's edge,
  // or, when the style allows notches in its edge zone, just the backing and the rim inside.
  const notchFrame = style?.allowsNotchInEdge ? cover.minWall : Math.max(cover.minWall, limits.minFrame);
  const notchMargin = notchFrame + allow.pocket;
  for (const f of features) {
    if (f.kind === 'pocket' && f.notch) [hw, hh] = growToContain(hw, hh, cornerR, offsetPlaced(f.notch, notchMargin));
  }
  const autoW = ceil2(2 * hw);
  const autoH = ceil2(2 * hh);
  let w = autoW;
  let h = autoH;
  if (cover.size !== 'auto') {
    w = Math.max(cover.size.w, autoW);
    h = Math.max(cover.size.h, autoH);
    if (cover.size.w < autoW - EPS || cover.size.h < autoH - EPS) {
      warnings.push({
        code: WARNING_CODES.sizeClamped,
        severity: 'warning',
        message: `Requested cover size ${fmt(cover.size.w)} × ${fmt(cover.size.h)} mm is too small; using ${fmt(w)} × ${fmt(h)} mm.`,
      });
    }
  }

  // 6. Global warnings --------------------------------------------------------------
  if (Math.max(w, h) > MAX_PRINT_SIZE) {
    warnings.push({
      code: WARNING_CODES.coverTooLarge,
      severity: 'warning',
      message: `Cover is ${fmt(w)} × ${fmt(h)} mm; sides over ${MAX_PRINT_SIZE} mm may not fit your print bed.`,
    });
  }
  const tunnel = frontZ - plate.depth;
  if (features.some((f) => f.kind === 'opening') && tunnel > MAX_OPENING_TUNNEL + EPS) {
    warnings.push({
      code: WARNING_CODES.openingDeep,
      severity: 'warning',
      message: `Openings are ${fmt(tunnel)} mm deep (face to plate); plugs may not seat beyond ~${MAX_OPENING_TUNNEL} mm.`,
    });
  }
  if (frontZ - cover.skinT < plate.depth + cover.clearance - EPS) {
    warnings.push({
      code: WARNING_CODES.cavityLow,
      severity: 'error',
      message: `The cavity (${fmt(frontZ - cover.skinT)} mm) is lower than the plate + clearance (${fmt(plate.depth + cover.clearance)} mm).`,
    });
  }

  return {
    outer: { w, h, cx: 0, cy: 0, cornerR: Math.min(cornerR, w / 2, h / 2), autoW, autoH },
    plate: { w: plate.w, h: plate.h, protrusion: plate.depth, cornerR: plate.cornerR, clearance: cover.clearance },
    frontZ,
    skinT: cover.skinT,
    skirtT: cover.skirtT,
    minWall: cover.minWall,
    floorT,
    features,
    warnings,
  };
}

/** The outer outline as a Placed rounded rect (handy for styles and the cavity). */
export function outerPlaced(frame: CoverFrame, inset = 0): Placed {
  const { w, h, cx, cy, cornerR } = frame.outer;
  return offsetPlaced({ shape: { kind: 'roundedRect', w, h, r: cornerR }, x: cx, y: cy, rotDeg: 0 }, -inset);
}
