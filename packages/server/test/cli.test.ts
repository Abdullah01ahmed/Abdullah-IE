/**
 * The CLI bundle as the Electron launcher uses it: build with esbuild exactly
 * like `npm run build`, run it with plain node, and check the stdout handshake,
 * exit codes and graceful shutdown.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TestClient } from './helpers';

const ROOT = join(__dirname, '..');
let bundle = '';
const children: ChildProcess[] = [];

interface Proc {
  child: ChildProcess;
  lines: string[];
  /** Resolve with the first stdout line matching `re`. */
  waitLine(re: RegExp, timeoutMs?: number): Promise<string>;
  exit: Promise<number | null>;
}

function run(args: string[], env: NodeJS.ProcessEnv = {}): Proc {
  const child = spawn(process.execPath, [bundle, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const lines: string[] = [];
  const waiters: { re: RegExp; resolve: (l: string) => void }[] = [];
  let buffer = '';
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      lines.push(line);
      for (const w of waiters.splice(0)) {
        if (w.re.test(line)) w.resolve(line);
        else waiters.push(w);
      }
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => lines.push(`[stderr] ${chunk.trimEnd()}`));
  const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return {
    child,
    lines,
    exit,
    waitLine(re, timeoutMs = 15_000) {
      const found = lines.find((l) => re.test(l));
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no line matching ${re}; got ${JSON.stringify(lines)}`)), timeoutMs);
        waiters.push({ re, resolve: (l) => { clearTimeout(timer); resolve(l); } });
      });
    },
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tra-server-cli-'));
  bundle = join(dir, 'server.cjs');
  await build({
    entryPoints: [join(ROOT, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundle,
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'silent',
  });
}, 60_000);

afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill('SIGKILL');
});

afterAll(() => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
});

describe('server CLI bundle', () => {
  it('prints TRA_SERVER_READY with the bound port, serves clients and shuts down on SIGTERM', async () => {
    const proc = run(['--port', '0', '--map', 'test_arena', '--name', 'CLI Test', '--bots', 'none']);
    const ready = await proc.waitLine(/^TRA_SERVER_READY port=\d+$/);
    const port = Number(ready.split('=')[1]);
    expect(port).toBeGreaterThan(0);
    expect(proc.lines.filter((l) => l.startsWith('[tra-server]')).length).toBeGreaterThan(0);
    const { client, welcome } = await TestClient.welcome(port, 'Player');
    expect(welcome.room.serverName).toBe('CLI Test');
    expect(welcome.room.settings.mapId).toBe('test_arena');
    proc.child.kill('SIGTERM');
    const kicked = await client.next('kicked');
    expect(kicked.reason).toBe('SERVER_SHUTDOWN');
    await client.closedPromise();
    expect(await proc.exit).toBe(0);
  });

  it('reports PORT_IN_USE and exits with code 2 when the port is taken', async () => {
    const blocker: Server = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
    const port = (blocker.address() as { port: number }).port;
    try {
      const proc = run(['--host', '127.0.0.1', '--port', String(port)]);
      const line = await proc.waitLine(/^TRA_SERVER_ERROR /);
      expect(line).toMatch(/^TRA_SERVER_ERROR code=PORT_IN_USE message=.+/);
      expect(await proc.exit).toBe(2);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it('reads TRA_* environment variables and prints usage for --help / bad flags', async () => {
    const help = run(['--help']);
    await help.waitLine(/Usage: tra-server/);
    expect(await help.exit).toBe(0);

    const bad = run(['--map', 'atlantis']);
    const err = await bad.waitLine(/^TRA_SERVER_ERROR /);
    expect(err).toContain('code=UNKNOWN');
    expect(await bad.exit).toBe(2);

    const env = run([], { TRA_PORT: '0', TRA_MAP: 'test_arena', TRA_DEDICATED: 'true', TRA_LOG_LEVEL: 'silent' });
    const ready = await env.waitLine(/^TRA_SERVER_READY port=\d+$/);
    const port = Number(ready.split('=')[1]);
    const { client, welcome } = await TestClient.welcome(port, 'Env');
    expect(welcome.room.dedicated).toBe(true);
    expect(welcome.room.hostId).toBeNull();
    expect(env.lines.filter((l) => l.startsWith('[tra-server]'))).toHaveLength(0);
    client.terminate();
    env.child.kill('SIGINT');
    expect(await env.exit).toBe(0);
  });
});
