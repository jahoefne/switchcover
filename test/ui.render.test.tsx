// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listPresets, presetConfig } from '../src/config/presets';
import type { CoverConfig } from '../src/config/schema';
import { decodeHash, encodeHash } from '../src/config/urlCodec';
import type { BuildResult } from '../src/geometry/contract';
import { listStyles } from '../src/styles';
import { App } from '../src/ui/App';
import type { BuildOptions } from '../src/worker/client';
import type { GeometryClientLike } from '../src/ui/hooks/useGeometry';

// The three.js viewer needs WebGL, which jsdom does not have.
vi.mock('../src/ui/viewer/Viewer', () => ({
  Viewer: ({ busy, error }: { busy?: boolean; error?: string | null }) => (
    <div data-testid="viewer" data-busy={String(!!busy)}>
      {error}
    </div>
  ),
}));

interface FakeClient extends GeometryClientLike {
  calls: { config: CoverConfig; options?: BuildOptions }[];
}

/** Previews never finish; exports fail like the Phase-0 stub worker. */
function fakeClient(): FakeClient {
  const calls: FakeClient['calls'] = [];
  return {
    calls,
    build: vi.fn((config: CoverConfig, options?: BuildOptions): Promise<BuildResult> => {
      calls.push({ config, options });
      if (options?.kind && options.kind !== 'build') return Promise.reject(new Error('Export is not implemented yet.'));
      return new Promise<BuildResult>(() => {});
    }),
    dispose: vi.fn(),
    onBusyChange: vi.fn(() => () => {}),
  };
}

function setHash(hash: string) {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
}

function renderApp(client = fakeClient()) {
  const createClient = () => client;
  const utils = render(<App createClient={createClient} />);
  return { ...utils, client };
}

beforeEach(() => setHash(''));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders every panel with the default preset, without a real worker', async () => {
    const { client } = renderApp();
    for (const name of ['Presets', 'Plate', 'Modules', 'Style', 'Bilresa & print', 'Export']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    }
    expect(screen.getByTestId('viewer')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe('https://github.com/jahoefne/switchcover');
    const active = screen.getByRole('button', { name: 'CH 1×1 — switch' });
    expect(active.getAttribute('aria-pressed')).toBe('true');
    // Cover numbers come from the main-thread resolveLayout: plate 12 + rocker gap 2 + floor 2.4 + pocket 14.
    expect(screen.getByText(/face at 30\.4 mm/)).toBeTruthy();
    await waitFor(() => expect(client.calls.length).toBeGreaterThan(0));
    expect(client.calls[0].options).toBeUndefined();
  });

  it('lists all presets and all styles', () => {
    renderApp();
    for (const p of listPresets()) expect(screen.getByRole('button', { name: p.label })).toBeTruthy();
    const select = screen.getByLabelText('Style') as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    for (const s of listStyles()) expect(labels).toContain(s.label);
  });

  it('the combo preset card draws the shifted grid, the lying Bilresa above the socket and the taller cover', () => {
    renderApp();
    const card = screen.getByRole('button', { name: 'CH 1×1 — switch + socket combo' });
    const svg = card.querySelector('svg')!;
    // 1 × 2 grid, pitch 31, shifted up 3.5: cells centred at y = +19 and −12 (SVG y = −world y)
    const cells = [...svg.querySelectorAll('.grid-cells rect')].map((r) => Number(r.getAttribute('y')) + Number(r.getAttribute('height')) / 2);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toBeCloseTo(-19, 6);
    expect(cells[1]).toBeCloseTo(12, 6);
    // the lying pocket sits dy 17 above its cell: world y = 19 + 17 = 36
    const pocket = svg.querySelector('.f-pocket')!.getAttribute('transform')!.match(/^translate\(0 (-?[\d.]+)\) rotate\(-90\)$/);
    expect(pocket).not.toBeNull();
    expect(Number(pocket![1])).toBeCloseTo(-36, 6);
    expect(svg.querySelector('.f-outlet')!.getAttribute('transform')).toBe('translate(0 12)');
    // the cover outline reaches above the plate (it grows upwards only) and the view box shows it
    const outline = svg.querySelector('.cover-outline')!;
    const plate = svg.querySelector('.plate')!;
    expect(Number(outline.getAttribute('y'))).toBeLessThan(Number(plate.getAttribute('y')) - 10);
    const [, vy] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(vy).toBeLessThanOrEqual(Number(outline.getAttribute('y')));
  });

  it('the extension preset card draws the slab above the plate; loading it switches the part kind', async () => {
    renderApp();
    const card = screen.getByRole('button', { name: 'CH extension — lying Bilresa above the plate' });
    const svg = card.querySelector('svg')!;
    // the slab's outline (90 × 60) sits right above the plate (SVG y = −world y: top at −105, bottom at −45)
    const outline = svg.querySelector('.cover-outline')!;
    expect(Number(outline.getAttribute('y'))).toBeCloseTo(-105, 6);
    expect(Number(outline.getAttribute('height'))).toBeCloseTo(60, 6);
    expect(Number(outline.getAttribute('width'))).toBeCloseTo(90, 6);
    const plate = svg.querySelector('.plate')!;
    expect(Number(plate.getAttribute('y'))).toBeCloseTo(-45, 6);
    // the one grid cell is centred on the slab, the lying pocket in it
    const cell = svg.querySelector('.grid-cells rect')!;
    expect(Number(cell.getAttribute('y')) + Number(cell.getAttribute('height')) / 2).toBeCloseTo(-75, 6);
    expect(svg.querySelector('.f-pocket')!.getAttribute('transform')).toBe('translate(0 -75) rotate(-90)');
    const [, vy] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(vy).toBeLessThanOrEqual(-105);

    fireEvent.click(card);
    await waitFor(() => expect(decodeHash(window.location.hash).config.part.kind).toBe('extension'));
    expect(decodeHash(window.location.hash).config.part).toEqual({ kind: 'extension', side: 'top', gap: 0, flare: 6 });
    // the Plate panel shows the part switch with the extension fields, the Style panel only a note
    const plateNum = within(document.getElementById('plate')!);
    expect((plateNum.getByLabelText('Side') as HTMLSelectElement).value).toBe('top');
    expect((plateNum.getByLabelText('Rim cove') as HTMLInputElement).value).toBe('6');
    expect(screen.queryByLabelText('Style')).toBeNull();
    expect(within(document.getElementById('style')!).getByText(/Styles apply to caps only/)).toBeTruthy();
    // numbers from the main-thread resolver: 90 × 60, face at the plate's 12 mm, rim 4.4 mm above it, printed face up
    const exportPanel = within(document.getElementById('export')!);
    expect(exportPanel.getByText(/90 × 60 mm, face at 12 mm/)).toBeTruthy();
    expect(exportPanel.getByText(/pocket rim 16\.4 mm, 4\.4 mm above the face/)).toBeTruthy();
    expect(exportPanel.getByText('Face up')).toBeTruthy();
    expect(exportPanel.getByText(/Bilresa 4\.5 mm proud of the rim/)).toBeTruthy();
    // the modules panel offers pockets and blanks only; the interactive grid draws the rim's foot
    const roles = [...(screen.getByLabelText('Role') as HTMLSelectElement).options].map((o) => o.value);
    expect(roles).toEqual(['bilresa', 'blank']);
    expect(document.querySelector('#modules .f-rim')).toBeTruthy();
    expect(document.querySelector('#modules .f-hole')).toBeNull();

    // back to a cap through the part switch: the style panel and the access hole return
    fireEvent.click(plateNum.getByLabelText('Cap over the plate'));
    await waitFor(() => expect(decodeHash(window.location.hash).config.part.kind).toBe('cap'));
    expect(screen.getByLabelText('Style')).toBeTruthy();
    expect(document.querySelector('#modules .f-hole')).toBeTruthy();
    expect(plateNum.queryByLabelText('Side')).toBeNull();
  });

  it('loads a preset from its card', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'CH 2×2 — two switches + two sockets' }));
    expect(screen.getByRole('button', { name: 'CH 2×2 — two switches + two sockets' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(decodeHash(window.location.hash).config.plate.preset).toBe('ch-sd-2x2'));
    expect(decodeHash(window.location.hash).config.modules).toEqual(presetConfig('ch-sd-2x2').modules);
  });

  it('module editor changes the role and the config reflects it', async () => {
    const { client } = renderApp();
    const role = screen.getByLabelText('Role') as HTMLSelectElement;
    expect(role.value).toBe('bilresa');
    fireEvent.change(role, { target: { value: 'outlet' } });
    expect((screen.getByLabelText('Role') as HTMLSelectElement).value).toBe('outlet');
    expect(screen.getByLabelText('Diameter')).toBeTruthy();
    await waitFor(() => {
      const m = decodeHash(window.location.hash).config.modules[0];
      expect(m.role).toBe('outlet');
      expect(m.opening).toEqual({ shape: 'circle', d: 50 }); // the Swiss Type 13 default
      expect(m.bilresa).toBeUndefined();
    });
    await waitFor(() => expect(client.calls.at(-1)?.config.modules[0].role).toBe('outlet'));

    // Selecting the grid cell and removing / re-adding the module.
    fireEvent.click(screen.getByRole('button', { name: 'Remove module' }));
    expect(screen.getByRole('button', { name: /Column 1, row 1: empty/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add module' }));
    expect((screen.getByLabelText('Role') as HTMLSelectElement).value).toBe('bilresa');
  });

  it('selects grid cells by click and keyboard', () => {
    setHash(encodeHash(presetConfig('ch-sd-2x2')));
    renderApp();
    const outlet = screen.getByRole('button', { name: 'Column 2, row 2: outlet' });
    fireEvent.keyDown(outlet, { key: 'Enter' });
    expect(outlet.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Column 2, row 2/, { selector: 'h3' })).toBeTruthy();
    expect((screen.getByLabelText('Role') as HTMLSelectElement).value).toBe('outlet');
    fireEvent.click(screen.getByRole('button', { name: 'Column 1, row 1: bilresa' }));
    expect((screen.getByLabelText('Role') as HTMLSelectElement).value).toBe('bilresa');
    expect(screen.getByLabelText('Variant')).toBeTruthy();
  });

  it('marks the plate as custom when its size changes', async () => {
    renderApp();
    const plate = document.getElementById('plate') as HTMLElement;
    const width = within(plate).getByLabelText('Width') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '100' } });
    await waitFor(() => {
      const c = decodeHash(window.location.hash).config;
      expect(c.plate.w).toBe(100);
      expect(c.plate.preset).toBe('custom');
    });
  });

  it('edits the grid offset under the advanced disclosure; the module grid follows it', async () => {
    renderApp();
    const plate = within(document.getElementById('plate')!);
    const modules = within(document.getElementById('modules')!);
    const cell = () => screen.getByRole('button', { name: /Column 1, row 1/ }).querySelector('rect')!;
    expect(Number(cell().getAttribute('y'))).toBeCloseTo(-30 + 1, 9);
    fireEvent.change(plate.getByLabelText('Grid offset Y'), { target: { value: '3.5' } });
    await waitFor(() => expect(decodeHash(window.location.hash).config.grid.offsetY).toBe(3.5));
    // the module editor shows the same value, the cell (and its pocket) moved up (SVG y is −world y)
    expect((modules.getByLabelText('Grid offset Y') as HTMLInputElement).value).toBe('3.5');
    expect(Number(cell().getAttribute('y'))).toBeCloseTo(-3.5 - 30 + 1, 9);
    fireEvent.change(modules.getByLabelText('Grid offset X'), { target: { value: '-2' } });
    await waitFor(() => expect(decodeHash(window.location.hash).config.grid).toMatchObject({ offsetX: -2, offsetY: 3.5 }));
  });

  it("shows the style's resolved print orientation and follows the organic dome slider", () => {
    const cfg = presetConfig('ch-sd-1x1');
    cfg.cover.style = 'organic';
    cfg.cover.styleParams = { domeSag: 2 };
    setHash(encodeHash(cfg));
    renderApp();
    const exportPanel = within(document.getElementById('export')!);
    const stylePanel = within(document.getElementById('style')!);
    const printPanel = within(document.getElementById('advanced')!);
    expect(exportPanel.getByText('Face up')).toBeTruthy();
    expect(stylePanel.getByText(/face up by default/)).toBeTruthy();
    expect(printPanel.getByRole('option', { name: 'Style default (face up)' })).toBeTruthy();
    expect(exportPanel.queryByText(/look mirrored/)).toBeNull();

    fireEvent.change(stylePanel.getByLabelText('Dome height slider'), { target: { value: '0' } });
    expect(exportPanel.getByText('Face down')).toBeTruthy();
    expect(stylePanel.getByText(/face down by default/)).toBeTruthy();
    expect(printPanel.getByRole('option', { name: 'Style default (face down)' })).toBeTruthy();
    expect(exportPanel.getByText(/look mirrored/)).toBeTruthy();

    // an explicit orientation overrides the style's default, whatever the dome
    fireEvent.change(stylePanel.getByLabelText('Dome height slider'), { target: { value: '3' } });
    expect(exportPanel.getByText('Face up')).toBeTruthy();
    fireEvent.change(printPanel.getByLabelText('Orientation'), { target: { value: 'faceDown' } });
    expect(exportPanel.getByText('Face down')).toBeTruthy();
    expect(printPanel.getByRole('option', { name: 'Style default (face up)' })).toBeTruthy();
  });

  it('shows export errors in a toast instead of crashing', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Download STL' }));
    expect(await screen.findByText(/Export failed: Export is not implemented yet\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download test-fit STL' }));
    expect(await screen.findByText(/Test-fit export failed/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Export' })).toBeTruthy();
  });

  it('lists warnings with the module they point at, and a banner for damaged links', () => {
    const cfg = presetConfig('ch-sd-1x1');
    cfg.modules.push({ col: 3, row: 0, role: 'bilresa', rot: 0, dx: 0, dy: 0, bilresa: { variant: 'wheel' } });
    setHash(encodeHash(cfg));
    renderApp();
    expect(screen.getByText(/outside the 1×1 grid/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'c3r0' })).toBeTruthy();
    cleanup();

    setHash('#v1.garbage');
    renderApp();
    expect(screen.getAllByText(/showing the default layout/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryAllByText(/showing the default layout/)).toHaveLength(0);
  });

  it('copies the share link (clipboard) or falls back to a text field', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(decodeHash(new URL(url).hash).config.plate.preset).toBe('ch-sd-1x1');
    expect(await screen.findByText('Share link copied to the clipboard.')).toBeTruthy();

    writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
    const field = (await screen.findByLabelText('Copy this link:')) as HTMLTextAreaElement;
    expect(field.value).toContain('#v2.');
  });
});
