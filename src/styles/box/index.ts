/**
 * "box" — trivial placeholder style so the pipeline runs end to end in Phase 0.
 * Rounded-rect hull body with sharp edges and a flat face at frontZ. WP1's "minimal"
 * style is the real reference implementation.
 */
import { z } from 'zod';
import type { CoverStyle } from '../../geometry/contract';
import { outerPlaced } from '../../layout/resolve';

const params = z.object({});

export const boxStyle: CoverStyle<typeof params> = {
  id: 'box',
  version: 1,
  label: 'Box (placeholder)',
  description: 'Plain rounded box with sharp edges. Placeholder used until the real styles land.',
  params,
  printOrientation: 'faceDown',
  printHint: 'Print face down on the bed; supports only inside the pockets if your slicer asks.',
  limits: () => ({ minFrame: 0, minFrontZ: 0, maxEdgeR: 0 }),
  surfaceZ: (c) => c.frame.frontZ,
  outerBody: ({ frame, kit }) => {
    const outer = outerPlaced(frame);
    return kit.hull([...kit.ring(outer, 0, 0), ...kit.ring(outer, 0, frame.frontZ)]);
  },
  openingEdge: () => ({ kind: 'chamfer', size: 0 }),
};
