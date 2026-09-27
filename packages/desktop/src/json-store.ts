import { promises as fs } from 'node:fs';
import path from 'node:path';
import { log } from './log';

/** Retries for the final rename: on Windows an antivirus scanner can hold the target for a moment. */
const RENAME_ATTEMPTS = 3;
const RENAME_RETRY_MS = 50;

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
}

/**
 * One JSON document on disk (settings.json / profile.json in userData).
 *
 * - Writes are atomic: the document is written to a temp file next to the
 *   target and renamed over it, so a crash mid-write never leaves a torn file.
 * - Operations are serialised per store, so a burst of saves cannot interleave
 *   their temp files.
 * - A file that no longer parses is moved aside as `<name>.corrupt` and `null`
 *   is returned, so the game starts with defaults instead of failing to boot.
 */
export class JsonStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  load(): Promise<unknown | null> {
    return this.enqueue(() => this.read());
  }

  save(data: unknown): Promise<void> {
    return this.enqueue(() => this.write(data));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<unknown | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') log.warn(`could not read ${this.file}:`, err);
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch (err) {
      log.warn(`${this.file} is not valid JSON (${(err as Error).message}); backing it up as .corrupt and using defaults`);
      await this.quarantine();
      return null;
    }
  }

  private async quarantine(): Promise<void> {
    try {
      await fs.rename(this.file, `${this.file}.corrupt`);
    } catch (err) {
      log.warn(`could not move ${this.file} aside:`, err);
    }
  }

  private async write(data: unknown): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    if (json === undefined) throw new TypeError(`${path.basename(this.file)}: data is not JSON-serialisable`);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, json, 'utf8');
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(tmp, this.file);
        return;
      } catch (err) {
        if (attempt >= RENAME_ATTEMPTS) {
          await fs.rm(tmp, { force: true });
          throw err;
        }
        await new Promise((r) => setTimeout(r, RENAME_RETRY_MS * attempt));
      }
    }
  }
}
