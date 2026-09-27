/**
 * Shared test utilities: a real WebSocket test client, a server factory with
 * short timers, and a manual-clock harness for stepping a Room without timers.
 */
import { WebSocket } from 'ws';
import {
  DEFAULT_LOADOUT,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  TICK_DT,
  encode,
  type C2S,
  type MatchSettings,
  type S2C,
} from '@tra/shared';
import { GameServer, type ServerOptions } from '../src/Server';
import { Room, type ClientLink, type RoomOptions } from '../src/Room';
import { ManualClock, TICK_MS } from '../src/clock';

export type S2CType = S2C['t'];
export type Msg<T extends S2CType> = Extract<S2C, { t: T }>;

/** Settings used by most tests: the small test arena, no bots unless asked. */
export function testSettings(overrides: Partial<MatchSettings> = {}, bots: Partial<MatchSettings['bots']> = {}): MatchSettings {
  return {
    ...DEFAULT_MATCH_SETTINGS,
    mapId: 'test_arena',
    mapRotation: ['test_arena'],
    ...overrides,
    bots: { ...DEFAULT_MATCH_SETTINGS.bots, mode: 'none', ...bots, ...(overrides.bots ?? {}) },
  };
}

export interface TestServerOptions {
  password?: string;
  dedicated?: boolean;
  settings?: MatchSettings;
  room?: ServerOptions['room'];
  helloTimeoutMs?: number;
  rateLimitPerSec?: number;
}

/** Start a server on an ephemeral port with test-friendly timers. */
export async function startServer(opts: TestServerOptions = {}): Promise<GameServer> {
  const server = new GameServer({
    host: '127.0.0.1',
    port: 0,
    password: opts.password,
    serverName: 'Test Server',
    dedicated: opts.dedicated ?? false,
    settings: opts.settings ?? testSettings(),
    helloTimeoutMs: opts.helloTimeoutMs,
    rateLimitPerSec: opts.rateLimitPerSec,
    rttIntervalMs: 200,
    room: {
      countdownSec: 0.3,
      dedicatedCountdownSec: 0.3,
      dedicatedAutoStartSec: 2,
      resultsSec: 1,
      reconnectGraceMs: 800,
      loadTimeoutTicks: 30,
      seed: 7,
      ...opts.room,
    },
  });
  await server.listen();
  return server;
}

export class TestClient {
  readonly messages: S2C[] = [];
  private waiters: { pred: (m: S2C) => boolean; resolve: (m: S2C) => void }[] = [];
  private cursor = 0;
  closed = false;
  closeCode: number | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as S2C;
      this.messages.push(msg);
      const still: typeof this.waiters = [];
      for (const w of this.waiters) {
        if (w.pred(msg)) w.resolve(msg);
        else still.push(w);
      }
      this.waiters = still;
    });
    ws.on('close', (code) => {
      this.closed = true;
      this.closeCode = code;
    });
    ws.on('error', () => undefined);
  }

  static async open(port: number): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new TestClient(ws);
  }

  /** Connect and send hello; resolves with the welcome or reject message. */
  static async join(port: number, name: string, hello: Partial<Msg<'welcome'>> & Record<string, unknown> = {}): Promise<{ client: TestClient; reply: Msg<'welcome'> | Msg<'reject'> }> {
    const client = await TestClient.open(port);
    client.send({ t: 'hello', name, version: PROTOCOL_VERSION, loadout: DEFAULT_LOADOUT, ...hello } as C2S);
    const reply = (await client.waitFor((m) => m.t === 'welcome' || m.t === 'reject')) as Msg<'welcome'> | Msg<'reject'>;
    return { client, reply };
  }

  static async welcome(port: number, name: string, hello: Record<string, unknown> = {}): Promise<{ client: TestClient; welcome: Msg<'welcome'> }> {
    const { client, reply } = await TestClient.join(port, name, hello);
    if (reply.t !== 'welcome') throw new Error(`expected welcome for ${name}, got ${reply.code}`);
    return { client, welcome: reply };
  }

  send(msg: C2S): void {
    this.ws.send(encode(msg));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  /** Resolve with the first message (not yet consumed by a previous wait) matching `pred`. */
  waitFor(pred: (m: S2C) => boolean, timeoutMs = 8000): Promise<S2C> {
    for (; this.cursor < this.messages.length; this.cursor++) {
      const m = this.messages[this.cursor];
      if (pred(m)) {
        this.cursor++;
        return Promise.resolve(m);
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== done);
        reject(new Error(`timed out waiting for message; last: ${JSON.stringify(this.messages.slice(-3).map((m) => m.t))}`));
      }, timeoutMs);
      const done = (m: S2C): void => {
        clearTimeout(timer);
        this.cursor = this.messages.length;
        resolve(m);
      };
      this.waiters.push({ pred, resolve: done });
    });
  }

  async next<T extends S2CType>(t: T, pred: (m: Msg<T>) => boolean = () => true, timeoutMs?: number): Promise<Msg<T>> {
    return (await this.waitFor((m) => m.t === t && pred(m as Msg<T>), timeoutMs)) as Msg<T>;
  }

  /** The most recently received message of a type, if any. */
  last<T extends S2CType>(t: T): Msg<T> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].t === t) return this.messages[i] as Msg<T>;
    return undefined;
  }

  closedPromise(timeoutMs = 8000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
      this.ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): void {
    this.ws.close();
  }

  /** Drop the TCP connection without a close handshake (simulates a crash). */
  terminate(): void {
    this.ws.terminate();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Socket-less room harness
// ---------------------------------------------------------------------------

export class FakeLink implements ClientLink {
  readonly messages: S2C[] = [];
  closed = false;
  send(msg: S2C): void {
    this.messages.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends S2CType>(t: T): Msg<T> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].t === t) return this.messages[i] as Msg<T>;
    return undefined;
  }
  count(t: S2CType): number {
    return this.messages.filter((m) => m.t === t).length;
  }
}

export interface RoomHarness {
  room: Room;
  clock: ManualClock;
  /** Advance `n` ticks of TICK_MS each. */
  run(n: number): void;
  /** Advance approximately `sec` seconds. */
  runSeconds(sec: number): void;
  join(name: string, extra?: Partial<{ password: string; version: number; token: string }>): { id: number; link: FakeLink; token: string };
}

export function makeRoom(opts: Partial<RoomOptions> = {}): RoomHarness {
  const clock = new ManualClock(1000);
  const room = new Room({
    serverName: 'Harness',
    dedicated: false,
    settings: testSettings(),
    clock,
    seed: 42,
    countdownSec: 1,
    resultsSec: 2,
    loadTimeoutTicks: 6,
    ...opts,
  });
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      clock.advance(TICK_MS);
      room.tick();
    }
  };
  return {
    room,
    clock,
    run,
    runSeconds: (sec) => run(Math.round(sec / TICK_DT)),
    join: (name, extra = {}) => {
      const link = new FakeLink();
      const res = room.join({ name, version: extra.version ?? PROTOCOL_VERSION, password: extra.password, token: extra.token, link });
      if (!res.ok) throw new Error(`join ${name} refused: ${res.code}`);
      return { id: res.playerId, link, token: res.token };
    },
  };
}
