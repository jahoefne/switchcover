/**
 * Main-thread client for the geometry worker.
 *
 *  - One request in flight at a time.
 *  - Preview builds (kind 'build') coalesce newest-wins: a queued preview that has not
 *    started yet is replaced by a newer one (its promise rejects with SupersededError).
 *  - Export / test-fit requests are never superseded; they run FIFO before queued previews.
 *  - cancel() terminates the worker (aborting the running build), respawns it and rejects
 *    everything pending with CancelledError.
 *  - Downloads must use kind 'export'/'testFit' (export quality by default) — never reuse
 *    the preview mesh.
 */
import type { CoverConfig } from '../config/schema';
import type { BuildKind, BuildRequest, BuildResponse, BuildResult, Quality } from '../geometry/contract';
import { isBuildError } from '../geometry/contract';

/** The subset of Worker the client needs (injectable for tests). */
export interface WorkerLike {
  postMessage(message: BuildRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<BuildResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

export const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export class SupersededError extends Error {
  override name = 'SupersededError';
  constructor() {
    super('Build superseded by a newer request');
  }
}

export class CancelledError extends Error {
  override name = 'CancelledError';
  constructor() {
    super('Build cancelled');
  }
}

/** True for errors the UI should silently ignore (superseded / cancelled builds). */
export function isBenignBuildError(err: unknown): boolean {
  return err instanceof SupersededError || err instanceof CancelledError;
}

interface Job {
  request: BuildRequest;
  resolve(r: BuildResult): void;
  reject(e: Error): void;
}

export interface BuildOptions {
  kind?: BuildKind;
  /** Defaults to 'preview' for 'build' and 'export' for 'export' / 'testFit'. */
  quality?: Quality;
  /** 'testFit' only: pocket id (ResolvedFeature.id) to print; default the first pocket. */
  featureId?: string;
}

export class GeometryClient {
  private worker: WorkerLike;
  private nextId = 1;
  private inFlight: Job | null = null;
  private queuedPreview: Job | null = null;
  private queuedExports: Job[] = [];
  private busyListeners = new Set<(busy: boolean) => void>();
  private disposed = false;

  constructor(private readonly factory: WorkerFactory = defaultWorkerFactory) {
    this.worker = this.spawn();
  }

  /** Request a build. Resolves with the result; rejects with Superseded/Cancelled/Error. */
  build(config: CoverConfig, options: BuildOptions = {}): Promise<BuildResult> {
    const kind = options.kind ?? 'build';
    const quality = options.quality ?? (kind === 'build' ? 'preview' : 'export');
    return new Promise<BuildResult>((resolve, reject) => {
      if (this.disposed) {
        reject(new CancelledError());
        return;
      }
      const request: BuildRequest = { id: this.nextId++, kind, config, quality };
      if (options.featureId !== undefined) request.featureId = options.featureId;
      const job: Job = { request, resolve, reject };
      if (kind === 'build') {
        this.queuedPreview?.reject(new SupersededError());
        this.queuedPreview = job;
      } else {
        this.queuedExports.push(job);
      }
      this.pump();
    });
  }

  /** Abort the running build (terminate + respawn the worker) and drop everything queued. */
  cancel(): void {
    this.abort(true);
  }

  /** Reject everything pending and terminate the worker for good. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort(false);
    this.busyListeners.clear();
  }

  private abort(respawn: boolean): void {
    const pending = [this.inFlight, this.queuedPreview, ...this.queuedExports].filter((j): j is Job => !!j);
    this.inFlight = null;
    this.queuedPreview = null;
    this.queuedExports = [];
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    if (respawn) this.worker = this.spawn();
    for (const job of pending) job.reject(new CancelledError());
    this.emitBusy();
  }

  get busy(): boolean {
    return this.inFlight !== null;
  }

  /** Subscribe to busy changes; returns an unsubscribe function. */
  onBusyChange(listener: (busy: boolean) => void): () => void {
    this.busyListeners.add(listener);
    return () => this.busyListeners.delete(listener);
  }

  private spawn(): WorkerLike {
    const w = this.factory();
    w.onmessage = (e) => this.onMessage(e.data);
    w.onerror = (e) => this.onWorkerError(e);
    return w;
  }

  private pump(): void {
    if (this.inFlight) return;
    const job = this.queuedExports.shift() ?? this.queuedPreview;
    if (!job) {
      this.emitBusy();
      return;
    }
    if (job === this.queuedPreview) this.queuedPreview = null;
    this.inFlight = job;
    this.emitBusy();
    this.worker.postMessage(job.request);
  }

  private onMessage(res: BuildResponse): void {
    const job = this.inFlight;
    if (!job || job.request.id !== res.id) return; // stale (e.g. from before a cancel)
    this.inFlight = null;
    if (isBuildError(res)) job.reject(new Error(res.error));
    else job.resolve(res);
    this.pump();
  }

  private onWorkerError(e: ErrorEvent): void {
    const job = this.inFlight;
    this.inFlight = null;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = this.spawn();
    job?.reject(new Error(`Geometry worker crashed: ${e.message || 'unknown error'}`));
    this.pump();
  }

  private emitBusy(): void {
    const busy = this.busy;
    for (const l of this.busyListeners) l(busy);
  }
}
