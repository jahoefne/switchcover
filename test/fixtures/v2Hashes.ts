/**
 * Committed v2 share links (`#v2.` prefix, config v2). These strings must keep decoding forever
 * (links in the wild). Do NOT regenerate them when defaults change; add new fixtures instead.
 *
 * Generated on 2026-10-21 with encodeHash(getPreset(id).config).
 */
export const V2_HASH_FIXTURES = {
  'ch-sd-1x2v-switch-socket':
    '#v2.N4IgbiBcBMA0IAcA2BDALgUyqBAnDAzhmlCAMYAWAtAQCZUCMAHtGDQO4CWalNA9mQDWxEPHZQAnAAZ4FKAwCsMkLQwI0cyAzjk+uAHYZcAJSgBmAL7wA5rk61supAXnxcfdi5jwE3SgA0oADZlXx4KAE1gqSsQAFs+WgBXJEIoAG1QMj4kKGV3cUh8nKxIEAAjTiR8AhRREHcSIvhaJjyWgE92iqqaushQMBQ7FH0mkGhypLQ0Pn0QCyssnO6C1waS0j5p1JI3PiblVu7aLuaQPgQMfU59a0cCChQr0jJOXDJU+odIABYgxYAXXg2TARgeaA6XzKcVunDiKFy8AIkNSAAVhig4l5gLECIJbgAVczIgm4NDEmAAOl+8Fh+gA6ojct5yKlMfoyKUGPshEYAOLPKA6BG4ay3KC0kAETgAL1KIBQ0z4C3glWqhH6OAEwjQABE1Bp5KEdcQAMLs3CjLl5KlmeAAMyQfD0lOgNNk9lU+gAssNxfNIPaQPoDpRHNcUOVUj80LgkhgWvJfrEUGQuQQcSBCmYU8i45wEA8ni8yiiULROEk4vUWQodIVoDo8Ad4zK5utjudTnk8QWEAAZDC0aylPOIOxjRyzVJWzmlKRUnR6TjXNDoTgdsuorCLIA',
} as const;

/** What the 'ch-sd-1x2v-switch-socket' v2 fixture decodes to (snapshot at generation time). */
export const V2_SWITCH_SOCKET_EXPECTED = {
  v: 2,
  plate: { preset: 'ch-sd-1x2v-switch-socket', w: 90, h: 150, depth: 12, cornerR: 3 },
  grid: { cols: 1, rows: 2, pitchX: 60, pitchY: 60 },
  modules: [
    { col: 0, row: 0, role: 'bilresa', rot: 0, dx: 0, dy: 0, bilresa: { variant: '2button' } },
    { col: 0, row: 1, role: 'outlet', rot: 0, dx: 0, dy: 0, opening: { shape: 'circle', d: 46 } },
  ],
  cover: { style: 'minimal', styleParams: {}, skinT: 3, skirtT: 2.4, minWall: 2, clearance: 1, rockerGap: 2, margin: 4, size: 'auto' },
  bilresa: {
    pocketDepth: 10,
    pocketClearance: 0.3,
    floorT: 2.4,
    hiddenMargin: 3,
    notch: { enabled: true, d: 14 },
    access: { w: 34 },
    strip: { shape: 'stadium', l: 52, w: 22, protrusion: 1, dx: 0, dy: 0 },
    stripLedge: 4,
  },
  print: { tolerance: 0.2, orientation: 'style' },
};
