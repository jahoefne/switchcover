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
 * give back the old size. Those are the covers whose single finger notch pokes past the plate's
 * frame on one side only: the DE presets (minimal, stepped, box: the notch at the bottom end of a
 * centred pocket) and the switch + socket layouts in the organic and faceted styles (the spread
 * pocket's notch at the top). The CH 1×1 combo (added with this rule) is the case it is for: its
 * Bilresa lies above the plate's top edge, so the cover grows upwards only and keeps the socket
 * near its bottom; its `symmetric` is what the former rule would have made of it.
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
  'minimal ch-sd-1x1-combo': { w: 96.8, h: 110.2, cx: 0, cy: 6.7, symmetric: { w: 96.8, h: 123.6 } },
  'minimal ch-sd-1x2v-switch-socket': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'minimal ch-sd-2x1h-two-switches': { w: 156.8, h: 96.8, cx: 0, cy: 0 },
  'minimal ch-sd-1x2v-two-switches': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'minimal ch-sd-1x3v-switch-two-sockets': { w: 96.8, h: 216.8, cx: 0, cy: 0 },
  'minimal ch-sd-3x1h-three-switches': { w: 216.8, h: 96.8, cx: 0, cy: 0 },
  'minimal ch-sd-2x2': { w: 156.8, h: 156.8, cx: 0, cy: 0 },
  'minimal de-1x1': { w: 87.8, h: 88.8, cx: 0, cy: -0.5, symmetric: { w: 87.8, h: 89.8 } },
  'minimal de-1x2v': { w: 87.8, h: 159.8, cx: 0, cy: 0.5, symmetric: { w: 87.8, h: 160.8 } },
  'minimal de-2x1h': { w: 158.8, h: 88.8, cx: 0, cy: -0.5, symmetric: { w: 158.8, h: 89.8 } },
  'minimal custom': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'organic ch-sd-1x1': { w: 101.33, h: 101.33, cx: 0, cy: 0 },
  'organic ch-sd-1x1-combo': { w: 101.33, h: 117.47, cx: 0, cy: 8.0679, symmetric: { w: 101.33, h: 133.61 } },
  'organic ch-sd-1x2v-switch-socket': { w: 101.33, h: 164.27, cx: 0, cy: 1.4679, symmetric: { w: 101.33, h: 167.2 } },
  'organic ch-sd-2x1h-two-switches': { w: 161.33, h: 101.33, cx: 0, cy: 0 },
  'organic ch-sd-1x2v-two-switches': { w: 101.33, h: 161.33, cx: 0, cy: 0 },
  'organic ch-sd-1x3v-switch-two-sockets': { w: 101.33, h: 224.27, cx: 0, cy: 1.4679, symmetric: { w: 101.33, h: 227.2 } },
  'organic ch-sd-3x1h-three-switches': { w: 221.33, h: 101.33, cx: 0, cy: 0 },
  'organic ch-sd-2x2': { w: 161.33, h: 164.27, cx: 0, cy: 1.4679, symmetric: { w: 161.33, h: 167.2 } },
  'organic de-1x1': { w: 91.75, h: 91.75, cx: 0, cy: 0 },
  'organic de-1x2v': { w: 91.75, h: 162.75, cx: 0, cy: 0 },
  'organic de-2x1h': { w: 162.75, h: 91.75, cx: 0, cy: 0 },
  'organic custom': { w: 101.33, h: 101.33, cx: 0, cy: 0 },
  'faceted ch-sd-1x1': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'faceted ch-sd-1x1-combo': { w: 96.8, h: 117.3, cx: 0, cy: 9.65, symmetric: { w: 96.8, h: 136.6 } },
  'faceted ch-sd-1x2v-switch-socket': { w: 96.8, h: 160, cx: 0, cy: 1.6, symmetric: { w: 96.8, h: 163.2 } },
  'faceted ch-sd-2x1h-two-switches': { w: 156.8, h: 96.8, cx: 0, cy: 0 },
  'faceted ch-sd-1x2v-two-switches': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'faceted ch-sd-1x3v-switch-two-sockets': { w: 96.8, h: 220, cx: 0, cy: 1.6, symmetric: { w: 96.8, h: 223.2 } },
  'faceted ch-sd-3x1h-three-switches': { w: 216.8, h: 96.8, cx: 0, cy: 0 },
  'faceted ch-sd-2x2': { w: 156.8, h: 160, cx: 0, cy: 1.6, symmetric: { w: 156.8, h: 163.2 } },
  'faceted de-1x1': { w: 87.8, h: 94.6, cx: 0, cy: 0 },
  'faceted de-1x2v': { w: 87.8, h: 162.2, cx: 0, cy: 1.7, symmetric: { w: 87.8, h: 165.6 } },
  'faceted de-2x1h': { w: 158.8, h: 94.6, cx: 0, cy: 0 },
  'faceted custom': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'stepped ch-sd-1x1': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'stepped ch-sd-1x1-combo': { w: 96.8, h: 112.2, cx: 0, cy: 7.7, symmetric: { w: 96.8, h: 127.6 } },
  'stepped ch-sd-1x2v-switch-socket': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'stepped ch-sd-2x1h-two-switches': { w: 156.8, h: 96.8, cx: 0, cy: 0 },
  'stepped ch-sd-1x2v-two-switches': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'stepped ch-sd-1x3v-switch-two-sockets': { w: 96.8, h: 216.8, cx: 0, cy: 0 },
  'stepped ch-sd-3x1h-three-switches': { w: 216.8, h: 96.8, cx: 0, cy: 0 },
  'stepped ch-sd-2x2': { w: 156.8, h: 156.8, cx: 0, cy: 0 },
  'stepped de-1x1': { w: 87.8, h: 88.8, cx: 0, cy: -0.5, symmetric: { w: 87.8, h: 89.8 } },
  'stepped de-1x2v': { w: 87.8, h: 159.8, cx: 0, cy: 0.5, symmetric: { w: 87.8, h: 160.8 } },
  'stepped de-2x1h': { w: 158.8, h: 88.8, cx: 0, cy: -0.5, symmetric: { w: 158.8, h: 89.8 } },
  'stepped custom': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'box ch-sd-1x1': { w: 96.8, h: 96.8, cx: 0, cy: 0 },
  'box ch-sd-1x1-combo': { w: 96.8, h: 109.6, cx: 0, cy: 6.4, symmetric: { w: 96.8, h: 122.4 } },
  'box ch-sd-1x2v-switch-socket': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'box ch-sd-2x1h-two-switches': { w: 156.8, h: 96.8, cx: 0, cy: 0 },
  'box ch-sd-1x2v-two-switches': { w: 96.8, h: 156.8, cx: 0, cy: 0 },
  'box ch-sd-1x3v-switch-two-sockets': { w: 96.8, h: 216.8, cx: 0, cy: 0 },
  'box ch-sd-3x1h-three-switches': { w: 216.8, h: 96.8, cx: 0, cy: 0 },
  'box ch-sd-2x2': { w: 156.8, h: 156.8, cx: 0, cy: 0 },
  'box de-1x1': { w: 87.8, h: 88.2, cx: 0, cy: -0.2, symmetric: { w: 87.8, h: 88.6 } },
  'box de-1x2v': { w: 87.8, h: 159.2, cx: 0, cy: 0.2, symmetric: { w: 87.8, h: 159.6 } },
  'box de-2x1h': { w: 158.8, h: 88.2, cx: 0, cy: -0.2, symmetric: { w: 158.8, h: 88.6 } },
  'box custom': { w: 96.8, h: 96.8, cx: 0, cy: 0 },};
