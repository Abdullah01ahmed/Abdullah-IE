/**
 * The room: one per server process. Owns the roster (humans and bots), the
 * lobby (host, teams, settings, countdown), the phase machine
 * lobby → loading → playing → results → lobby, and the Match while one runs.
 *
 * The room is transport-agnostic: players are reached through a ClientLink and
 * time comes from an injectable Clock, so the whole thing can be driven by
 * `tick()` in tests without sockets or timers.
 */
import { randomBytes } from 'node:crypto';
import {
  AVAILABLE_MODES,
  BOT_DIFFICULTIES,
  BOT_NAMES,
  DEFAULT_LOADOUT,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  REJECT_MESSAGES,
  SETTINGS_LIMITS,
  SNAPSHOT_RATE,
  TEAMS,
  TEAM_SIZE,
  TICK_DT,
  TICK_RATE,
  clamp,
  getMapOrDefault,
  hashSeed,
  isWeaponId,
  type BotDifficultyId,
  type BotFillMode,
  type C2S,
  type Loadout,
  type MatchResults,
  type MatchSettings,
  type Phase,
  type RejectCode,
  type RoomPlayer,
  type RoomState,
  type S2C,
  type Team,
} from '@tra/shared';
import { Match, type MatchParticipant } from './Match';
import { isAllowedMapId } from './config';
import { realClock, type Clock } from './clock';
import { silentLogger, type Logger } from './log';

/** Transport handle for a connected human. */
export interface ClientLink {
  send(msg: S2C): void;
  /** Close the connection (after any message already handed to `send`). */
  close(): void;
}

export interface RoomOptions {
  serverName: string;
  dedicated: boolean;
  password?: string;
  settings: MatchSettings;
  clock?: Clock;
  log?: Logger;
  /** Seed for match seeds and bot naming; random when omitted. */
  seed?: number;
  reconnectGraceMs?: number;
  /** Host-started countdown length (s). */
  countdownSec?: number;
  /** Dedicated-server countdown length (s). */
  dedicatedCountdownSec?: number;
  /** Dedicated server: start anyway this long after the first human joined (s). */
  dedicatedAutoStartSec?: number;
  /** Time spent on the results screen (s). */
  resultsSec?: number;
  loadTimeoutTicks?: number;
}

export interface JoinRequest {
  name: unknown;
  password?: unknown;
  version: unknown;
  token?: unknown;
  loadout?: unknown;
  link: ClientLink;
}

export type JoinResult =
  | { ok: true; playerId: number; token: string; reconnected: boolean }
  | { ok: false; code: RejectCode; message: string };

interface Player {
  id: number;
  name: string;
  team: Team;
  ready: boolean;
  ping: number;
  isBot: boolean;
  botDifficulty?: BotDifficultyId;
  loadout: Loadout;
  connected: boolean;
  kills: number;
  deaths: number;
  score: number;
  link: ClientLink | null;
  token: string;
  /** Time the link dropped during a match (reconnection grace), else null. */
  disconnectedAt: number | null;
}

const MAX_CHAT_LENGTH = 200;
const MAX_ROTATION = 16;
/** Lobby room broadcasts caused only by ping updates are throttled to this interval. */
const PING_BROADCAST_MS = 2000;

const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g;

/** Trim, strip control/format characters and collapse whitespace; null when the length is out of range. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();
  const len = [...cleaned].length;
  return len < MIN_NAME_LENGTH || len > MAX_NAME_LENGTH ? null : cleaned;
}

export function sanitizeChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return [...cleaned].slice(0, MAX_CHAT_LENGTH).join('');
}

function isTeam(v: unknown): v is Team {
  return v === 'tigris' || v === 'euphrates';
}

function isDifficulty(v: unknown): v is BotDifficultyId {
  return typeof v === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(v);
}

export function sanitizeLoadout(raw: unknown): Loadout {
  if (raw && typeof raw === 'object') {
    const { primary, secondary } = raw as Partial<Loadout>;
    if (isWeaponId(primary) && isWeaponId(secondary)) return { primary, secondary };
  }
  return { ...DEFAULT_LOADOUT };
}

/**
 * Merge a client-supplied partial into the current settings, validating and
 * clamping every field (unknown fields and bad values are ignored).
 */
export function sanitizeSettings(partial: unknown, current: MatchSettings): MatchSettings {
  const next: MatchSettings = { ...current, bots: { ...current.bots }, mapRotation: [...current.mapRotation] };
  if (!partial || typeof partial !== 'object') return next;
  const p = partial as Record<string, unknown>;
  if (isAllowedMapId(p.mapId)) next.mapId = p.mapId;
  if (typeof p.mode === 'string' && (AVAILABLE_MODES as readonly string[]).includes(p.mode)) next.mode = p.mode as MatchSettings['mode'];
  const num = (v: unknown, lim: { min: number; max: number }, cur: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lim.min, lim.max) : cur;
  next.scoreLimit = num(p.scoreLimit, SETTINGS_LIMITS.scoreLimit, next.scoreLimit);
  next.timeLimitSec = num(p.timeLimitSec, SETTINGS_LIMITS.timeLimitSec, next.timeLimitSec);
  next.respawnDelaySec = num(p.respawnDelaySec, SETTINGS_LIMITS.respawnDelaySec, next.respawnDelaySec);
  if (typeof p.friendlyFire === 'boolean') next.friendlyFire = p.friendlyFire;
  if (p.bots && typeof p.bots === 'object') {
    const b = p.bots as Record<string, unknown>;
    if (b.mode === 'none' || b.mode === 'fixed' || b.mode === 'fill') next.bots.mode = b.mode as BotFillMode;
    next.bots.tigris = num(b.tigris, { min: 0, max: TEAM_SIZE }, next.bots.tigris);
    next.bots.euphrates = num(b.euphrates, { min: 0, max: TEAM_SIZE }, next.bots.euphrates);
    if (isDifficulty(b.difficulty)) next.bots.difficulty = b.difficulty;
    if (typeof b.replaceWithHumans === 'boolean') next.bots.replaceWithHumans = b.replaceWithHumans;
  }
  if (Array.isArray(p.mapRotation)) {
    const rot = p.mapRotation.filter(isAllowedMapId).slice(0, MAX_ROTATION);
    if (rot.length > 0) next.mapRotation = rot;
  }
  return next;
}

export class Room {
  readonly serverName: string;
  readonly dedicated: boolean;
  settings: MatchSettings;
  phase: Phase = 'lobby';
  hostId: number | null = null;
  matchNumber = 0;
  match: Match | null = null;
  /** Server tick counter (never resets). */
  tickCount = 0;
  /** Time (ms) of the current tick. */
  time: number;

  private readonly password: string | undefined;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly seed: number;
  private readonly graceMs: number;
  private readonly countdownSec: number;
  private readonly dedicatedCountdownSec: number;
  private readonly dedicatedAutoStartMs: number;
  private readonly resultsMs: number;
  private readonly loadTimeoutTicks: number | undefined;
  private readonly players = new Map<number, Player>();
  private nextId = 1;
  private countdown: number | null = null;
  private dirty = false;
  private pingDirtyAt = -Infinity;
  private lastPingBroadcast = -Infinity;
  private firstHumanAt: number | null = null;
  private resultsUntil = 0;
  private lastResults: MatchResults | null = null;
  private readonly continued = new Set<number>();
  private botNameCursor = 0;

  constructor(opts: RoomOptions) {
    this.serverName = opts.serverName;
    this.dedicated = opts.dedicated;
    this.password = opts.password && opts.password.length > 0 ? opts.password : undefined;
    this.settings = sanitizeSettings(opts.settings, opts.settings);
    this.clock = opts.clock ?? realClock;
    this.log = opts.log ?? silentLogger;
    this.seed = (opts.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this.graceMs = opts.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    this.countdownSec = opts.countdownSec ?? 5;
    this.dedicatedCountdownSec = opts.dedicatedCountdownSec ?? 10;
    this.dedicatedAutoStartMs = (opts.dedicatedAutoStartSec ?? 60) * 1000;
    this.resultsMs = (opts.resultsSec ?? 12) * 1000;
    this.loadTimeoutTicks = opts.loadTimeoutTicks;
    this.time = this.clock.now();
    this.botNameCursor = this.seed % BOT_NAMES.length;
    this.syncBots();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get passwordProtected(): boolean {
    return this.password !== undefined;
  }

  get countdownSeconds(): number | null {
    return this.countdown === null ? null : Math.ceil(this.countdown - 1e-9);
  }

  get playerCount(): number {
    return this.players.size;
  }

  listPlayers(): RoomPlayer[] {
    return this.toState().players;
  }

  teamCount(team: Team): number {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team) n++;
    return n;
  }

  private humansOn(team: Team): number {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team && !p.isBot) n++;
    return n;
  }

  private botsOn(team: Team): Player[] {
    return [...this.players.values()].filter((p) => p.team === team && p.isBot);
  }

  private humans(): Player[] {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  private connectedHumans(): Player[] {
    return [...this.players.values()].filter((p) => !p.isBot && p.connected);
  }

  private get inMatch(): boolean {
    return this.phase === 'loading' || this.phase === 'playing';
  }

  toState(): RoomState {
    const players: RoomPlayer[] = [];
    for (const p of [...this.players.values()].sort((a, b) => a.id - b.id)) {
      const mp = this.match?.getPlayer(p.id);
      players.push({
        id: p.id,
        name: p.name,
        team: p.team,
        ready: p.isBot ? true : p.ready,
        ping: p.ping,
        isBot: p.isBot,
        botDifficulty: p.isBot ? (p.botDifficulty ?? this.settings.bots.difficulty) : undefined,
        loadout: { ...p.loadout },
        connected: p.connected,
        kills: mp ? mp.kills : p.kills,
        deaths: mp ? mp.deaths : p.deaths,
        score: mp ? mp.score : p.score,
      });
    }
    return {
      serverName: this.serverName,
      phase: this.phase,
      hostId: this.hostId,
      dedicated: this.dedicated,
      passwordProtected: this.passwordProtected,
      settings: this.settings,
      players,
      matchNumber: this.matchNumber,
      countdown: this.countdownSeconds,
    };
  }

  // ---------------------------------------------------------------------------
  // Joining, leaving, reconnecting
  // ---------------------------------------------------------------------------

  join(req: JoinRequest): JoinResult {
    if (req.version !== PROTOCOL_VERSION) return reject('VERSION_MISMATCH');
    if (this.password !== undefined && req.password !== this.password) return reject('BAD_PASSWORD');
    const name = sanitizeName(req.name);
    if (!name) return reject('INVALID_NAME');
    const lower = name.toLowerCase();

    // Reconnection: a human whose link dropped mid-match keeps their slot for a grace period.
    const token = typeof req.token === 'string' ? req.token : null;
    const ghost = [...this.players.values()].find(
      (p) => !p.isBot && !p.connected && ((token !== null && p.token === token) || p.name.toLowerCase() === lower),
    );
    if (ghost && this.inMatch) {
      ghost.link = req.link;
      ghost.connected = true;
      ghost.disconnectedAt = null;
      ghost.name = name;
      this.match?.setConnected(ghost.id, true);
      this.markDirty();
      this.log.info(`${name} reconnected as #${ghost.id}`);
      this.sendWelcome(ghost);
      return { ok: true, playerId: ghost.id, token: ghost.token, reconnected: true };
    }

    if ([...this.players.values()].some((p) => !p.isBot && p.name.toLowerCase() === lower)) return reject('NAME_TAKEN');

    const team = this.pickAutoTeam(null);
    if (!team || !this.makeRoomOn(team)) return reject('SERVER_FULL');

    // A bot may carry the name the human asked for; the human wins.
    for (const p of this.players.values()) if (p.isBot && p.name.toLowerCase() === lower) p.name = this.pickBotName(lower);

    const player: Player = {
      id: this.nextId++,
      name,
      team,
      ready: false,
      ping: 0,
      isBot: false,
      loadout: sanitizeLoadout(req.loadout),
      connected: true,
      kills: 0,
      deaths: 0,
      score: 0,
      link: req.link,
      token: randomBytes(12).toString('hex'),
      disconnectedAt: null,
    };
    this.players.set(player.id, player);
    if (!this.dedicated && this.hostId === null) this.hostId = player.id;
    if (this.firstHumanAt === null) this.firstHumanAt = this.time;
    if (this.inMatch) this.match?.addPlayer(this.participant(player));
    this.syncBots();
    this.markDirty();
    this.log.info(`${name} joined as #${player.id} (${team})`);
    this.sendWelcome(player);
    return { ok: true, playerId: player.id, token: player.token, reconnected: false };
  }

  private sendWelcome(p: Player): void {
    p.link?.send({
      t: 'welcome',
      playerId: p.id,
      token: p.token,
      serverTime: this.time,
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      room: this.toState(),
      match: this.match && this.inMatch ? this.match.startInfo() : undefined,
    });
  }

  private participant(p: Player): MatchParticipant {
    return { id: p.id, name: p.name, team: p.team, isBot: p.isBot, botDifficulty: p.botDifficulty, loadout: p.loadout, connected: p.connected };
  }

  /** The player's transport dropped. Mid-match humans get a reconnection grace period. */
  disconnect(playerId: number): void {
    const p = this.players.get(playerId);
    if (!p || p.isBot) return;
    if (this.inMatch && this.graceMs > 0) {
      if (!p.connected) return;
      p.connected = false;
      p.link = null;
      p.disconnectedAt = this.time;
      p.ready = false;
      this.match?.setConnected(p.id, false);
      this.markDirty();
      this.log.info(`${p.name} (#${p.id}) lost connection; holding slot for ${Math.round(this.graceMs / 1000)} s`);
      this.endIfDeserted();
      return;
    }
    this.removePlayer(playerId);
  }

  /** Remove a player outright (leave, kick, grace expiry). */
  removePlayer(playerId: number): void {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    this.continued.delete(playerId);
    this.match?.removePlayer(playerId);
    if (this.hostId === playerId) {
      const next = this.connectedHumans().sort((a, b) => a.id - b.id)[0];
      this.hostId = next ? next.id : null;
    }
    if (this.humans().length === 0) this.firstHumanAt = null;
    this.log.info(`${p.isBot ? 'bot ' : ''}${p.name} (#${p.id}) removed`);
    this.syncBots();
    this.markDirty();
    this.endIfDeserted();
  }

  /** Disconnect everyone (server shutdown). */
  shutdown(): void {
    for (const p of this.players.values()) {
      if (p.link) {
        p.link.send({ t: 'kicked', reason: 'SERVER_SHUTDOWN', message: REJECT_MESSAGES.SERVER_SHUTDOWN });
        p.link.close();
        p.link = null;
      }
    }
  }

  setPing(playerId: number, ping: number): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.ping = Math.max(0, Math.round(ping));
    this.match?.setPing(playerId, p.ping);
    if (this.pingDirtyAt === -Infinity) this.pingDirtyAt = this.time;
  }

  // ---------------------------------------------------------------------------
  // Team placement
  // ---------------------------------------------------------------------------

  /**
   * Team a joining/switching human should get: the team with fewer members,
   * where bots count only when they cannot be replaced. Null when both are full.
   */
  private pickAutoTeam(exclude: Player | null): Team | null {
    const size = (team: Team): number => {
      let n = 0;
      for (const p of this.players.values()) {
        if (p === exclude || p.team !== team) continue;
        if (!p.isBot || !this.settings.bots.replaceWithHumans) n++;
      }
      return n;
    };
    const t = size('tigris');
    const e = size('euphrates');
    if (t >= TEAM_SIZE && e >= TEAM_SIZE) return null;
    if (t <= e) return t < TEAM_SIZE ? 'tigris' : 'euphrates';
    return e < TEAM_SIZE ? 'euphrates' : 'tigris';
  }

  /** Ensure a free slot on `team`, taking over a bot's slot when allowed. */
  private makeRoomOn(team: Team): boolean {
    if (this.teamCount(team) < TEAM_SIZE) return true;
    if (!this.settings.bots.replaceWithHumans) return false;
    const bots = this.botsOn(team);
    if (bots.length === 0) return false;
    this.deleteBot(bots[bots.length - 1]);
    return true;
  }

  private setTeam(p: Player, want: Team | 'auto'): void {
    const team = want === 'auto' ? this.pickAutoTeam(p) : want;
    if (!team || team === p.team) return;
    if (!this.makeRoomOn(team)) return;
    p.team = team;
    this.syncBots();
    this.markDirty();
  }

  // ---------------------------------------------------------------------------
  // Bots
  // ---------------------------------------------------------------------------

  /** Bring the bot roster in line with settings.bots (never exceeding TEAM_SIZE per team). */
  private syncBots(): void {
    const b = this.settings.bots;
    for (const team of TEAMS) {
      const humans = this.humansOn(team);
      let target = 0;
      if (b.mode === 'fixed') target = Math.min(b[team], TEAM_SIZE - humans);
      else if (b.mode === 'fill') target = TEAM_SIZE - humans;
      target = Math.max(0, target);
      const bots = this.botsOn(team);
      for (let i = bots.length - 1; i >= target; i--) this.deleteBot(bots[i]);
      for (let i = bots.length; i < target; i++) this.createBot(team, undefined);
    }
  }

  private createBot(team: Team, difficulty: BotDifficultyId | undefined): Player {
    const bot: Player = {
      id: this.nextId++,
      name: this.pickBotName(null),
      team,
      ready: true,
      ping: 0,
      isBot: true,
      botDifficulty: difficulty,
      loadout: { ...DEFAULT_LOADOUT },
      connected: true,
      kills: 0,
      deaths: 0,
      score: 0,
      link: null,
      token: '',
      disconnectedAt: null,
    };
    this.players.set(bot.id, bot);
    if (this.inMatch) this.match?.addPlayer(this.participant(bot));
    this.markDirty();
    return bot;
  }

  private deleteBot(bot: Player): void {
    this.players.delete(bot.id);
    this.match?.removePlayer(bot.id);
    this.markDirty();
  }

  private pickBotName(alsoAvoid: string | null): string {
    const used = new Set<string>();
    for (const p of this.players.values()) used.add(p.name.toLowerCase());
    if (alsoAvoid) used.add(alsoAvoid);
    for (let i = 0; i < BOT_NAMES.length; i++) {
      const name = BOT_NAMES[(this.botNameCursor + i) % BOT_NAMES.length];
      if (!used.has(name.toLowerCase())) {
        this.botNameCursor = (this.botNameCursor + i + 1) % BOT_NAMES.length;
        return name;
      }
    }
    let n = 2;
    while (used.has(`bot ${n}`)) n++;
    return `Bot ${n}`;
  }

  private addBot(team: Team | 'auto', difficulty: BotDifficultyId | undefined): void {
    const b = this.settings.bots;
    if (b.mode === 'fill') return; // both teams are already full by definition
    let target: Team | null;
    if (team === 'auto') {
      const t = this.teamCount('tigris');
      const e = this.teamCount('euphrates');
      target = t <= e ? (t < TEAM_SIZE ? 'tigris' : null) : e < TEAM_SIZE ? 'euphrates' : null;
    } else {
      target = this.teamCount(team) < TEAM_SIZE ? team : null;
    }
    if (!target) return;
    if (b.mode === 'none') {
      b.mode = 'fixed';
      b.tigris = this.botsOn('tigris').length;
      b.euphrates = this.botsOn('euphrates').length;
    }
    b[target] = Math.min(TEAM_SIZE, this.botsOn(target).length + 1);
    this.createBot(target, difficulty);
    this.syncBots();
  }

  private removeBot(bot: Player): void {
    const b = this.settings.bots;
    if (b.mode === 'fill') {
      b.mode = 'fixed';
      b.tigris = this.botsOn('tigris').length;
      b.euphrates = this.botsOn('euphrates').length;
    }
    b[bot.team] = Math.max(0, this.botsOn(bot.team).length - 1);
    this.deleteBot(bot);
    this.syncBots();
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  handleMessage(playerId: number, msg: C2S): void {
    const p = this.players.get(playerId);
    if (!p || p.isBot || !p.connected) return;
    const host = this.hostId === playerId;
    const lobby = this.phase === 'lobby';
    switch (msg.t) {
      case 'lobby.team':
        if (lobby && (isTeam(msg.team) || msg.team === 'auto')) this.setTeam(p, msg.team);
        break;
      case 'lobby.ready':
        if (lobby && typeof msg.ready === 'boolean' && p.ready !== msg.ready) {
          p.ready = msg.ready;
          this.markDirty();
        }
        break;
      case 'lobby.settings':
        if (host && lobby) {
          this.settings = sanitizeSettings(msg.settings, this.settings);
          this.syncBots();
          this.markDirty();
        }
        break;
      case 'lobby.addBot':
        if (host && lobby && (isTeam(msg.team) || msg.team === 'auto')) this.addBot(msg.team, isDifficulty(msg.difficulty) ? msg.difficulty : undefined);
        break;
      case 'lobby.removeBot': {
        const bot = this.players.get(Number(msg.playerId));
        if (host && lobby && bot?.isBot) this.removeBot(bot);
        break;
      }
      case 'lobby.botDifficulty': {
        const bot = this.players.get(Number(msg.playerId));
        if (host && bot?.isBot && isDifficulty(msg.difficulty)) {
          bot.botDifficulty = msg.difficulty;
          this.match?.setBotDifficulty(bot.id, msg.difficulty);
          this.markDirty();
        }
        break;
      }
      case 'lobby.kick': {
        const target = this.players.get(Number(msg.playerId));
        if (!host || !target || target.id === playerId) break;
        if (target.isBot) {
          if (lobby) this.removeBot(target);
        } else {
          target.link?.send({ t: 'kicked', reason: 'KICKED', message: REJECT_MESSAGES.KICKED });
          target.link?.close();
          target.link = null;
          this.removePlayer(target.id);
        }
        break;
      }
      case 'lobby.start':
        if (host && lobby && this.countdown === null) {
          this.countdown = this.countdownSec;
          this.markDirty();
        }
        break;
      case 'lobby.cancelStart':
        if (host && lobby && this.countdown !== null) {
          this.countdown = null;
          this.markDirty();
        }
        break;
      case 'loadout':
        p.loadout = sanitizeLoadout(msg.loadout);
        this.match?.setLoadout(p.id, p.loadout);
        this.markDirty();
        break;
      case 'loaded':
        this.match?.markLoaded(p.id);
        break;
      case 'input':
        this.match?.queueInputs(p.id, msg.cmds);
        break;
      case 'chat': {
        const text = sanitizeChat(msg.text);
        if (text) this.broadcast({ t: 'chat', from: p.id, name: p.name, team: p.team, text });
        break;
      }
      case 'match.continue':
        if (this.phase === 'results') this.continued.add(p.id);
        break;
      case 'leave':
        p.link?.close();
        p.link = null;
        this.removePlayer(p.id);
        break;
      default:
        // 'hello' and 'ping' are handled by the transport layer; anything else is ignored.
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Tick / phases
  // ---------------------------------------------------------------------------

  /** Advance the room by one 60 Hz tick. */
  tick(): void {
    this.tickCount++;
    this.time = this.clock.now();
    switch (this.phase) {
      case 'lobby':
        this.tickLobby();
        break;
      case 'loading':
      case 'playing':
        this.match?.step(this.time);
        this.expireGrace();
        break;
      case 'results':
        if (this.time >= this.resultsUntil || this.everyHumanContinued()) this.returnToLobby();
        break;
    }
    this.flush();
  }

  private tickLobby(): void {
    const humans = this.connectedHumans();
    if (humans.length === 0) {
      // Nobody left to play: never start a bots-only match.
      if (this.countdown !== null) { this.countdown = null; this.markDirty(); }
      this.firstHumanAt = null;
    } else if (this.dedicated) {
      if (this.firstHumanAt === null) this.firstHumanAt = this.time;
      const allReady = humans.every((h) => h.ready);
      const waited = this.time - this.firstHumanAt >= this.dedicatedAutoStartMs;
      if (this.countdown === null && (allReady || waited)) {
        this.countdown = this.dedicatedCountdownSec;
        this.markDirty();
      }
    }
    if (this.countdown !== null) {
      const before = this.countdownSeconds;
      this.countdown -= TICK_DT;
      if (this.countdown <= 1e-9) this.startMatch();
      else if (this.countdownSeconds !== before) this.markDirty();
    }
  }

  private startMatch(): void {
    this.countdown = null;
    this.matchNumber++;
    this.phase = 'loading';
    this.continued.clear();
    const settings = sanitizeSettings(this.settings, this.settings);
    const map = getMapOrDefault(settings.mapId);
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; p.score = 0; }
    const match = new Match(
      {
        map,
        settings,
        seed: hashSeed(this.seed, this.matchNumber),
        startTick: this.tickCount,
        startTime: this.time,
        matchNumber: this.matchNumber,
        log: this.log,
        loadTimeoutTicks: this.loadTimeoutTicks,
      },
      {
        send: (id, msg) => this.players.get(id)?.link?.send(msg),
        onLive: () => {
          if (this.match === match) { this.phase = 'playing'; this.markDirty(); }
        },
        onEnd: (results) => {
          if (this.match !== match) return;
          this.phase = 'results';
          this.lastResults = results;
          this.resultsUntil = this.time + this.resultsMs;
          for (const p of this.players.values()) {
            const mp = match.getPlayer(p.id);
            if (mp) { p.kills = mp.kills; p.deaths = mp.deaths; p.score = mp.score; }
          }
          this.markDirty();
        },
      },
    );
    for (const p of [...this.players.values()].sort((a, b) => a.id - b.id)) match.addPlayer(this.participant(p));
    this.match = match;
    this.log.info(`match ${this.matchNumber} starting on ${map.id} with ${this.players.size} participants`);
    this.broadcast({ t: 'match.start', match: match.startInfo() });
    this.markDirty();
  }

  private returnToLobby(): void {
    this.phase = 'lobby';
    this.match = null;
    this.countdown = null;
    this.continued.clear();
    if (this.lastResults && isAllowedMapId(this.lastResults.nextMapId)) this.settings.mapId = this.lastResults.nextMapId;
    // Players still in their reconnection grace cannot rejoin a lobby.
    for (const p of [...this.players.values()]) if (!p.isBot && !p.connected) this.removePlayer(p.id);
    for (const p of this.players.values()) p.ready = false;
    this.firstHumanAt = this.humans().length > 0 ? this.time : null;
    this.syncBots();
    this.markDirty();
  }

  private expireGrace(): void {
    for (const p of [...this.players.values()]) {
      if (p.isBot || p.connected || p.disconnectedAt === null) continue;
      if (this.time - p.disconnectedAt >= this.graceMs) {
        this.log.info(`${p.name} (#${p.id}) did not reconnect in time`);
        this.removePlayer(p.id);
      }
    }
  }

  private everyHumanContinued(): boolean {
    const humans = this.connectedHumans();
    return humans.length > 0 && humans.every((h) => this.continued.has(h.id));
  }

  /** A match with no humans left (connected or in grace) is forfeited. */
  private endIfDeserted(): void {
    if (!this.inMatch || !this.match || this.humans().length > 0) return;
    const tig = this.match.teamKills('tigris');
    const eup = this.match.teamKills('euphrates');
    this.match.end(tig === eup ? 'draw' : tig > eup ? 'tigris' : 'euphrates', 'forfeit');
  }

  // ---------------------------------------------------------------------------
  // Broadcasting
  // ---------------------------------------------------------------------------

  private markDirty(): void {
    this.dirty = true;
  }

  private broadcast(msg: S2C): void {
    for (const p of this.players.values()) if (p.link && p.connected) p.link.send(msg);
  }

  /** Send at most one 'room' per tick, coalescing every change made since the last one. */
  private flush(): void {
    const pingOnly = !this.dirty && this.pingDirtyAt !== -Infinity && this.phase === 'lobby' && this.time - this.lastPingBroadcast >= PING_BROADCAST_MS;
    if (!this.dirty && !pingOnly) return;
    this.dirty = false;
    this.pingDirtyAt = -Infinity;
    this.lastPingBroadcast = this.time;
    this.broadcast({ t: 'room', room: this.toState() });
  }
}

function reject(code: RejectCode): JoinResult {
  return { ok: false, code, message: REJECT_MESSAGES[code] };
}

