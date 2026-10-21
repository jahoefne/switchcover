import { describe, expect, it } from 'vitest';
import { presetConfig } from '../src/config/presets';
import type { BuildRequest, BuildResponse, BuildResult } from '../src/geometry/contract';
import { CancelledError, GeometryClient, SupersededError, isBenignBuildError, type WorkerLike } from '../src/worker/client';

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<BuildResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: BuildRequest[] = [];
  terminated = false;
  postMessage(message: BuildRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answer the oldest unanswered request. */
  reply(error?: string): void {
    const req = this.posted.shift();
    if (!req) throw new Error('nothing to reply to');
    const res: BuildResponse = error
      ? { id: req.id, error }
      : ({ id: req.id, positions: new Float32Array(0), indices: new Uint32Array(0), frame: {} as never, stats: { ms: 1, tris: 0, volume: 0, genus: 0 } } satisfies BuildResult);
    this.onmessage?.({ data: res } as MessageEvent<BuildResponse>);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = new GeometryClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { client, workers, current: () => workers[workers.length - 1] };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('GeometryClient', () => {
  it('keeps one build in flight and coalesces queued previews newest-wins', async () => {
    const { client, current } = setup();
    const c = presetConfig('ch-sd-1x1');
    const p1 = client.build(c);
    const p2 = client.build(c);
    const p3 = client.build(c);
    expect(current().posted.map((r) => r.id)).toEqual([1]);
    expect(client.busy).toBe(true);
    await expect(p2).rejects.toBeInstanceOf(SupersededError);
    current().reply();
    await expect(p1).resolves.toMatchObject({ id: 1 });
    expect(current().posted.map((r) => r.id)).toEqual([3]);
    current().reply();
    await expect(p3).resolves.toMatchObject({ id: 3 });
    expect(client.busy).toBe(false);
  });

  it('runs exports FIFO before queued previews and never supersedes them', async () => {
    const { client, current } = setup();
    const c = presetConfig('ch-sd-1x1');
    const first = client.build(c);
    const preview = client.build(c);
    const e1 = client.build(c, { kind: 'export' });
    const e2 = client.build(c, { kind: 'export' });
    current().reply();
    await first;
    expect(current().posted[0]).toMatchObject({ id: 3, kind: 'export', quality: 'export' });
    current().reply();
    await e1;
    expect(current().posted[0]).toMatchObject({ id: 4, kind: 'export' });
    current().reply();
    await e2;
    expect(current().posted[0]).toMatchObject({ id: 2, kind: 'build', quality: 'preview' });
    current().reply();
    await preview;
  });

  it('rejects worker errors and continues with the next request', async () => {
    const { client, current } = setup();
    const c = presetConfig('ch-sd-1x1');
    const a = client.build(c);
    const b = client.build(c, { kind: 'export' });
    current().reply('boom');
    await expect(a).rejects.toThrow('boom');
    current().reply();
    await expect(b).resolves.toMatchObject({ id: 2 });
  });

  it('cancel() terminates, respawns and rejects everything pending', async () => {
    const { client, workers, current } = setup();
    const c = presetConfig('ch-sd-1x1');
    const a = client.build(c);
    const b = client.build(c);
    const e = client.build(c, { kind: 'export' });
    client.cancel();
    await expect(a).rejects.toBeInstanceOf(CancelledError);
    await expect(b).rejects.toBeInstanceOf(CancelledError);
    await expect(e).rejects.toBeInstanceOf(CancelledError);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    const d = client.build(c);
    expect(current().posted.map((r) => r.id)).toEqual([4]);
    current().reply();
    await expect(d).resolves.toMatchObject({ id: 4 });
  });

  it('respawns after a worker crash', async () => {
    const { client, workers } = setup();
    const c = presetConfig('ch-sd-1x1');
    const a = client.build(c);
    const b = client.build(c, { kind: 'export' });
    workers[0].onerror?.({ message: 'wasm failed' } as ErrorEvent);
    await expect(a).rejects.toThrow(/crashed: wasm failed/);
    expect(workers).toHaveLength(2);
    expect(workers[1].posted.map((r) => r.id)).toEqual([2]);
    workers[1].reply();
    await expect(b).resolves.toMatchObject({ id: 2 });
  });

  it('dispose() rejects pending and later builds', async () => {
    const { client, workers } = setup();
    const c = presetConfig('ch-sd-1x1');
    const a = client.build(c);
    client.dispose();
    await expect(a).rejects.toBeInstanceOf(CancelledError);
    await expect(client.build(c)).rejects.toBeInstanceOf(CancelledError);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
    await settle();
    expect(isBenignBuildError(new SupersededError())).toBe(true);
    expect(isBenignBuildError(new Error('x'))).toBe(false);
  });
});
