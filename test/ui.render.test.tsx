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
    // Cover numbers come from the main-thread resolveLayout.
    expect(screen.getByText(/face at 25\.4 mm/)).toBeTruthy();
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
      expect(m.opening).toEqual({ shape: 'circle', d: 46 });
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
    expect(field.value).toContain('#v1.');
  });
});
