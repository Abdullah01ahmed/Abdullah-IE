/**
 * Web worker entry: generates one procedural texture set per request and
 * transfers the buffers back. Kept tiny so the bundled worker only pulls in
 * textures.ts + noise.ts (no Babylon, no DOM).
 */
import type { MaterialId } from '@tra/shared';
import { generateTextureSet } from './textures';

export interface TexGenRequest {
  type: 'gen' | 'ping';
  jobId: number;
  id?: MaterialId;
  size?: number;
}

export interface TexGenResponse {
  type: 'done' | 'pong' | 'error';
  jobId: number;
  id?: MaterialId;
  size?: number;
  detailSize?: number;
  albedo?: Uint8Array;
  normal?: Uint8Array;
  orm?: Uint8Array;
  hasAlpha?: boolean;
  message?: string;
}

// The client tsconfig uses the DOM lib, so the worker global is typed
// structurally here instead of pulling in the (conflicting) webworker lib.
interface WorkerGlobal {
  onmessage: ((ev: MessageEvent<TexGenRequest>) => void) | null;
  postMessage(message: TexGenResponse, transfer?: Transferable[]): void;
}

const ctx = self as unknown as WorkerGlobal;

ctx.onmessage = (ev) => {
  const req = ev.data;
  if (req.type === 'ping') {
    ctx.postMessage({ type: 'pong', jobId: req.jobId });
    return;
  }
  try {
    const set = generateTextureSet(req.id!, req.size!);
    if (!set) {
      ctx.postMessage({ type: 'error', jobId: req.jobId, message: `no texture set for ${req.id}` });
      return;
    }
    ctx.postMessage(
      { type: 'done', jobId: req.jobId, id: set.id, size: set.size, detailSize: set.detailSize, albedo: set.albedo, normal: set.normal, orm: set.orm, hasAlpha: set.hasAlpha },
      [set.albedo.buffer, set.normal.buffer, set.orm.buffer],
    );
  } catch (e) {
    ctx.postMessage({ type: 'error', jobId: req.jobId, message: e instanceof Error ? e.message : String(e) });
  }
};
