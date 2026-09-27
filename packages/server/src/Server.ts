/**
 * WebSocket transport: an http server hosting a ws.WebSocketServer, one Room,
 * and the 60 Hz loop that ticks it. Handles the per-connection state machine
 * (hello handshake, rate limiting, ping/pong, RTT measurement) and hands
 * everything game-related to the Room.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GAME_NAME,
  GAME_VERSION,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  REJECT_MESSAGES,
  decode,
  encode,
  type C2S,
  type MatchSettings,
  type RejectCode,
  type S2C,
} from '@tra/shared';
import { Room, type ClientLink, type RoomOptions } from './Room';
import { TickLoop, realClock, type Clock } from './clock';
import { silentLogger, type Logger } from './log';

export interface ServerOptions {
  host?: string;
  /** 0 picks an ephemeral port. */
  port: number;
  password?: string;
  serverName: string;
  dedicated: boolean;
  settings: MatchSettings;
  log?: Logger;
  clock?: Clock;
  /** Passed through to the Room (tests shorten timers here). */
  room?: Partial<Omit<RoomOptions, 'serverName' | 'dedicated' | 'password' | 'settings' | 'clock' | 'log'>>;
  /** Milliseconds a connection may stay silent before it must have sent 'hello'. */
  helloTimeoutMs?: number;
  /** Messages per second above which a client is kicked. */
  rateLimitPerSec?: number;
  /** Interval of the RTT probe (ws ping frames). */
  rttIntervalMs?: number;
}

export type ServerErrorCode = 'PORT_IN_USE' | 'EADDRNOTAVAIL' | 'UNKNOWN';

export class ServerStartError extends Error {
  constructor(readonly code: ServerErrorCode, message: string) {
    super(message);
  }
}

export const MAX_PAYLOAD_BYTES = 32 * 1024;
const DEFAULT_HELLO_TIMEOUT_MS = 5000;
const DEFAULT_RATE_LIMIT = 240;
const DEFAULT_RTT_INTERVAL_MS = 2000;
/** Malformed messages tolerated before the connection is dropped. */
const MAX_BAD_MESSAGES = 20;

interface Conn {
  ws: WebSocket;
  playerId: number | null;
  helloTimer: NodeJS.Timeout | null;
  windowStart: number;
  windowCount: number;
  badMessages: number;
  rttTimer: NodeJS.Timeout | null;
  closed: boolean;
}

export class GameServer {
  readonly room: Room;
  private readonly http: HttpServer;
  private readonly wss: WebSocketServer;
  private readonly loop: TickLoop;
  private readonly log: Logger;
  private readonly clock: Clock;
  private readonly conns = new Set<Conn>();
  private readonly helloTimeoutMs: number;
  private readonly rateLimit: number;
  private readonly rttIntervalMs: number;
  private listening = false;

  constructor(private readonly opts: ServerOptions) {
    this.log = opts.log ?? silentLogger;
    this.clock = opts.clock ?? realClock;
    this.helloTimeoutMs = opts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
    this.rateLimit = opts.rateLimitPerSec ?? DEFAULT_RATE_LIMIT;
    this.rttIntervalMs = opts.rttIntervalMs ?? DEFAULT_RTT_INTERVAL_MS;
    this.room = new Room({
      ...opts.room,
      serverName: opts.serverName,
      dedicated: opts.dedicated,
      password: opts.password,
      settings: opts.settings,
      clock: this.clock,
      log: this.log,
    });
    this.http = createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.http, maxPayload: MAX_PAYLOAD_BYTES });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.loop = new TickLoop(() => this.room.tick(), this.clock);
  }

  /** Bound port (0 until listening). */
  get port(): number {
    const addr = this.http.address() as AddressInfo | null;
    return addr ? addr.port : 0;
  }

  listen(): Promise<number> {
    return new Promise((resolve, rejectPromise) => {
      let settled = false;
      // ws re-emits the http server's errors on the WebSocketServer, so both
      // emitters need a listener or Node treats the error as unhandled.
      const onError = (err: NodeJS.ErrnoException): void => {
        if (settled) {
          this.log.error(`server error: ${err.message}`);
          return;
        }
        settled = true;
        const code: ServerErrorCode = err.code === 'EADDRINUSE' ? 'PORT_IN_USE' : err.code === 'EADDRNOTAVAIL' ? 'EADDRNOTAVAIL' : 'UNKNOWN';
        rejectPromise(new ServerStartError(code, err.message));
      };
      this.http.on('error', onError);
      this.wss.on('error', onError);
      this.http.once('listening', () => {
        if (settled) return;
        settled = true;
        this.listening = true;
        this.loop.start();
        this.log.info(`listening on ${this.opts.host ?? '0.0.0.0'}:${this.port}`);
        resolve(this.port);
      });
      this.http.listen(this.opts.port, this.opts.host ?? '0.0.0.0');
    });
  }

  /** Notify clients, close every connection and stop listening. */
  async close(): Promise<void> {
    this.loop.stop();
    this.room.shutdown();
    for (const c of this.conns) {
      this.dropConn(c);
      // A peer that never answers the close handshake must not hold the process open.
      setTimeout(() => c.ws.terminate(), 1000).unref();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    if (this.listening) {
      this.listening = false;
      await new Promise<void>((resolve) => this.http.close(() => resolve()));
    }
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/status')) {
      const room = this.room.toState();
      const body = JSON.stringify({
        game: GAME_NAME,
        version: GAME_VERSION,
        protocol: PROTOCOL_VERSION,
        serverName: room.serverName,
        phase: room.phase,
        players: room.players.length,
        maxPlayers: MAX_PLAYERS,
        passwordProtected: room.passwordProtected,
        mapId: room.settings.mapId,
        mode: room.settings.mode,
      });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  }

  // ---------------------------------------------------------------------------
  // Connections
  // ---------------------------------------------------------------------------

  private onConnection(ws: WebSocket): void {
    const conn: Conn = {
      ws,
      playerId: null,
      helloTimer: null,
      windowStart: this.clock.now(),
      windowCount: 0,
      badMessages: 0,
      rttTimer: null,
      closed: false,
    };
    this.conns.add(conn);
    conn.helloTimer = setTimeout(() => {
      if (conn.playerId === null) this.refuse(conn, 'TIMEOUT');
    }, this.helloTimeoutMs);
    ws.on('message', (data, isBinary) => this.onMessage(conn, isBinary ? null : data.toString()));
    ws.on('pong', (payload) => this.onPong(conn, payload));
    ws.on('close', () => this.onClose(conn));
    ws.on('error', (err) => {
      this.log.debug(`socket error: ${err.message}`);
      this.onClose(conn);
    });
  }

  private onMessage(conn: Conn, text: string | null): void {
    if (conn.closed) return;
    if (!this.withinRateLimit(conn)) {
      this.kick(conn, 'RATE_LIMITED');
      return;
    }
    const msg = text === null ? null : decode<C2S>(text);
    if (!msg) {
      if (++conn.badMessages > MAX_BAD_MESSAGES) this.kick(conn, 'BAD_MESSAGE');
      return;
    }
    if (msg.t === 'ping') {
      this.send(conn, { t: 'pong', cs: typeof msg.cs === 'number' ? msg.cs : 0, st: this.clock.now() });
      return;
    }
    if (conn.playerId === null) {
      if (msg.t !== 'hello') return; // nothing else is meaningful before the handshake
      this.handleHello(conn, msg);
      return;
    }
    if (msg.t === 'hello') return; // already joined
    this.room.handleMessage(conn.playerId, msg);
    if (msg.t === 'leave') this.dropConn(conn);
  }

  private withinRateLimit(conn: Conn): boolean {
    const now = this.clock.now();
    if (now - conn.windowStart >= 1000) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    conn.windowCount++;
    return conn.windowCount <= this.rateLimit;
  }

  private handleHello(conn: Conn, msg: Extract<C2S, { t: 'hello' }>): void {
    const link: ClientLink = {
      send: (m) => this.send(conn, m),
      close: () => this.dropConn(conn),
    };
    const result = this.room.join({
      name: msg.name,
      password: msg.password,
      version: msg.version,
      token: msg.token,
      loadout: msg.loadout,
      link,
    });
    if (!result.ok) {
      this.log.info(`join refused (${result.code}) for ${JSON.stringify(msg.name)}`);
      this.send(conn, { t: 'reject', code: result.code, message: result.message });
      this.dropConn(conn);
      return;
    }
    conn.playerId = result.playerId;
    if (conn.helloTimer) {
      clearTimeout(conn.helloTimer);
      conn.helloTimer = null;
    }
    conn.rttTimer = setInterval(() => this.probeRtt(conn), this.rttIntervalMs);
  }

  private probeRtt(conn: Conn): void {
    if (conn.closed || conn.ws.readyState !== WebSocket.OPEN) return;
    conn.ws.ping(Buffer.from(String(this.clock.now())));
  }

  private onPong(conn: Conn, payload: Buffer): void {
    if (conn.playerId === null) return;
    const sent = Number(payload.toString());
    if (!Number.isFinite(sent)) return;
    this.room.setPing(conn.playerId, this.clock.now() - sent);
  }

  private onClose(conn: Conn): void {
    if (conn.closed) return;
    conn.closed = true;
    this.conns.delete(conn);
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    if (conn.rttTimer) clearInterval(conn.rttTimer);
    if (conn.playerId !== null) {
      const id = conn.playerId;
      conn.playerId = null;
      this.room.disconnect(id);
    }
  }

  private refuse(conn: Conn, code: RejectCode): void {
    this.send(conn, { t: 'reject', code, message: REJECT_MESSAGES[code] });
    this.dropConn(conn);
  }

  private kick(conn: Conn, code: RejectCode): void {
    this.log.warn(`kicking connection${conn.playerId !== null ? ` #${conn.playerId}` : ''}: ${code}`);
    if (conn.playerId !== null) {
      this.send(conn, { t: 'kicked', reason: code, message: REJECT_MESSAGES[code] });
      const id = conn.playerId;
      conn.playerId = null;
      this.room.removePlayer(id);
    } else {
      this.send(conn, { t: 'reject', code, message: REJECT_MESSAGES[code] });
    }
    this.dropConn(conn);
  }

  private send(conn: Conn, msg: S2C): void {
    if (conn.closed || conn.ws.readyState !== WebSocket.OPEN) return;
    conn.ws.send(encode(msg));
  }

  /** Close the socket; the 'close' event finishes the bookkeeping. */
  private dropConn(conn: Conn): void {
    if (conn.closed) return;
    const ws = conn.ws;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000);
    else ws.terminate();
  }
}
