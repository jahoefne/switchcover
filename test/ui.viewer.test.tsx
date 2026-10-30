// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presetConfig } from '../src/config/presets';
import { resolveLayout } from '../src/layout/resolve';
import { Viewer } from '../src/ui/viewer/Viewer';

const { instances } = vi.hoisted(() => ({ instances: [] as Record<string, ReturnType<typeof vi.fn>>[] }));
vi.mock('../src/ui/viewer/scene', () => ({
  CoverScene: class {
    onGhostError: unknown;
    resize = vi.fn();
    dispose = vi.fn();
    setOptions = vi.fn();
    setFrame = vi.fn();
    setMesh = vi.fn();
    fitView = vi.fn();
    setExploded = vi.fn();
    setMotionEnabled = vi.fn();
    revealAssembly = vi.fn();
    constructor() { instances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>); }
  },
}));

const frame = resolveLayout(presetConfig('ch-sd-1x1'));
const mesh = { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array([0]) };
beforeEach(() => { instances.length = 0; });
afterEach(cleanup);

describe('Workshop viewer', () => {
  it('keeps layers separated across geometry updates, and lets replay return to assembly', () => {
    const { rerender } = render(<Viewer frame={frame} mesh={mesh} />);
    const scene = instances[0];
    fireEvent.click(screen.getByRole('button', { name: /Explode layers/ }));
    expect(scene.setExploded).toHaveBeenLastCalledWith(true);
    const updated = { ...mesh, positions: new Float32Array([1, 0, 0]) };
    rerender(<Viewer frame={frame} mesh={updated} />);
    expect(scene.setMesh).toHaveBeenLastCalledWith(updated);
    expect(screen.getByRole('button', { name: /Assemble/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Replay reveal/ }));
    expect(scene.revealAssembly).toHaveBeenCalledOnce();
    expect(scene.setExploded).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: /Explode layers/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('turns motion off in the scene and tells the app to pause its surrounding effects', () => {
    const onMotionChange = vi.fn();
    render(<Viewer frame={frame} mesh={mesh} onMotionChange={onMotionChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Motion on' }));
    expect(instances[0].setMotionEnabled).toHaveBeenLastCalledWith(false);
    expect(onMotionChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Motion off' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves assembly unavailable until a mesh exists and disposes the scene on unmount', () => {
    const { unmount } = render(<Viewer frame={frame} mesh={null} />);
    expect((screen.getByRole('button', { name: /Explode layers/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Replay reveal/ }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    expect(instances[0].dispose).toHaveBeenCalledOnce();
  });
});
