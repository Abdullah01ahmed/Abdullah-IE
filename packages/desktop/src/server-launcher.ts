import { existsSync } from 'node:fs';
import type { HostServerOptions, HostServerResult, MatchSettings, ServerStatus } from '@tra/shared';
import type { ServerLogEntry } from './ipc';
import { log } from './log';

/** The server must print its READY/ERROR handshake line within this long. */
export const SERVER_START_TIMEOUT_MS = 10_000;
/** After a graceful stop request the process gets this long before it is killed. */
export const SERVER_STOP_GRACE_MS = 2_000;
/** Log lines kept for a renderer that subscribes after the server started. */
export const LOG_BUFFER_LINES = 200;
/** A single stdout/stderr line longer than this is cut (protects against a runaway writer). */
const MAX_LINE_LENGTH = 16 * 1024;

const READY_RE = /^TRA_SERVER_READY port=(\d+)\s*$/;
const ERROR_RE = /^TRA_SERVER_ERROR code=(\S+) message=(.*)$/;

/**
 * The part of Electron's `UtilityProcess` the launcher relies on. Node's
 * `ChildProcess` satisfies it too, which is how the launcher is exercised
 * outside Electron.
 */
export interface ServerChild {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  /** Graceful termination request (SIGTERM on POSIX). Returns false if the process is already gone. */
  kill(): boolean;
}

export interface ServerLauncherOptions {
  /** Spawns the server bundle with stdout/stderr piped. */
  fork: (modulePath: string, args: string[]) => ServerChild;
  /** Candidate locations of server.cjs; the first one that exists is used. */
  serverPaths: string[];
  /** LAN addresses to include in a successful start result. */
  lanAddresses: () => string[];
  onLog: (entry: ServerLogEntry) => void;
  onExit: (info: { code: number | null }) => void;
  /** Last resort when the process ignores the graceful stop. */
  forceKill?: (pid: number) => void;
}

/** Translate lobby options into the server's command-line flags. */
export function buildServerArgs(opts: HostServerOptions): string[] {
  const args = ['--port', String(opts.port)];
  if (opts.password) args.push('--password', opts.password);
  if (opts.serverName && opts.serverName.trim()) args.push('--name', opts.serverName.trim());

  const s: Partial<MatchSettings> = opts.settings ?? {};
  const int = (flag: string, value: number | undefined): void => {
    if (typeof value === 'number' && Number.isFinite(value)) args.push(flag, String(Math.round(value)));
  };
  const bool = (flag: string, value: boolean | undefined): void => {
    if (typeof value === 'boolean') args.push(flag, value ? 'true' : 'false');
  };
  if (s.mapId) args.push('--map', s.mapId);
  if (s.mode) args.push('--mode', s.mode);
  int('--score-limit', s.scoreLimit);
  int('--time-limit', s.timeLimitSec);
  int('--respawn-delay', s.respawnDelaySec);
  bool('--friendly-fire', s.friendlyFire);
  if (s.bots) {
    if (s.bots.mode) args.push('--bots', s.bots.mode);
    int('--bots-tigris', s.bots.tigris);
    int('--bots-euphrates', s.bots.euphrates);
    if (s.bots.difficulty) args.push('--bot-difficulty', s.bots.difficulty);
    bool('--replace-bots', s.bots.replaceWithHumans);
  }
  // mapRotation has no CLI flag; the host changes it from the lobby.
  return args;
}

/** Turn a server error code into something the host screen can show. */
export function describeStartError(code: string, detail: string, port: number): string {
  switch (code) {
    case 'PORT_IN_USE':
      return `Port ${port} is already in use. Pick another port or close the program that is using it.`;
    case 'EADDRNOTAVAIL':
      return `The server could not bind to the requested address (${detail}).`;
    default:
      return detail || `The server failed to start (${code}).`;
  }
}

function redact(args: string[]): string {
  return args
    .map((a, i) => (i > 0 && args[i - 1] === '--password' ? '***' : a))
    .join(' ');
}

/** Feed complete lines (without the newline) from a piped stream to `onLine`. */
function readLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return;
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string | Buffer) => {
    rest += chunk.toString();
    let nl: number;
    while ((nl = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, nl).replace(/\r$/, '');
      rest = rest.slice(nl + 1);
      if (line.length) onLine(line);
    }
    if (rest.length > MAX_LINE_LENGTH) {
      onLine(rest.slice(0, MAX_LINE_LENGTH));
      rest = '';
    }
  });
  stream.on('end', () => {
    if (rest.trim().length) onLine(rest.replace(/\r$/, ''));
    rest = '';
  });
}

/**
 * Runs the embedded game server as a child process and speaks its stdout
 * handshake (`TRA_SERVER_READY` / `TRA_SERVER_ERROR`). At most one server runs
 * at a time; starting while one is running stops the old one first.
 */
export class ServerLauncher {
  private child: ServerChild | null = null;
  private port: number | null = null;
  private stopping: Promise<void> | null = null;
  private readonly buffer: ServerLogEntry[] = [];
  private seq = 0;
  private readonly forceKill: (pid: number) => void;

  constructor(private readonly options: ServerLauncherOptions) {
    this.forceKill = options.forceKill ?? ((pid) => process.kill(pid, 'SIGKILL'));
  }

  status(): ServerStatus {
    return { running: this.child !== null, port: this.port, pid: this.child?.pid };
  }

  /** The most recent log lines of the current (or last) server run. */
  recentLog(): ServerLogEntry[] {
    return this.buffer.slice();
  }

  async start(opts: HostServerOptions): Promise<HostServerResult> {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      return { ok: false, error: 'INVALID_PORT', message: 'Enter a port between 1 and 65535.' };
    }
    if (this.child) {
      log.info('a server is already running; stopping it before starting a new one');
      await this.stop();
    }
    const serverPath = this.options.serverPaths.find((p) => existsSync(p));
    if (!serverPath) {
      return {
        ok: false,
        error: 'NOT_AVAILABLE',
        message: `The server bundle is missing (looked in ${this.options.serverPaths.join(', ')}). Run "npm run build:server" or reinstall the game.`,
      };
    }

    const args = buildServerArgs({ ...opts, port });
    this.buffer.length = 0;
    let child: ServerChild;
    try {
      child = this.options.fork(serverPath, args);
    } catch (err) {
      log.error('could not spawn the server:', err);
      return { ok: false, error: 'SPAWN_FAILED', message: `Could not start the server process: ${(err as Error).message}` };
    }
    this.child = child;
    this.port = null;
    log.info(`server starting pid=${child.pid ?? '?'} ${serverPath} ${redact(args)}`);

    return new Promise<HostServerResult>((resolve) => {
      let settled = false;
      const settle = (result: HostServerResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        log.warn('server start timed out');
        void this.stop();
        settle({ ok: false, error: 'SPAWN_FAILED', message: `The server did not start within ${SERVER_START_TIMEOUT_MS / 1000} seconds.` });
      }, SERVER_START_TIMEOUT_MS);

      const onLine = (line: string): void => {
        const ready = READY_RE.exec(line);
        if (ready) {
          this.port = Number(ready[1]);
          log.info(`server ready on port ${this.port}`);
          settle({ ok: true, port: this.port, lanAddresses: this.options.lanAddresses() });
          return;
        }
        const error = ERROR_RE.exec(line);
        if (error) {
          log.warn(`server reported ${error[1]}: ${error[2]}`);
          settle({ ok: false, error: error[1], message: describeStartError(error[1], error[2], port) });
          return;
        }
        this.pushLog(line);
      };
      readLines(child.stdout, onLine);
      readLines(child.stderr, onLine);

      child.on('error', (err) => {
        log.error('server process error:', err);
        settle({ ok: false, error: 'SPAWN_FAILED', message: `The server process failed: ${err instanceof Error ? err.message : String(err)}` });
      });
      child.once('exit', (code) => {
        this.handleExit(child, code);
        const last = this.buffer.length ? ` Last output: ${this.buffer[this.buffer.length - 1].line}` : '';
        settle({ ok: false, error: 'SPAWN_FAILED', message: `The server exited (code ${code ?? 'unknown'}) before it was ready.${last}` });
      });
    });
  }

  /** Ask the server to shut down; force-kill it if it has not exited after the grace period. */
  stop(): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    if (this.stopping) return this.stopping;
    this.stopping = new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(killTimer);
        clearTimeout(giveUp);
        this.stopping = null;
        resolve();
      };
      const killTimer = setTimeout(() => {
        if (child.pid === undefined) return;
        log.warn(`server pid=${child.pid} ignored the stop request; killing it`);
        try {
          this.forceKill(child.pid);
        } catch (err) {
          log.warn('force kill failed:', err);
        }
      }, SERVER_STOP_GRACE_MS);
      // Never let a stuck process hold up app quit.
      const giveUp = setTimeout(finish, SERVER_STOP_GRACE_MS + 1_000);
      child.once('exit', finish);
      log.info(`stopping server pid=${child.pid ?? '?'}`);
      if (!child.kill()) finish();
    });
    return this.stopping;
  }

  private handleExit(child: ServerChild, code: number | null): void {
    if (this.child !== child) return; // a newer server replaced this one
    log.info(`server exited with code ${code ?? 'unknown'}`);
    this.child = null;
    this.port = null;
    this.options.onExit({ code });
  }

  private pushLog(line: string): void {
    const entry: ServerLogEntry = { seq: ++this.seq, line };
    this.buffer.push(entry);
    if (this.buffer.length > LOG_BUFFER_LINES) this.buffer.splice(0, this.buffer.length - LOG_BUFFER_LINES);
    this.options.onLog(entry);
  }
}
