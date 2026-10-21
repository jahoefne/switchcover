/**
 * Plan view of a layout as inline SVG (world mm, Y flipped for the screen). Used for the
 * tiny preset schematics and for the clickable module grid.
 *
 * World → SVG: (x, y) → (x, −y); a world CCW rotation θ is `rotate(−θ)` in SVG.
 */
import type { KeyboardEvent } from 'react';
import type { CoverConfig } from '../../config/schema';
import type { CoverFrame, Placed } from '../../geometry/contract';
import { moduleAnchor } from '../../layout/resolve';

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

export function LayoutSvg({ config, frame, interactive = false, selected, onSelect, className, title }: LayoutSvgProps) {
  const { grid, plate } = config;
  const gridW = grid.cols * grid.pitchX;
  const gridH = grid.rows * grid.pitchY;
  const halfW = Math.max(frame.outer.w, plate.w, gridW) / 2;
  const halfH = Math.max(frame.outer.h, plate.h, gridH) / 2;
  const pad = interactive ? 4 : 2;
  const viewBox = `${-halfW - pad} ${-halfH - pad} ${2 * (halfW + pad)} ${2 * (halfH + pad)}`;
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
      {interactive && (
        <rect
          className="cover-outline"
          x={frame.outer.cx - frame.outer.w / 2}
          y={-frame.outer.cy - frame.outer.h / 2}
          width={frame.outer.w}
          height={frame.outer.h}
          rx={Math.min(frame.outer.cornerR, frame.outer.w / 2, frame.outer.h / 2)}
        />
      )}
      <rect
        className="plate"
        x={-plate.w / 2}
        y={-plate.h / 2}
        width={plate.w}
        height={plate.h}
        rx={Math.min(plate.cornerR, plate.w / 2, plate.h / 2)}
      />
      {interactive &&
        cells.map((cell) => {
          const [ax, ay] = moduleAnchor(grid, cell.col, cell.row);
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
