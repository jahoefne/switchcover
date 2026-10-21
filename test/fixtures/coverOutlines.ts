/**
 * Automatic cover outline (w × h, centre cx/cy relative to the plate centre, mm) of every preset ×
 * style, as resolved with the style's limits (src/ui/derive.ts deriveFrame). Checked by
 * test/outlines.test.ts.
 *
 * The outline is the union of the requirement boxes (plate + clearance + skirt, every feature with
 * its margins, every finger notch): each side only goes as far out as something needs it, so its
 * centre may leave the plate centre. Content that is symmetric about the plate centre keeps a
 * centred outline (cx = cy = 0) with exactly the size of the former symmetric rule.
 *
 * `symmetric` records the size under that former rule (outline mirrored about the plate centre,
 * committed until 2026-10-21) where the content is NOT symmetric: there one side now stays at the
 * plate- (or feature-) driven extent instead of mirroring the other, so w + 2·|cx| and h + 2·|cy|
 * give back the old size. With the finger notch off (the default since the 14 mm pocket / Ø50
 * socket defaults) those are the covers whose pocket pokes past the plate's frame at the top while
 * nothing does at the bottom: the switch + socket layouts in the organic and faceted styles (the
 * pocket spread upwards from its Ø50 socket) and faceted DE 1×2 (the wide bevel frame around the
 * top pocket). The CH 1×1 combo is the case the rule is for: its Bilresa lies above the plate's
 * top edge, so the cover grows upwards only and keeps the socket near its bottom; its `symmetric`
 * is what the former rule would have made of it.
 *
 * Do NOT regenerate this for a refactor; change it only with an intentional geometry change.
 */
export interface CoverOutline {
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** Size under the former symmetric rule (only where the content is not symmetric). */
  symmetric?: { w: number; h: number };
}

export const COVER_OUTLINES: Record<string, CoverOutline> = {
  'minimal ch-sd-1x1': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'minimal ch-sd-1x1-combo': { w: 96.8, h: 111.3, cx: 0, cy: 7.25, symmetric: { w: 96.8, h: 125.8 } },
  'minimal ch-sd-1x2v-switch-socket': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'minimal ch-sd-2x1h-two-switches': { w: 156.8, h: 96.8, cx: 0, cy: 0 },
  'minimal ch-sd-1x2v-two-switches': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'minimal ch-sd-1x3v-switch-two-sockets': { w: 96.8, h: 216.8, cx: 0, cy: 0 },
  'minimal ch-sd-3x1h-three-switches': { w: 216.8, h: 96.8, cx: 0, cy: 0 },
  'minimal ch-sd-2x2': { w: 156.8, h: 156.8, cx: 0, cy: 0 },
  'minimal de-1x1': { w: 87.8, h: 87.8, cx: 0, cy: 0 },
  'minimal de-1x2v': { w: 87.8, h: 158.8, cx: 0, cy: 0 },
  'minimal de-2x1h': { w: 158.8, h: 87.8, cx: 0, cy: 0 },
  'minimal custom': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'organic ch-sd-1x1': { w: 101.33, h: 101.33, cx: 0, cy: 0 },
  'organic ch-sd-1x1-combo': { w: 101.33, h: 118.8, cx: 0, cy: 7.4, symmetric: { w: 101.33, h: 133.6 } },
  'organic ch-sd-1x2v-switch-socket': { w: 101.33, h: 166.27, cx: 0, cy: 2.4679, symmetric: { w: 101.33, h: 171.21 } },
  'organic ch-sd-2x1h-two-switches': { w: 161.33, h: 101.33, cx: 0, cy: 0 },
  'organic ch-sd-1x2v-two-switches': { w: 101.33, h: 161.33, cx: 0, cy: 0 },
  'organic ch-sd-1x3v-switch-two-sockets': { w: 101.33, h: 226.27, cx: 0, cy: 2.4679, symmetric: { w: 101.33, h: 231.21 } },
  'organic ch-sd-3x1h-three-switches': { w: 221.33, h: 101.33, cx: 0, cy: 0 },
  'organic ch-sd-2x2': { w: 161.33, h: 166.27, cx: 0, cy: 2.4679, symmetric: { w: 161.33, h: 171.21 } },
  'organic de-1x1': { w: 91.75, h: 91.75, cx: 0, cy: 0 },
  'organic de-1x2v': { w: 91.75, h: 162.75, cx: 0, cy: 0 },
  'organic de-2x1h': { w: 162.75, h: 91.75, cx: 0, cy: 0 },
  'organic custom': { w: 101.33, h: 101.33, cx: 0, cy: 0 },
  'faceted ch-sd-1x1': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'faceted ch-sd-1x1-combo': { w: 96.8, h: 119.3, cx: 0, cy: 8.65, symmetric: { w: 96.8, h: 136.6 } },
  'faceted ch-sd-1x2v-switch-socket': { w: 96.8, h: 162, cx: 0, cy: 2.6, symmetric: { w: 96.8, h: 167.2 } },
  'faceted ch-sd-2x1h-two-switches': { w: 156.8, h: 96.8, cx: 0, cy: 0 },
  'faceted ch-sd-1x2v-two-switches': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'faceted ch-sd-1x3v-switch-two-sockets': { w: 96.8, h: 222, cx: 0, cy: 2.6, symmetric: { w: 96.8, h: 227.2 } },
  'faceted ch-sd-3x1h-three-switches': { w: 216.8, h: 96.8, cx: 0, cy: 0 },
  'faceted ch-sd-2x2': { w: 156.8, h: 162, cx: 0, cy: 2.6, symmetric: { w: 156.8, h: 167.2 } },
  'faceted de-1x1': { w: 87.8, h: 94.6, cx: 0, cy: 0 },
  'faceted de-1x2v': { w: 87.8, h: 162.2, cx: 0, cy: 1.7, symmetric: { w: 87.8, h: 165.6 } },
  'faceted de-2x1h': { w: 158.8, h: 94.6, cx: 0, cy: 0 },
  'faceted custom': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'stepped ch-sd-1x1': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'stepped ch-sd-1x1-combo': { w: 96.8, h: 112.3, cx: 0, cy: 7.75, symmetric: { w: 96.8, h: 127.8 } },
  'stepped ch-sd-1x2v-switch-socket': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'stepped ch-sd-2x1h-two-switches': { w: 156.8, h: 96.8, cx: 0, cy: 0 },
  'stepped ch-sd-1x2v-two-switches': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'stepped ch-sd-1x3v-switch-two-sockets': { w: 96.8, h: 216.8, cx: 0, cy: 0 },
  'stepped ch-sd-3x1h-three-switches': { w: 216.8, h: 96.8, cx: 0, cy: 0 },
  'stepped ch-sd-2x2': { w: 156.8, h: 156.8, cx: 0, cy: 0 },
  'stepped de-1x1': { w: 87.8, h: 87.8, cx: 0, cy: 0 },
  'stepped de-1x2v': { w: 87.8, h: 158.8, cx: 0, cy: 0 },
  'stepped de-2x1h': { w: 158.8, h: 87.8, cx: 0, cy: 0 },
  'stepped custom': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'box ch-sd-1x1': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'box ch-sd-1x1-combo': { w: 96.8, h: 110.7, cx: 0, cy: 6.95, symmetric: { w: 96.8, h: 124.6 } },
  'box ch-sd-1x2v-switch-socket': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'box ch-sd-2x1h-two-switches': { w: 156.8, h: 96.8, cx: 0, cy: 0 },
  'box ch-sd-1x2v-two-switches': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'box ch-sd-1x3v-switch-two-sockets': { w: 96.8, h: 216.8, cx: 0, cy: 0 },
  'box ch-sd-3x1h-three-switches': { w: 216.8, h: 96.8, cx: 0, cy: 0 },
  'box ch-sd-2x2': { w: 156.8, h: 156.8, cx: 0, cy: 0 },
  'box de-1x1': { w: 87.8, h: 87.8, cx: 0, cy: 0 },
  'box de-1x2v': { w: 87.8, h: 158.8, cx: 0, cy: 0 },
  'box de-2x1h': { w: 158.8, h: 87.8, cx: 0, cy: 0 },
  'box custom': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
};
