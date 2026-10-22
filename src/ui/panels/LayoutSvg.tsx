/**
 * Plan view of a layout as inline SVG (world mm, Y flipped for the screen). Used for the
 * tiny preset schematics and for the clickable module grid.
 *
 * World → SVG: (x, y) → (x, −y); a world CCW rotation θ is `rotate(−θ)` in SVG.
 *
 * Both views draw the cover outline (which may be off the plate centre: frame.outer.cx/cy), the
 * plate at the origin, the module grid at its anchors (shifted by grid.offsetX/Y; an extension's
 * grid is centred on the slab, frame.part.origin) and the features with their rotation; the view
 * box is the union of the three outlines. The interactive view of an extension also draws the
 * foot of each pocket's rim + cove.
 */
import type { KeyboardEvent } from 'react';
import type { CoverConfig } from '../../config/schema';
import type { CoverFrame, Placed, Vec2 } from '../../geometry/contract';
import { moduleAnchor } from '../../layout/resolve';
import { humpFoot } from '../../styles/extension';

export interface Cell {
  col: number;
  row: number;
}

function ShapeEl({ placed, className }: { placed: Placed; className: string }) {
  const { shape, x, y, rotDeg } = placed;
  const transform = `translate(${x} ${-y})${rotDeg ? ` rotate(${-rotDeg})` : ''}`;
  if (shape.kind === 'circle') return <circle className={className} r={shape.d / 2} transform={transform} />;
  const rx = shape.kind === 'stadium' ? Math.min(shape.w, shape.h) / 2 : Math.min(shape.r, shape.w / 2, shape.h / 2);
  return (
    <rect
      className={className}
      x={-shape.w / 2}
      y={-shape.h / 2}
      width={shape.w}
      height={shape.h}
      rx={rx}
      transform={transform}
    />
  );
}

interface LayoutSvgProps {
  config: CoverConfig;
  frame: CoverFrame;
  /** Interactive grid: draws cells, labels, holes and notches. */
  interactive?: boolean;
  selected?: Cell | null;
  onSelect?(cell: Cell): void;
  className?: string;
  title?: string;
}

/** World position of the module grid's origin: the plate centre, or an extension's slab. */
export function gridOrigin(frame: CoverFrame): Vec2 {
  return frame.part.kind === 'extension' ? frame.part.origin : [0, 0];
}

/** World-space box of the cover outline, the plate and the module grid (what the view must show). */
export function layoutBounds(config: CoverConfig, frame: CoverFrame): { minX: number; maxX: number; minY: number; maxY: number } {
  const { grid, plate } = config;
  const { outer } = frame;
  const [ox, oy] = gridOrigin(frame);
  const gx = (grid.offsetX ?? 0) + ox;
  const gy = (grid.offsetY ?? 0) + oy;
  const boxes = [
    [outer.cx - outer.w / 2, outer.cx + outer.w / 2, outer.cy - outer.h / 2, outer.cy + outer.h / 2],
    [-plate.w / 2, plate.w / 2, -plate.h / 2, plate.h / 2],
    [gx - (grid.cols * grid.pitchX) / 2, gx + (grid.cols * grid.pitchX) / 2, gy - (grid.rows * grid.pitchY) / 2, gy + (grid.rows * grid.pitchY) / 2],
  ];
  return {
    minX: Math.min(...boxes.map((b) => b[0])),
    maxX: Math.max(...boxes.map((b) => b[1])),
    minY: Math.min(...boxes.map((b) => b[2])),
    maxY: Math.max(...boxes.map((b) => b[3])),
  };
}

export function LayoutSvg({ config, frame, interactive = false, selected, onSelect, className, title }: LayoutSvgProps) {
  const { grid, plate } = config;
  const b = layoutBounds(config, frame);
  const [ox, oy] = gridOrigin(frame);
  const anchorOf = (col: number, row: number): Vec2 => {
    const [ax, ay] = moduleAnchor(grid, col, row);
    return [ax + ox, ay + oy];
  };
  const extension = frame.part.kind === 'extension';
  const pad = interactive ? 4 : 2;
  // SVG y = −world y: the top of the view is the highest world y.
  const viewBox = `${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  const moduleAt = (col: number, row: number) => config.modules.find((m) => m.col === col && m.row === row);

  const cells: Cell[] = [];
  for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) cells.push({ col, row });

  const onKey = (e: KeyboardEvent, cell: Cell) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(cell);
    }
  };

  return (
    <svg
      className={`layout-svg${interactive ? ' interactive' : ''}${className ? ` ${className}` : ''}`}
      viewBox={viewBox}
      role={interactive ? 'group' : 'img'}
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        className="cover-outline"
        x={frame.outer.cx - frame.outer.w / 2}
        y={-frame.outer.cy - frame.outer.h / 2}
        width={frame.outer.w}
        height={frame.outer.h}
        rx={Math.min(frame.outer.cornerR, frame.outer.w / 2, frame.outer.h / 2)}
      />
      <rect
        className="plate"
        x={-plate.w / 2}
        y={-plate.h / 2}
        width={plate.w}
        height={plate.h}
        rx={Math.min(plate.cornerR, plate.w / 2, plate.h / 2)}
      />
      {!interactive && (
        <g className="grid-cells" pointerEvents="none">
          {cells.map((cell) => {
            const [ax, ay] = anchorOf(cell.col, cell.row);
            return (
              <rect
                key={`${cell.col}-${cell.row}`}
                x={ax - grid.pitchX / 2 + 1}
                y={-ay - grid.pitchY / 2 + 1}
                width={Math.max(0, grid.pitchX - 2)}
                height={Math.max(0, grid.pitchY - 2)}
                rx={3}
              />
            );
          })}
        </g>
      )}
      {interactive &&
        cells.map((cell) => {
          const [ax, ay] = anchorOf(cell.col, cell.row);
          const m = moduleAt(cell.col, cell.row);
          const isSel = selected?.col === cell.col && selected?.row === cell.row;
          const role = m?.role ?? 'empty';
          return (
            <g
              key={`${cell.col}-${cell.row}`}
              className={`cell cell-${role}${isSel ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={`Column ${cell.col + 1}, row ${cell.row + 1}: ${m ? m.role : 'empty'}`}
              onClick={() => onSelect?.(cell)}
              onKeyDown={(e) => onKey(e, cell)}
            >
              <rect
                x={ax - grid.pitchX / 2 + 1}
                y={-ay - grid.pitchY / 2 + 1}
                width={grid.pitchX - 2}
                height={grid.pitchY - 2}
                rx={3}
              />
              {(!m || m.role === 'blank') && (
                <text x={ax} y={-ay} dominantBaseline="middle" textAnchor="middle">
                  {m ? 'blank' : '+'}
                </text>
              )}
            </g>
          );
        })}
      <g className="features" pointerEvents="none">
        {frame.features.map((f) =>
          f.kind === 'pocket' ? (
            <g key={f.id}>
              {interactive && extension && f.rimZ !== undefined && f.rimZ > frame.frontZ + 1e-6 && (
                <ShapeEl placed={humpFoot(frame, f.placed)} className="f-rim" />
              )}
              <ShapeEl placed={f.placed} className="f-pocket" />
              {interactive && f.holes.map((h, i) => <ShapeEl key={i} placed={h} className="f-hole" />)}
              {interactive && <ShapeEl placed={f.strip} className="f-strip" />}
              {interactive && f.notch && <ShapeEl placed={f.notch} className="f-notch" />}
            </g>
          ) : (
            <ShapeEl key={f.id} placed={f.placed} className={f.role === 'outlet' ? 'f-outlet' : 'f-pass'} />
          ),
        )}
        {interactive &&
          frame.features.map((f) => (
            <circle key={`a-${f.id}`} className="f-anchor" cx={f.anchor[0]} cy={-f.anchor[1]} r={1.2} />
          ))}
      </g>
    </svg>
  );
}
