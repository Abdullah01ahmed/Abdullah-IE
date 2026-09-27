/**
 * Tunables shared by client and server. Anything gameplay-affecting lives here
 * (or in weapons.ts / maps) so both ends agree by construction.
 */

export const GAME_NAME = 'Twin Rivers: Arena';
export const GAME_VERSION = '0.1.0';

/** Bumped whenever the wire protocol changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Default TCP port for hosting (WebSocket). */
export const DEFAULT_PORT = 27600;

/** Simulation tick rate (Hz) and fixed delta (s). */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/** Snapshot broadcast rate (Hz). */
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_INTERVAL_TICKS = TICK_RATE / SNAPSHOT_RATE;

/** Scoreboard broadcast interval (ticks). */
export const SCOREBOARD_INTERVAL_TICKS = TICK_RATE; // 1 Hz

/** Remote players are rendered this far in the past (ms). */
export const INTERP_DELAY_MS = 100;

/** Maximum rewind the server will apply for lag-compensated shots (ms). */
export const MAX_LAG_COMP_MS = 200;

/** Length of the server-side pose history used for lag compensation (ms). */
export const LAG_COMP_HISTORY_MS = 1000;

/** Server processes at most this many queued inputs per player per tick (catch-up burst). */
export const MAX_INPUTS_PER_TICK = 3;
/** Inputs queued beyond this are dropped (client is too far ahead). */
export const MAX_INPUT_QUEUE = 40;
/** If a client sends no input for this many ticks the last one is repeated with no buttons. */
export const INPUT_HOLD_TICKS = 6;

/** Team structure. */
export const TEAM_SIZE = 5;
export const MAX_PLAYERS = TEAM_SIZE * 2;

/** Names. */
export const MAX_NAME_LENGTH = 20;
export const MIN_NAME_LENGTH = 1;

/** Health. */
export const MAX_HEALTH = 100;
export const HEALTH_REGEN_DELAY = 4.0; // s without damage before regen
export const HEALTH_REGEN_RATE = 35; // hp/s

/** Client → server ping interval (ms). */
export const PING_INTERVAL_MS = 1000;

/** How long a disconnected human keeps their slot during a match (ms) for reconnection. */
export const RECONNECT_GRACE_MS = 30_000;

/** Movement tunables (metres, seconds). */
export interface MovementParams {
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  /** Speed multiplier while fully aimed down sights. */
  adsSpeedMult: number;
  backpedalMult: number;
  strafeMult: number;
  /** Ground acceleration toward the wish velocity (m/s²). */
  groundAccel: number;
  /** Ground deceleration when there is no input (m/s²). */
  groundFriction: number;
  airAccel: number;
  airSpeedCap: number;
  gravity: number;
  jumpVelocity: number;
  /** Maximum ledge the capsule steps over while on the ground. */
  stepHeight: number;
  /** Maximum ledge that can be mantled (jump against a ledge) measured from the feet. */
  mantleHeight: number;
  slideSpeed: number;
  slideDuration: number;
  slideFriction: number;
  /** Speed required to start a slide. */
  slideMinSpeed: number;
  capsuleRadius: number;
  standHeight: number;
  crouchHeight: number;
  eyeHeightStand: number;
  eyeHeightCrouch: number;
  eyeHeightSlide: number;
  /** Seconds to transition to/from ADS is per weapon; this is the crouch transition. */
  crouchTransition: number;
  /** Coyote time: jumping is still allowed this long after leaving the ground. */
  coyoteTime: number;
  /** Below this altitude the player dies. */
  killZ: number;
}

export const MOVEMENT: Readonly<MovementParams> = {
  walkSpeed: 4.8,
  sprintSpeed: 6.7,
  crouchSpeed: 2.6,
  adsSpeedMult: 0.7,
  backpedalMult: 0.85,
  strafeMult: 0.95,
  groundAccel: 48,
  groundFriction: 42,
  airAccel: 9,
  airSpeedCap: 7.5,
  gravity: 22,
  jumpVelocity: 6.4,
  stepHeight: 0.45,
  mantleHeight: 1.3,
  slideSpeed: 8.6,
  slideDuration: 0.75,
  slideFriction: 5.5,
  slideMinSpeed: 5.5,
  capsuleRadius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.25,
  eyeHeightStand: 1.62,
  eyeHeightCrouch: 1.08,
  eyeHeightSlide: 0.9,
  crouchTransition: 0.18,
  coyoteTime: 0.08,
  killZ: -20,
};

/** Hitbox dimensions (metres). */
export const HITBOX = {
  bodyHalfWidth: 0.34,
  headRadius: 0.16,
  /** Head centre sits this far below the eye height. */
  headCentreBelowEye: 0.02,
};

/** Bot difficulty presets. Only behaviour parameters change — never health or damage. */
export type BotDifficultyId = 'easy' | 'normal' | 'hard' | 'extreme';

export interface BotProfile {
  id: BotDifficultyId;
  /** Time (s) between first seeing an enemy and starting to react. */
  reactionTime: number;
  /** Extra reaction jitter (s). */
  reactionJitter: number;
  /** Initial aim error (degrees) when acquiring a target. */
  aimErrorDeg: number;
  /** Aim error after settling (degrees). */
  aimErrorSettledDeg: number;
  /** Seconds for aim error to settle from initial to settled. */
  aimSettleTime: number;
  /** Degrees per second the bot can turn. */
  turnSpeedDeg: number;
  /** How well the bot compensates recoil, 0..1. */
  recoilControl: number;
  /** Field of view for spotting enemies (degrees, full angle). */
  fovDeg: number;
  /** Maximum distance at which the bot notices an enemy (m). */
  awarenessRange: number;
  /** Distance within which gunfire is heard (m). */
  hearingRange: number;
  /** 0..1; higher = pushes more, retreats less. */
  aggression: number;
  /** 0..1; how often the bot chooses cover / repositions when hurt. */
  coverUse: number;
  /** Shots per burst before a short pause (Infinity = full auto). */
  burstLength: number;
  /** Pause between bursts (s). */
  burstPause: number;
  /** Preferred engagement distance (m). */
  preferredRange: number;
  /** 0..1; participation in objectives (unused in TDM). */
  objectiveFocus: number;
  /** 0..1; tendency to move with team-mates and follow up pushes. */
  teamwork: number;
  /** 0..1; how often the bot picks flank routes instead of the shortest path. */
  flanking: number;
  /** Whether the bot uses ADS when engaging. */
  usesAds: boolean;
  /** Whether the bot sprints when travelling. */
  sprints: boolean;
  /** Whether the bot re-evaluates strategy based on match state. */
  adaptive: boolean;
}

export const BOT_PROFILES: Record<BotDifficultyId, BotProfile> = {
  easy: {
    id: 'easy',
    reactionTime: 0.75,
    reactionJitter: 0.35,
    aimErrorDeg: 9,
    aimErrorSettledDeg: 3.5,
    aimSettleTime: 1.6,
    turnSpeedDeg: 160,
    recoilControl: 0.2,
    fovDeg: 100,
    awarenessRange: 30,
    hearingRange: 12,
    aggression: 0.35,
    coverUse: 0.1,
    burstLength: 4,
    burstPause: 0.7,
    preferredRange: 12,
    objectiveFocus: 0.3,
    teamwork: 0.1,
    flanking: 0.0,
    usesAds: false,
    sprints: false,
    adaptive: false,
  },
  normal: {
    id: 'normal',
    reactionTime: 0.42,
    reactionJitter: 0.2,
    aimErrorDeg: 5.5,
    aimErrorSettledDeg: 1.8,
    aimSettleTime: 1.0,
    turnSpeedDeg: 260,
    recoilControl: 0.5,
    fovDeg: 120,
    awarenessRange: 45,
    hearingRange: 22,
    aggression: 0.5,
    coverUse: 0.4,
    burstLength: 6,
    burstPause: 0.4,
    preferredRange: 15,
    objectiveFocus: 0.6,
    teamwork: 0.35,
    flanking: 0.2,
    usesAds: true,
    sprints: true,
    adaptive: false,
  },
  hard: {
    id: 'hard',
    reactionTime: 0.26,
    reactionJitter: 0.1,
    aimErrorDeg: 3.2,
    aimErrorSettledDeg: 0.9,
    aimSettleTime: 0.6,
    turnSpeedDeg: 380,
    recoilControl: 0.8,
    fovDeg: 140,
    awarenessRange: 60,
    hearingRange: 35,
    aggression: 0.65,
    coverUse: 0.7,
    burstLength: 10,
    burstPause: 0.25,
    preferredRange: 18,
    objectiveFocus: 0.8,
    teamwork: 0.6,
    flanking: 0.5,
    usesAds: true,
    sprints: true,
    adaptive: true,
  },
  extreme: {
    id: 'extreme',
    reactionTime: 0.17,
    reactionJitter: 0.06,
    aimErrorDeg: 2.0,
    aimErrorSettledDeg: 0.45,
    aimSettleTime: 0.35,
    turnSpeedDeg: 520,
    recoilControl: 0.93,
    fovDeg: 160,
    awarenessRange: 80,
    hearingRange: 50,
    aggression: 0.75,
    coverUse: 0.85,
    burstLength: Infinity,
    burstPause: 0.12,
    preferredRange: 20,
    objectiveFocus: 0.95,
    teamwork: 0.85,
    flanking: 0.7,
    usesAds: true,
    sprints: true,
    adaptive: true,
  },
};

export const BOT_DIFFICULTIES: readonly BotDifficultyId[] = ['easy', 'normal', 'hard', 'extreme'];

/** Pool of original call-sign style bot names (Arabic and Iraqi-inspired, romanised). */
export const BOT_NAMES: readonly string[] = [
  'Samir', 'Layla', 'Haidar', 'Zainab', 'Karrar', 'Noor', 'Mustafa', 'Rania', 'Ali', 'Huda',
  'Omar', 'Dalia', 'Yousif', 'Sara', 'Hassan', 'Maryam', 'Firas', 'Nada', 'Bashar', 'Hiba',
  'Ahmed', 'Rasha', 'Kadhim', 'Shams', 'Anwar', 'Lina', 'Jawad', 'Amal', 'Saif', 'Farah',
];
