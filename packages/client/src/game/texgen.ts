/**
 * Orchestrates procedural texture generation for a match: serves cached sets,
 * farms the rest out to a small pool of web workers when the platform allows
 * it (keeps the loading screen fluid and uses several cores), and otherwise
 * generates on the main thread while yielding between materials.
 *
 * Workers are opportunistic: a page served from file:// (a plain Electron
 * setup) cannot start module workers, so any construction error or a missed
 * ping falls back to the main thread transparently.
 */
import type { MaterialId } from '@tra/shared';
import { cacheTextureSet, getTextureSet, peekTextureSet, type TextureSet } from './textures';
import type { TexGenRequest, TexGenResponse } from './texgen.worker';

export interface TexRequest {
  id: MaterialId;
  size: number;
}

export type TexProgress = (done: number, total: number, id: MaterialId) => void;

export interface TexGenOptions {
  /** Allow a worker pool (default true). Tests set false for determinism. */
  workers?: boolean;
  /** Maximum workers (default: cores - 1, capped at 4). */
  maxWorkers?: number;
  /** Ping timeout before the pool is abandoned (ms). */
  pingTimeoutMs?: number;
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Generate (or fetch from cache) every requested set. Resolves to a map keyed
 * by material id. Requests whose material is 'invisible' are skipped.
 */
export async function generateTextureSets(requests: readonly TexRequest[], onProgress?: TexProgress, opts: TexGenOptions = {}): Promise<Map<MaterialId, TextureSet>> {
  const out = new Map<MaterialId, TextureSet>();
  const pending: TexRequest[] = [];
  const total = requests.length;
  let done = 0;
  for (const r of requests) {
    if (r.id === 'invisible') {
      done++;
      continue;
    }
    const hit = peekTextureSet(r.id, r.size);
    if (hit) {
      out.set(r.id, hit);
      done++;
      onProgress?.(done, total, r.id);
    } else {
      pending.push(r);
    }
  }
  if (!pending.length) return out;

  const useWorkers = (opts.workers ?? true) && typeof Worker !== 'undefined';
  let remaining = pending;
  if (useWorkers) {
    const pool = await WorkerPool.create(opts.maxWorkers, opts.pingTimeoutMs ?? 2000);
    if (pool) {
      try {
        remaining = [];
        await Promise.all(
          pending.map(async (r) => {
            try {
              const set = await pool.generate(r.id, r.size);
              cacheTextureSet(set);
              out.set(r.id, set);
              done++;
              onProgress?.(done, total, r.id);
            } catch {
              // A worker failed this job: do it locally below.
              remaining.push(r);
            }
          }),
        );
      } finally {
        pool.dispose();
      }
    }
  }

  for (const r of remaining) {
    const set = getTextureSet(r.id, r.size);
    if (set) out.set(r.id, set);
    done++;
    onProgress?.(done, total, r.id);
    await yieldToEventLoop();
  }
  return out;
}

interface Job {
  resolve: (set: TextureSet) => void;
  reject: (err: Error) => void;
}

class WorkerPool {
  private nextJob = 1;
  private readonly jobs = new Map<number, Job>();
  private readonly idle: Worker[] = [];
  private readonly queue: { id: MaterialId; size: number; job: Job }[] = [];

  private constructor(private readonly workers: Worker[]) {
    for (const w of workers) {
      w.onmessage = (ev: MessageEvent<TexGenResponse>) => this.onMessage(w, ev.data);
      w.onerror = () => this.failAll(new Error('texture worker crashed'));
      this.idle.push(w);
    }
  }

  static async create(maxWorkers: number | undefined, pingTimeoutMs: number): Promise<WorkerPool | null> {
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    const count = Math.max(1, Math.min(maxWorkers ?? 4, cores - 1));
    const workers: Worker[] = [];
    try {
      for (let i = 0; i < count; i++) {
        workers.push(new Worker(new URL('./texgen.worker.ts', import.meta.url), { type: 'module' }));
      }
    } catch {
      for (const w of workers) w.terminate();
      return null;
    }
    // Every worker must answer a ping; otherwise the platform cannot run them.
    const ok = await Promise.all(
      workers.map(
        (w) =>
          new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), pingTimeoutMs);
            w.onmessage = (ev: MessageEvent<TexGenResponse>) => {
              if (ev.data?.type === 'pong') {
                clearTimeout(timer);
                resolve(true);
              }
            };
            w.onerror = () => {
              clearTimeout(timer);
              resolve(false);
            };
            const ping: TexGenRequest = { type: 'ping', jobId: 0 };
            w.postMessage(ping);
          }),
      ),
    );
    if (ok.some((v) => !v)) {
      for (const w of workers) w.terminate();
      return null;
    }
    return new WorkerPool(workers);
  }

  generate(id: MaterialId, size: number): Promise<TextureSet> {
    return new Promise<TextureSet>((resolve, reject) => {
      this.queue.push({ id, size, job: { resolve, reject } });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const item = this.queue.shift()!;
      const jobId = this.nextJob++;
      this.jobs.set(jobId, item.job);
      const req: TexGenRequest = { type: 'gen', jobId, id: item.id, size: item.size };
      w.postMessage(req);
    }
  }

  private onMessage(w: Worker, msg: TexGenResponse): void {
    const job = this.jobs.get(msg.jobId);
    this.jobs.delete(msg.jobId);
    this.idle.push(w);
    if (job) {
      if (msg.type === 'done' && msg.albedo && msg.normal && msg.orm && msg.id && msg.size && msg.detailSize) {
        job.resolve({ id: msg.id, size: msg.size, albedo: msg.albedo, detailSize: msg.detailSize, normal: msg.normal, orm: msg.orm, hasAlpha: !!msg.hasAlpha });
      } else {
        job.reject(new Error(msg.message ?? 'texture worker error'));
      }
    }
    this.pump();
  }

  private failAll(err: Error): void {
    for (const job of this.jobs.values()) job.reject(err);
    this.jobs.clear();
    for (const q of this.queue) q.job.reject(err);
    this.queue.length = 0;
  }

  dispose(): void {
    this.failAll(new Error('texture worker pool disposed'));
    for (const w of this.workers) w.terminate();
  }
}
