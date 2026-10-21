/**
 * Committed v1 share links. These strings must keep decoding forever (old links in the
 * wild). Do NOT regenerate them when defaults change; add new fixtures instead.
 *
 * Generated on 2026-10-21 with encodeHash(getPreset(id).config).
 */
export const V1_HASH_FIXTURES = {
  'ch-sd-1x2v-switch-socket':
    '#v1.N4IgbiBcCMA0IAcA2BDALgUyqBAnDAzhmlCAMYAWAtAQCZXQAeATGDQO4CWalNA9mQDWxEPHZQAnAAZ4FKNACsMkLQwI0cmM3hk+uAHYZcAJSgBmAL7wA5rk61s5PkgLz4uPu1eRtibpQANKAA2ZQR-CgBNEKkrEABbPloAVyRCKABtUF0kKGUPcUh85yxIEAAjTiR8AhRREA8SIvhaRjyWgE92iqqaushQMBQ7FH0mkGZy5LQ0Pn0QCyts526CtwaS0j5ptJJ3PiblVu7aLuaQPgQMfU59a0cCChQr0jJOXDI0+odIABZgxYAXR0fDARgeaA6XzK5T4bXgBEhaQACsMUPFvMA4gRBLcACrmBG43BoAk+AB0v3g8VuAHUUEhcj4dGk0foyKU4BshEYAOLPKC+eLDay3KBUkAETgAL1KIBQ0z4C3glWqhH6OAEwjQABE1BpJPAEFriABhVm4UYcvLkszwABmSD4ejJzHJvgo9lU+gAsiKxX94PoDpRHNcUOU0j80LhkhgWvIAfAUGQOQRMSBCmYPVAFEnJTHOAgHk8XmVEShaJxkvF6kzfhLCgB2I2NWNSubrY7nU55bGFhB+3Ci+aQSyt25NUCzNKW9mlKTu+B6TjXNDoTid8tIrCLIA',
  'de-2x1h':
    '#v1.N4IgbiBcCMA0IAcA2BDALgUyqBAnDAzhmlCACYYC0ATAB7QAWI8A7lNAKzXxOQAccchgRpe0AAzwAxgHtcAOwy4ASlAAsAX3gBzXAEsy2ELKQEo3ELhkszMeAj1opDABpQA7IIdOGATQ-QWiAAtjJkAK5IhFAA2qAmUJKW1onwVlGkAEZ6SPgEKMzJJJBJZLSp5ACeFdm5hAWQoGAo+ijyxSDUmeFoaDLyIBpa8TJI7GkpJRMZkCC1eQUTxaXlU1U1OQtGza3tpF09fQNDALrSMmBKRgRolTNzMuXwN3cYAAotKMG2wEEEANZ6eQAFSgAGZnoDcGhQZBqAA6NTwYJAgDqKCQYzh0iin3kUiwdmSUn+SgA4igEOZkS1tED1M89AAvQkgFA9GSDeDzepGBAyEnEAAiwlEUAAnPYBaS0ABhXG4NoExLwiEgABmSBkclhCIsDAMFHkAFlafTIEiQPIZD4jBh5ChMlFDJA0Lhwhh4C7oAA2IIoKQEgg-EBsSBg-VQDh+55uvRUxogAgMSmsm4oMh6cLBQpYtSWsPuexWN3hAh6frjcirUrVEp-OMIU24OkDcNBPBA4qgPpRRX4wnieEWOR6e1odAVttJ24ZIZAA',
} as const;

/** The raw v1 JSON inside the 'ch-sd-1x2v-switch-socket' fixture (snapshot at generation time). */
export const V1_SWITCH_SOCKET_RAW = {
  v: 1,
  plate: {
    preset: 'ch-sd-1x2v-switch-socket',
    w: 90,
    h: 150,
    depth: 12,
    cornerR: 3,
  },
  grid: {
    cols: 1,
    rows: 2,
    pitchX: 60,
    pitchY: 60,
  },
  modules: [
    {
      col: 0,
      row: 0,
      role: 'bilresa',
      rot: 0,
      dx: 0,
      dy: 0,
      bilresa: {
        variant: '2button',
      },
    },
    {
      col: 0,
      row: 1,
      role: 'outlet',
      rot: 0,
      dx: 0,
      dy: 0,
      opening: {
        shape: 'circle',
        d: 46,
      },
    },
  ],
  cover: {
    style: 'box',
    styleParams: {},
    skinT: 3,
    skirtT: 2.4,
    minWall: 2,
    clearance: 1,
    rockerGap: 2,
    margin: 4,
    size: 'auto',
  },
  bilresa: {
    pocketDepth: 9,
    pocketClearance: 0.3,
    floorT: 2.2,
    hiddenMargin: 4,
    notch: {
      enabled: true,
      d: 16,
    },
    access: {
      w: 32,
      h: 56,
    },
    strip: {
      shape: 'stadium',
      l: 44,
      w: 7,
      protrusion: 1,
      dx: 0,
      dy: 0,
    },
    stripMargin: 3,
  },
  print: {
    tolerance: 0.2,
    orientation: 'style',
  },
};

/**
 * What the 'ch-sd-1x2v-switch-socket' v1 fixture decodes to since config v2 (migrate.ts v1ToV2):
 * stripMargin → stripLedge 4, access {w, h} → {w}, the 44 × 7 strip placeholder → the measured
 * 51 × 22 strip; everything else (incl. the user's pocket depth 9 and notch Ø16) is kept.
 */
export const V1_SWITCH_SOCKET_MIGRATED = {
  ...V1_SWITCH_SOCKET_RAW,
  v: 2,
  bilresa: {
    pocketDepth: 9,
    pocketClearance: 0.3,
    floorT: 2.2,
    hiddenMargin: 4,
    notch: { enabled: true, d: 16 },
    access: { w: 32 },
    strip: { shape: 'stadium', l: 51, w: 22, protrusion: 1, dx: 0, dy: 0 },
    stripLedge: 4,
  },
};
