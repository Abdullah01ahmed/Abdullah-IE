/**
 * Wire protocol between client and server. JSON messages, discriminated by `t`.
 * PROTOCOL_VERSION (constants.ts) must be bumped on incompatible change.
 */
import type { BotDifficultyId } from './constants';
import type { InputCmd, PlayerSimState, PlayerSnap, Team, Vec3Tuple } from './types';
import type { WeaponId } from './weapons';

export type Phase = 'lobby' | 'loading' | 'playing' | 'results';

export type GameModeId = 'tdm' | 'dom' | 'hp' | 'kc';

export const GAME_MODE_NAMES: Record<GameModeId, { en: string; ar: string; short: string }> = {
  tdm: { en: 'Team Deathmatch', ar: 'مواجهة الفرق', short: 'TDM' },
  dom: { en: 'Domination', ar: 'السيطرة', short: 'DOM' },
  hp: { en: 'Hardpoint', ar: 'النقطة الحصينة', short: 'HP' },
  kc: { en: 'Kill Confirmed', ar: 'تأكيد القتل', short: 'KC' },
};

/** Modes implemented in this build. */
export const AVAILABLE_MODES: readonly GameModeId[] = ['tdm'];

export type BotFillMode = 'none' | 'fixed' | 'fill';

export interface BotSettings {
  /** none: no bots. fixed: exactly `tigris`/`euphrates` bots. fill: fill both teams to 5. */
  mode: BotFillMode;
  tigris: number;
  euphrates: number;
  difficulty: BotDifficultyId;
  /** When true, a joining human takes over a bot slot when the team is full. */
  replaceWithHumans: boolean;
}

export interface MatchSettings {
  mapId: string;
  mode: GameModeId;
  /** TDM: kills required to win. */
  scoreLimit: number;
  timeLimitSec: number;
  respawnDelaySec: number;
  friendlyFire: boolean;
  bots: BotSettings;
  /** Map ids to cycle through after each match. */
  mapRotation: string[];
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  mapId: 'shanasheel',
  mode: 'tdm',
  scoreLimit: 75,
  timeLimitSec: 600,
  respawnDelaySec: 3,
  friendlyFire: false,
  bots: { mode: 'fill', tigris: 4, euphrates: 5, difficulty: 'normal', replaceWithHumans: true },
  mapRotation: ['shanasheel'],
};

export const SETTINGS_LIMITS = {
  scoreLimit: { min: 5, max: 500 },
  timeLimitSec: { min: 60, max: 3600 },
  respawnDelaySec: { min: 0, max: 15 },
} as const;

export interface Loadout {
  primary: WeaponId;
  secondary: WeaponId;
}

export interface RoomPlayer {
  id: number;
  name: string;
  team: Team;
  ready: boolean;
  /** Round-trip time in ms (0 for bots). */
  ping: number;
  isBot: boolean;
  botDifficulty?: BotDifficultyId;
  loadout: Loadout;
  /** False while a human is in the reconnection grace period. */
  connected: boolean;
  kills: number;
  deaths: number;
  score: number;
}

export interface RoomState {
  serverName: string;
  phase: Phase;
  /** Player id of the lobby host; null on a dedicated server. */
  hostId: number | null;
  dedicated: boolean;
  passwordProtected: boolean;
  settings: MatchSettings;
  players: RoomPlayer[];
  /** Increments every time a match starts. */
  matchNumber: number;
  /** Server-side countdown (s) before a match starts once everyone is ready; null when not counting. */
  countdown: number | null;
}

export interface ScoreEntry {
  id: number;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  isBot: boolean;
}

export interface ScoreboardState {
  teams: Record<Team, number>;
  players: ScoreEntry[];
  timeLeftSec: number;
  scoreLimit: number;
  mode: GameModeId;
}

export interface MatchResults {
  winner: Team | 'draw';
  reason: 'score' | 'time' | 'forfeit';
  scoreboard: ScoreboardState;
  mvpId: number | null;
  nextMapId: string;
  /** Seconds until the room returns to the lobby. */
  returnToLobbySec: number;
}

export type RejectCode =
  | 'SERVER_FULL'
  | 'TEAM_FULL'
  | 'BAD_PASSWORD'
  | 'VERSION_MISMATCH'
  | 'NAME_TAKEN'
  | 'INVALID_NAME'
  | 'KICKED'
  | 'BAD_MESSAGE'
  | 'NOT_HOST'
  | 'RATE_LIMITED'
  | 'SERVER_SHUTDOWN'
  | 'TIMEOUT';

export type AnnouncementKind =
  | 'match_start'
  | 'halfway'
  | 'last_minute'
  | 'ten_seconds'
  | 'lead_taken'
  | 'lead_lost'
  | 'match_end'
  | 'victory'
  | 'defeat'
  | 'draw';

export type GameEvent =
  /** A player fired a shot (for third-person effects; own shots are predicted locally). */
  | { e: 'fire'; id: number; w: WeaponId; o: Vec3Tuple; d: Vec3Tuple; s: number }
  /** A shot struck the world. */
  | { e: 'impact'; p: Vec3Tuple; n: Vec3Tuple; m: string; w: WeaponId }
  /** Damage applied. `dir` is the XZ direction from the victim towards the attacker. */
  | { e: 'dmg'; to: number; from: number; amt: number; hs: 0 | 1; dir: [number, number]; hp: number }
  | { e: 'kill'; k: number; v: number; w: WeaponId | 'fall' | 'world' | 'melee'; hs: 0 | 1 }
  | { e: 'spawn'; id: number; p: Vec3Tuple; team: Team }
  | { e: 'death'; id: number; p: Vec3Tuple }
  | { e: 'reload'; id: number; w: WeaponId }
  | { e: 'switch'; id: number; w: WeaponId }
  | { e: 'announce'; k: AnnouncementKind; team?: Team }
  | { e: 'footstep'; id: number; p: Vec3Tuple; m: string; sprint: 0 | 1 };

export interface Snapshot {
  tick: number;
  /** Server time (ms). */
  st: number;
  /** Last input seq processed for the receiving client. */
  ack: number;
  players: PlayerSnap[];
  /** Authoritative state of the receiving client's own player (undefined for spectating/dead-without-body). */
  self?: PlayerSimState;
  /** Seconds until the receiving client respawns (when dead). */
  respawnIn?: number;
  events: GameEvent[];
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type C2S =
  | { t: 'hello'; name: string; password?: string; version: number; token?: string; loadout?: Loadout }
  | { t: 'ping'; cs: number }
  | { t: 'lobby.team'; team: Team | 'auto' }
  | { t: 'lobby.ready'; ready: boolean }
  | { t: 'lobby.settings'; settings: Partial<MatchSettings> }
  | { t: 'lobby.addBot'; team: Team | 'auto'; difficulty?: BotDifficultyId }
  | { t: 'lobby.removeBot'; playerId: number }
  | { t: 'lobby.botDifficulty'; playerId: number; difficulty: BotDifficultyId }
  | { t: 'lobby.kick'; playerId: number }
  | { t: 'lobby.start' }
  | { t: 'lobby.cancelStart' }
  | { t: 'loadout'; loadout: Loadout }
  | { t: 'loaded' }
  | { t: 'input'; cmds: InputCmd[] }
  | { t: 'chat'; text: string }
  | { t: 'match.continue' }
  | { t: 'leave' };

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type S2C =
  | {
      t: 'welcome';
      playerId: number;
      /** Reconnection token for this player. */
      token: string;
      serverTime: number;
      tickRate: number;
      snapshotRate: number;
      room: RoomState;
      /** Present when joining a match in progress. */
      match?: MatchStartInfo;
    }
  | { t: 'reject'; code: RejectCode; message: string }
  | { t: 'pong'; cs: number; st: number }
  | { t: 'room'; room: RoomState }
  | { t: 'match.start'; match: MatchStartInfo }
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'scoreboard'; board: ScoreboardState }
  | { t: 'match.end'; results: MatchResults }
  | { t: 'chat'; from: number; name: string; team: Team; text: string }
  | { t: 'kicked'; reason: RejectCode; message: string };

export interface MatchStartInfo {
  mapId: string;
  mode: GameModeId;
  settings: MatchSettings;
  /** Seed used for deterministic spread/recoil. */
  seed: number;
  /** Server tick at which the match started. */
  startTick: number;
  /** Server time (ms) at which the match started. */
  startTime: number;
  matchNumber: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function encode(msg: C2S | S2C): string {
  return JSON.stringify(msg);
}

export function decode<T extends C2S | S2C>(data: string | ArrayBuffer | Uint8Array): T | null {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || typeof obj.t !== 'string') return null;
    return obj as T;
  } catch {
    return null;
  }
}

export const REJECT_MESSAGES: Record<RejectCode, string> = {
  SERVER_FULL: 'The server is full (10 players).',
  TEAM_FULL: 'That team is full.',
  BAD_PASSWORD: 'Incorrect room password.',
  VERSION_MISMATCH: 'Your game version does not match the server.',
  NAME_TAKEN: 'That player name is already in use.',
  INVALID_NAME: 'Player name must be 1–20 characters.',
  KICKED: 'You were removed from the match by the host.',
  BAD_MESSAGE: 'The server received an invalid message.',
  NOT_HOST: 'Only the host can do that.',
  RATE_LIMITED: 'Too many messages; slow down.',
  SERVER_SHUTDOWN: 'The server shut down.',
  TIMEOUT: 'Connection timed out.',
};
