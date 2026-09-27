/**
 * Session: the single object that owns the server connection and routes
 * messages between the network, the zustand store and the game world.
 */
import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  REJECT_MESSAGES,
  type BotDifficultyId,
  type C2S,
  type GameEvent,
  type InputCmd,
  type Loadout,
  type MatchSettings,
  type MatchStartInfo,
  type RejectCode,
  type RoomState,
  type S2C,
  type Snapshot,
  type Team,
  type HostServerOptions,
} from '@tra/shared';
import { Connection, buildWsUrl, parseAddress } from '../net/Connection';
import { getBridge } from '../platform/bridge';
import { useStore, type Screen } from '../state/store';
import { createGameWorld } from '../game';
import type { IGameWorld } from '../game/types';

export interface JoinOptions {
  address: string;
  playerName: string;
  password?: string;
}

export interface HostOptions {
  port: number;
  password?: string;
  serverName?: string;
  playerName: string;
  settings?: Partial<MatchSettings>;
}

export type SessionErrorCode = RejectCode | 'INVALID_ADDRESS' | 'CONNECT_FAILED' | 'TIMEOUT' | 'DISCONNECTED' | 'HOST_FAILED';

export class SessionError extends Error {
  constructor(public code: SessionErrorCode, message?: string) {
    super(message ?? REJECT_MESSAGES[code as RejectCode] ?? code);
    this.name = 'SessionError';
  }
}

export class Session {
  private static _instance: Session | null = null;
  static get instance(): Session {
    return (Session._instance ??= new Session());
  }

  connection: Connection | null = null;
  game: IGameWorld;
  selfId: number | null = null;
  token: string | null = null;
  private hosting = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];
  private welcomeResolver: ((msg: Extract<S2C, { t: 'welcome' }>) => void) | null = null;
  private welcomeRejecter: ((err: SessionError) => void) | null = null;
  private lastPhase: RoomState['phase'] | null = null;
  private loadingMatch = false;

  private constructor() {
    this.game = createGameWorld({
      sendInputs: (cmds) => this.sendInputs(cmds),
      serverNow: () => this.serverNow(),
      rtt: () => this.connection?.rtt ?? 0,
    });
  }

  get connected(): boolean {
    return !!this.connection?.isOpen;
  }

  get isHosting(): boolean {
    return this.hosting;
  }

  serverNow(): number {
    return this.connection ? this.connection.serverNow() : performance.now();
  }

  // ---------------------------------------------------------------------------
  // Host / join / leave
  // ---------------------------------------------------------------------------

  /** Start the embedded server through the desktop bridge and join it. */
  async host(opts: HostOptions): Promise<void> {
    const store = useStore.getState();
    store.setHosting({ starting: true, error: null, log: [] });
    const bridge = getBridge();
    const hostOpts: HostServerOptions = {
      port: opts.port,
      password: opts.password || undefined,
      serverName: opts.serverName || `${opts.playerName}'s match`,
      settings: opts.settings,
    };
    let result;
    try {
      result = await bridge.startServer(hostOpts);
    } catch (e) {
      result = { ok: false, error: 'SPAWN_FAILED', message: e instanceof Error ? e.message : String(e) };
    }
    if (!result.ok) {
      store.setHosting({ starting: false, running: false, error: result.message ?? result.error ?? 'HOST_FAILED' });
      throw new SessionError('HOST_FAILED', result.message ?? result.error ?? 'Could not start the server.');
    }
    this.hosting = true;
    store.setHosting({
      starting: false,
      running: true,
      port: result.port ?? opts.port,
      lanAddresses: result.lanAddresses ?? [],
      error: null,
    });
    this.unsubscribers.push(
      bridge.onServerLog((line) => useStore.getState().setHosting({ log: [...useStore.getState().hosting.log.slice(-99), line] })),
      bridge.onServerExit(() => {
        this.hosting = false;
        useStore.getState().setHosting({ running: false, port: null });
      }),
    );
    try {
      await this.join({ address: `127.0.0.1:${result.port ?? opts.port}`, playerName: opts.playerName, password: opts.password });
    } catch (e) {
      await this.stopHostedServer();
      throw e;
    }
  }

  /** Connect to a server by address and complete the handshake. */
  async join(opts: JoinOptions): Promise<void> {
    const store = useStore.getState();
    if (this.connection) this.teardownConnection();
    const addr = parseAddress(opts.address, DEFAULT_PORT);
    if (!addr) {
      store.setConnection({ status: 'error', error: { code: 'INVALID_ADDRESS', message: 'Enter an address like 192.168.1.20 or 192.168.1.20:27600.' } });
      throw new SessionError('INVALID_ADDRESS', 'Enter an address like 192.168.1.20 or 192.168.1.20:27600.');
    }
    const address = `${addr.host}:${addr.port}`;
    store.setConnection({ status: 'connecting', address, error: null, ping: 0 });
    const conn = new Connection(buildWsUrl(addr));
    this.connection = conn;
    this.lastPhase = null;
    conn.on('message', (msg) => this.handleMessage(msg));
    conn.on('close', (info) => this.handleClose(info.local, info.reason));
    try {
      await conn.connect();
    } catch (e) {
      const code: SessionErrorCode = e instanceof Error && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'CONNECT_FAILED';
      const message = code === 'TIMEOUT'
        ? `No response from ${address}. Check the address, that the server is running, and that port ${addr.port} is open.`
        : `Could not connect to ${address}. Check the address, that the server is running, and that port ${addr.port} is reachable through the firewall.`;
      this.connection = null;
      store.setConnection({ status: 'error', error: { code, message } });
      throw new SessionError(code, message);
    }
    // Handshake
    const welcome = await new Promise<Extract<S2C, { t: 'welcome' }>>((resolve, reject) => {
      this.welcomeResolver = resolve;
      this.welcomeRejecter = reject;
      const timer = setTimeout(() => reject(new SessionError('TIMEOUT', 'The server did not answer the join request.')), 8000);
      const origResolve = resolve;
      this.welcomeResolver = (m) => { clearTimeout(timer); origResolve(m); };
      const origReject = reject;
      this.welcomeRejecter = (e) => { clearTimeout(timer); origReject(e); };
      conn.send({
        t: 'hello',
        name: opts.playerName,
        password: opts.password || undefined,
        version: PROTOCOL_VERSION,
        token: this.token ?? undefined,
        loadout: useStore.getState().loadout,
      });
    }).catch((e: SessionError) => {
      store.setConnection({ status: 'error', error: { code: e.code, message: e.message } });
      this.teardownConnection();
      throw e;
    }).finally(() => {
      this.welcomeResolver = null;
      this.welcomeRejecter = null;
    });

    this.selfId = welcome.playerId;
    this.token = welcome.token;
    store.setSelfId(welcome.playerId);
    store.setConnection({ status: 'connected', error: null });
    store.updateSettings((s) => ({ ...s, lastJoinAddress: opts.address.trim() || s.lastJoinAddress, playerName: opts.playerName }));
    this.startPingPublisher();
    this.applyRoom(welcome.room);
    if (welcome.match) {
      // Join in progress.
      this.beginMatch(welcome.match);
    }
  }

  /** Leave the current server (and stop the hosted server if we started one). */
  async leave(): Promise<void> {
    if (this.connection?.isOpen) {
      this.connection.send({ t: 'leave' });
    }
    this.teardownConnection();
    this.game.unloadMatch();
    const store = useStore.getState();
    store.resetSession();
    store.setConnection({ status: 'idle', error: null, ping: 0 });
    store.setScreen('menu');
    await this.stopHostedServer();
  }

  /**
   * Abort a join that is still connecting or waiting for the handshake (the
   * Join screen's Cancel button). A no-op once connected. The pending join()
   * promise rejects; its caller is expected to treat that rejection as a
   * cancellation rather than an error.
   */
  cancelConnect(): void {
    const store = useStore.getState();
    if (store.connection.status !== 'connecting') return;
    this.welcomeRejecter?.(new SessionError('DISCONNECTED', 'Connection cancelled.'));
    this.teardownConnection();
    store.setConnection({ status: 'idle', error: null, ping: 0 });
  }

  private async stopHostedServer(): Promise<void> {
    if (!this.hosting) return;
    this.hosting = false;
    try { await getBridge().stopServer(); } catch { /* ignore */ }
    useStore.getState().setHosting({ running: false, port: null, starting: false });
  }

  private teardownConnection(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const c = this.connection;
    this.connection = null;
    this.selfId = null;
    c?.close();
  }

  private startPingPublisher(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      const rtt = Math.round(this.connection?.rtt ?? 0);
      useStore.getState().setConnection({ ping: rtt, quality: rtt < 80 ? 'good' : rtt < 160 ? 'ok' : 'bad' });
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // Lobby / match commands
  // ---------------------------------------------------------------------------

  private send(msg: C2S): void {
    this.connection?.send(msg);
  }

  setTeam(team: Team | 'auto'): void { this.send({ t: 'lobby.team', team }); }
  setReady(ready: boolean): void { this.send({ t: 'lobby.ready', ready }); }
  updateSettings(settings: Partial<MatchSettings>): void { this.send({ t: 'lobby.settings', settings }); }
  addBot(team: Team | 'auto', difficulty?: BotDifficultyId): void { this.send({ t: 'lobby.addBot', team, difficulty }); }
  removeBot(playerId: number): void { this.send({ t: 'lobby.removeBot', playerId }); }
  setBotDifficulty(playerId: number, difficulty: BotDifficultyId): void { this.send({ t: 'lobby.botDifficulty', playerId, difficulty }); }
  kick(playerId: number): void { this.send({ t: 'lobby.kick', playerId }); }
  startMatch(): void { this.send({ t: 'lobby.start' }); }
  cancelStart(): void { this.send({ t: 'lobby.cancelStart' }); }
  setLoadout(loadout: Loadout): void {
    useStore.getState().setLoadout(loadout);
    this.send({ t: 'loadout', loadout });
  }
  sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 200);
    if (trimmed) this.send({ t: 'chat', text: trimmed });
  }
  continueToLobby(): void { this.send({ t: 'match.continue' }); }
  notifyLoaded(): void { this.send({ t: 'loaded' }); }
  sendInputs(cmds: InputCmd[]): void {
    if (cmds.length) this.send({ t: 'input', cmds });
  }

  // ---------------------------------------------------------------------------
  // Incoming messages
  // ---------------------------------------------------------------------------

  private handleMessage(msg: S2C): void {
    const store = useStore.getState();
    switch (msg.t) {
      case 'welcome':
        this.welcomeResolver?.(msg);
        break;
      case 'reject':
        this.welcomeRejecter?.(new SessionError(msg.code, msg.message || REJECT_MESSAGES[msg.code]));
        break;
      case 'pong':
        break;
      case 'room':
        this.applyRoom(msg.room);
        break;
      case 'match.start':
        this.beginMatch(msg.match);
        break;
      case 'snapshot':
        this.applySnapshot(msg.snap);
        break;
      case 'scoreboard': {
        store.setScoreboard(msg.board);
        const team = store.hud.selfTeam;
        if (team) {
          const other: Team = team === 'tigris' ? 'euphrates' : 'tigris';
          store.setHud({ teamScore: msg.board.teams[team], enemyScore: msg.board.teams[other], timeLeftSec: msg.board.timeLeftSec, scoreLimit: msg.board.scoreLimit });
        } else {
          store.setHud({ timeLeftSec: msg.board.timeLeftSec, scoreLimit: msg.board.scoreLimit });
        }
        break;
      }
      case 'match.end':
        store.setResults(msg.results);
        store.setScoreboard(msg.results.scoreboard);
        store.setPaused(false);
        store.setScoreboardOpen(false);
        this.game.onMatchEnd(msg.results);
        store.setScreen('results');
        break;
      case 'chat':
        store.pushChat({ from: msg.from, name: msg.name, team: msg.team, text: msg.text });
        break;
      case 'kicked':
        store.setConnection({ status: 'error', error: { code: msg.reason, message: msg.message || REJECT_MESSAGES[msg.reason] } });
        this.teardownConnection();
        this.game.unloadMatch();
        store.resetSession();
        store.setScreen('menu');
        void this.stopHostedServer();
        break;
    }
  }

  private handleClose(local: boolean, reason: string): void {
    if (local) return;
    const store = useStore.getState();
    if (this.welcomeRejecter) {
      this.welcomeRejecter(new SessionError('CONNECT_FAILED', reason || 'The server closed the connection.'));
      return;
    }
    const wasConnected = store.connection.status === 'connected';
    this.teardownConnection();
    this.game.unloadMatch();
    store.resetSession();
    if (wasConnected) {
      store.setConnection({ status: 'disconnected', error: { code: 'DISCONNECTED', message: reason || 'Connection to the server was lost.' } });
    }
    store.setScreen('menu');
    void this.stopHostedServer();
  }

  private applyRoom(room: RoomState): void {
    const store = useStore.getState();
    store.setRoom(room);
    const self = room.players.find((p) => p.id === this.selfId);
    if (self) store.setHud({ selfTeam: self.team });
    const phase = room.phase;
    if (phase !== this.lastPhase) {
      const prev = this.lastPhase;
      this.lastPhase = phase;
      const screen = store.screen;
      if (phase === 'lobby') {
        if (prev !== null || (screen !== 'lobby' && screen !== 'loadout' && screen !== 'settings')) {
          this.game.unloadMatch();
          store.setResults(null);
          store.setMatch(null);
          store.resetMatchState();
          if (isInGameScreen(screen) || prev !== null || screen === 'menu' || screen === 'join' || screen === 'host') store.setScreen('lobby');
        }
      } else if (phase === 'loading') {
        // The server will send match.start immediately after; show loading now.
        if (!isInGameScreen(screen)) store.setScreen('loading');
      } else if (phase === 'results') {
        // match.end carries the data; nothing to do here.
      }
    }
    this.game.onRoom(room);
  }

  private beginMatch(info: MatchStartInfo): void {
    const store = useStore.getState();
    store.setMatch(info);
    store.setResults(null);
    store.resetMatchState();
    store.setLoading(0, 'Preparing match…');
    store.setScreen('loading');
    if (this.loadingMatch) return;
    this.loadingMatch = true;
    const room = store.room!;
    const selfId = this.selfId!;
    this.game
      .loadMatch(info, selfId, room, (p, label) => useStore.getState().setLoading(p, label))
      .then(() => {
        this.loadingMatch = false;
        if (!this.connection?.isOpen) return;
        const s = useStore.getState();
        s.setLoading(1, 'Ready');
        this.notifyLoaded();
        if (s.screen === 'loading') s.setScreen('match');
      })
      .catch((err) => {
        this.loadingMatch = false;
        console.error('Failed to load match', err);
        const s = useStore.getState();
        s.setConnection({ status: 'error', error: { code: 'CONNECT_FAILED', message: `Failed to load the map: ${err instanceof Error ? err.message : String(err)}` } });
        void this.leave();
      });
  }

  private applySnapshot(snap: Snapshot): void {
    const store = useStore.getState();
    this.game.onSnapshot(snap);
    const selfId = this.selfId;
    if (snap.self) {
      const w = snap.self.weapons[snap.self.weaponIndex];
      store.setHud({
        health: Math.max(0, Math.round(snap.self.health)),
        alive: snap.self.alive,
        respawnIn: snap.respawnIn ?? 0,
        ammo: w.ammo,
        reserve: w.reserve,
        weaponIndex: snap.self.weaponIndex,
        weaponId: w.id,
        reloading: w.reload > 0,
      });
    } else if (snap.respawnIn !== undefined) {
      store.setHud({ alive: false, respawnIn: snap.respawnIn });
    }
    if (snap.events.length) this.applyEvents(snap.events, selfId);
  }

  private applyEvents(events: GameEvent[], selfId: number | null): void {
    const store = useStore.getState();
    const room = store.room;
    const nameOf = (id: number) => room?.players.find((p) => p.id === id)?.name ?? `Player ${id}`;
    const teamOf = (id: number): Team => room?.players.find((p) => p.id === id)?.team ?? 'tigris';
    for (const e of events) {
      switch (e.e) {
        case 'kill':
          store.pushKillFeed({ killerId: e.k, killerName: nameOf(e.k), killerTeam: teamOf(e.k), victimId: e.v, victimName: nameOf(e.v), victimTeam: teamOf(e.v), weapon: e.w, headshot: e.hs === 1 });
          if (e.k === selfId && e.v !== selfId) store.setHitmarker(true, e.hs === 1);
          if (e.v === selfId) store.setHud({ killedBy: { id: e.k, name: nameOf(e.k), weapon: e.w } });
          break;
        case 'dmg':
          if (e.from === selfId && e.to !== selfId) store.setHitmarker(false, e.hs === 1);
          if (e.to === selfId) store.pushDamageIndicator(Math.atan2(e.dir[0], e.dir[1]), e.amt);
          break;
        case 'announce':
          store.setAnnouncement(e.k, e.team);
          break;
        case 'spawn':
          if (e.id === selfId) store.setHud({ alive: true, killedBy: null, respawnIn: 0 });
          break;
        default:
          break;
      }
    }
  }
}

function isInGameScreen(screen: Screen): boolean {
  return screen === 'loading' || screen === 'match' || screen === 'results';
}

export const session = Session.instance;
