/**
 * One match: the authoritative 60 Hz simulation of every participant, weapon
 * resolution with lag compensation, Team Deathmatch rules, snapshots and the
 * scoreboard. The match has no notion of sockets or timers — the Room steps it
 * with `step(timeMs)` and delivers the messages it hands to the MatchSink — so
 * tests can run thousands of ticks instantly.
 */
import {
  BOT_PROFILES,
  BTN,
  HEALTH_REGEN_DELAY,
  HEALTH_REGEN_RATE,
  INPUT_HOLD_TICKS,
  INTERP_DELAY_MS,
  LAG_COMP_HISTORY_MS,
  MAX_HEALTH,
  MAX_INPUTS_PER_TICK,
  MAX_INPUT_QUEUE,
  MAX_LAG_COMP_MS,
  SCOREBOARD_INTERVAL_TICKS,
  SNAPSHOT_INTERVAL_TICKS,
  TICK_DT,
  TICK_RATE,
  WEAPONS,
  buildCollisionWorld,
  clamp,
  computeShot,
  createPlayerState,
  damageAtDistance,
  eyePosition,
  lineOfSight,
  otherTeam,
  playerFits,
  simulateStep,
  stepWeapons,
  toPlayerSnap,
  toTuple,
  traceShot,
  type BotDifficultyId,
  type CollisionWorld,
  type GameEvent,
  type HitTarget,
  type InputCmd,
  type Loadout,
  type MapDef,
  type MatchResults,
  type MatchSettings,
  type MatchStartInfo,
  type PlayerSimState,
  type S2C,
  type ScoreboardState,
  type Snapshot,
  type SpawnPoint,
  type Stance,
  type Team,
  type WeaponId,
} from '@tra/shared';
import { BotBrain, type BotObservation, type BotSound } from './Bots';
import { isAllowedMapId } from './config';
import { silentLogger, type Logger } from './log';

export type MatchPhase = 'loading' | 'playing' | 'ended';

export interface MatchParticipant {
  id: number;
  name: string;
  team: Team;
  isBot: boolean;
  botDifficulty?: BotDifficultyId;
  loadout: Loadout;
  connected: boolean;
}

/** Where the match's outgoing messages go (implemented by the Room). */
export interface MatchSink {
  /** Deliver a message to a human participant. */
  send(playerId: number, msg: S2C): void;
  /** The match went live (everyone loaded). */
  onLive(): void;
  /** The match ended; the sink owns what happens next. */
  onEnd(results: MatchResults): void;
}

export interface MatchOptions {
  map: MapDef;
  settings: MatchSettings;
  seed: number;
  startTick: number;
  startTime: number;
  matchNumber: number;
  log?: Logger;
  /** Ticks the match waits for clients to report `loaded` before going live anyway. */
  loadTimeoutTicks?: number;
}

/** Score awarded per kill (TDM). */
export const SCORE_PER_KILL = 100;
/** Ticks between a client's `loaded` (or a join-in-progress) and its first spawn. */
export const JOIN_SPAWN_DELAY_TICKS = TICK_RATE;
export const DEFAULT_LOAD_TIMEOUT_TICKS = 15 * TICK_RATE;
/** Input processing budget: at most this many banked ticks of catch-up. */
const MAX_INPUT_CREDITS = 20;
const HISTORY_LENGTH = Math.ceil(LAG_COMP_HISTORY_MS / (TICK_DT * 1000)) + 1;
const MAX_PENDING_EVENTS = 200;

interface PoseSample {
  time: number;
  x: number;
  y: number;
  z: number;
  stance: Stance;
  alive: boolean;
}

export interface MatchPlayer {
  readonly id: number;
  name: string;
  team: Team;
  readonly isBot: boolean;
  botDifficulty?: BotDifficultyId;
  connected: boolean;
  loadout: Loadout;
  state: PlayerSimState;
  brain: BotBrain | null;
  ping: number;
  /** Validated, not yet processed inputs (humans). */
  queue: InputCmd[];
  lastInput: InputCmd;
  /** Highest seq accepted into the queue. */
  lastSeq: number;
  /** Last seq actually simulated (echoed as `ack`). */
  ack: number;
  holdTicks: number;
  credits: number;
  botSeq: number;
  history: PoseSample[];
  historyCount: number;
  historyHead: number;
  loaded: boolean;
  /** Tick at which the player (re)spawns; null when alive or waiting for `loaded`. */
  spawnAtTick: number | null;
  kills: number;
  deaths: number;
  score: number;
  /** Events to deliver with the next snapshot (humans only). */
  events: GameEvent[];
}

const worldCache = new Map<string, CollisionWorld>();

/** Collision world for a map, built once per process. */
export function getWorld(map: MapDef): CollisionWorld {
  let w = worldCache.get(map.id);
  if (!w) {
    w = buildCollisionWorld(map);
    worldCache.set(map.id, w);
  }
  return w;
}

function neutralInput(seq: number, yaw: number, pitch: number, time: number): InputCmd {
  return { seq, moveX: 0, moveY: 0, yaw, pitch, buttons: 0, time };
}

export class Match {
  readonly map: MapDef;
  readonly world: CollisionWorld;
  readonly settings: MatchSettings;
  readonly seed: number;
  readonly startTick: number;
  readonly startTime: number;
  readonly matchNumber: number;
  readonly players = new Map<number, MatchPlayer>();
  phase: MatchPhase = 'loading';
  /** Current server tick (advances by one per `step`). */
  tick: number;
  /** Time (ms) of the current tick. */
  time: number;
  results: MatchResults | null = null;

  private readonly sink: MatchSink;
  private readonly log: Logger;
  private readonly loadTimeoutTicks: number;
  private liveTick = 0;
  private leader: Team | null = null;
  private announced = { halfway: false, lastMinute: false, tenSeconds: false };
  private scoreboardDue = false;
  private shotsLastTick: BotSound[] = [];
  private shotsThisTick: BotSound[] = [];

  constructor(opts: MatchOptions, sink: MatchSink) {
    this.map = opts.map;
    this.world = getWorld(opts.map);
    this.settings = opts.settings;
    this.seed = opts.seed >>> 0;
    this.startTick = opts.startTick;
    this.startTime = opts.startTime;
    this.matchNumber = opts.matchNumber;
    this.tick = opts.startTick;
    this.time = opts.startTime;
    this.sink = sink;
    this.log = opts.log ?? silentLogger;
    this.loadTimeoutTicks = opts.loadTimeoutTicks ?? DEFAULT_LOAD_TIMEOUT_TICKS;
  }

  startInfo(): MatchStartInfo {
    return {
      mapId: this.map.id,
      mode: this.settings.mode,
      settings: this.settings,
      seed: this.seed,
      startTick: this.startTick,
      startTime: this.startTime,
      matchNumber: this.matchNumber,
    };
  }

  // ---------------------------------------------------------------------------
  // Roster
  // ---------------------------------------------------------------------------

  addPlayer(p: MatchParticipant): MatchPlayer {
    const spawn = this.map.spawns[p.team][0] ?? this.map.spawns.neutral[0];
    const state = createPlayerState(spawn.pos, spawn.yaw, p.loadout.primary, p.loadout.secondary);
    state.alive = false;
    state.health = 0;
    const mp: MatchPlayer = {
      id: p.id,
      name: p.name,
      team: p.team,
      isBot: p.isBot,
      botDifficulty: p.botDifficulty,
      connected: p.connected,
      loadout: { ...p.loadout },
      state,
      brain: null,
      ping: 0,
      queue: [],
      lastInput: neutralInput(0, spawn.yaw, 0, this.time),
      lastSeq: 0,
      ack: 0,
      holdTicks: 0,
      credits: MAX_INPUTS_PER_TICK,
      botSeq: 0,
      history: [],
      historyCount: 0,
      historyHead: 0,
      loaded: p.isBot,
      spawnAtTick: null,
      kills: 0,
      deaths: 0,
      score: 0,
      events: [],
    };
    if (p.isBot) {
      mp.brain = new BotBrain({
        id: p.id,
        team: p.team,
        profile: BOT_PROFILES[p.botDifficulty ?? this.settings.bots.difficulty],
        seed: (this.seed ^ (p.id * 0x9e3779b1)) >>> 0,
        map: this.map,
        world: this.world,
      });
      if (this.phase === 'playing') mp.spawnAtTick = this.tick + JOIN_SPAWN_DELAY_TICKS;
    }
    this.players.set(p.id, mp);
    return mp;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
  }

  getPlayer(id: number): MatchPlayer | undefined {
    return this.players.get(id);
  }

  /** A human client reported that it finished loading the map. */
  markLoaded(id: number): void {
    const p = this.players.get(id);
    if (!p || p.loaded) return;
    p.loaded = true;
    if (this.phase === 'playing' && !p.state.alive && p.spawnAtTick === null) p.spawnAtTick = this.tick + JOIN_SPAWN_DELAY_TICKS;
  }

  /** Human connection state changed (reconnection grace). */
  setConnected(id: number, connected: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    if (connected) {
      // A fresh client connection restarts its input sequence.
      p.queue.length = 0;
      p.lastSeq = 0;
      p.ack = 0;
      p.events.length = 0;
      p.loaded = false;
      p.lastInput = neutralInput(0, p.state.yaw, p.state.pitch, this.time);
    }
  }

  setLoadout(id: number, loadout: Loadout): void {
    const p = this.players.get(id);
    if (p) p.loadout = { ...loadout };
  }

  setBotDifficulty(id: number, difficulty: BotDifficultyId): void {
    const p = this.players.get(id);
    if (!p || !p.brain) return;
    p.botDifficulty = difficulty;
    p.brain.setProfile(BOT_PROFILES[difficulty]);
  }

  setPing(id: number, ping: number): void {
    const p = this.players.get(id);
    if (p) p.ping = ping;
  }

  // ---------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------

  /** Validate and queue a client's input batch. Anything malformed is dropped silently. */
  queueInputs(id: number, cmds: unknown): void {
    const p = this.players.get(id);
    if (!p || p.isBot || !p.connected || !Array.isArray(cmds)) return;
    const n = Math.min(cmds.length, MAX_INPUT_QUEUE);
    for (let i = 0; i < n; i++) {
      const c = cmds[i] as Partial<InputCmd> | null;
      if (!c || typeof c !== 'object') continue;
      const { seq, moveX, moveY, yaw, pitch, buttons, time } = c;
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= p.lastSeq) continue;
      if (![moveX, moveY, yaw, pitch, buttons].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      p.lastSeq = seq;
      p.queue.push({
        seq,
        moveX: clamp(moveX as number, -1, 1),
        moveY: clamp(moveY as number, -1, 1),
        yaw: yaw as number,
        pitch: pitch as number,
        buttons: (buttons as number) & 0xffff,
        time: typeof time === 'number' && Number.isFinite(time) ? time : this.time,
      });
      if (p.queue.length > MAX_INPUT_QUEUE) p.queue.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /** Advance the match by one tick occurring at `timeMs`. */
  step(timeMs: number): void {
    if (this.phase === 'ended') return;
    this.tick++;
    this.time = timeMs;

    if (this.phase === 'loading') {
      const humans = [...this.players.values()].filter((p) => !p.isBot && p.connected);
      const everyoneLoaded = humans.every((p) => p.loaded);
      if (everyoneLoaded || this.tick - this.startTick >= this.loadTimeoutTicks) this.goLive();
    }

    for (const p of this.players.values()) {
      if (!p.state.alive && p.spawnAtTick !== null && this.tick >= p.spawnAtTick) this.spawn(p);
    }

    this.shotsLastTick = this.shotsThisTick;
    this.shotsThisTick = [];

    if (this.phase === 'playing') {
      for (const p of this.players.values()) this.stepPlayer(p);
    }
    for (const p of this.players.values()) this.recordPose(p);

    if (this.phase === 'playing') this.applyRules();
    if (this.results) return; // the match just ended; end() already flushed the final messages

    if ((this.tick - this.startTick) % SNAPSHOT_INTERVAL_TICKS === 0) this.sendSnapshots();
    if (this.scoreboardDue || (this.tick - this.startTick) % SCOREBOARD_INTERVAL_TICKS === 0) {
      this.scoreboardDue = false;
      this.broadcast({ t: 'scoreboard', board: this.scoreboard() });
    }
  }

  private goLive(): void {
    this.phase = 'playing';
    this.liveTick = this.tick;
    for (const p of this.players.values()) {
      if (p.loaded && !p.state.alive) p.spawnAtTick = this.tick;
    }
    this.emit({ e: 'announce', k: 'match_start' });
    this.scoreboardDue = true; // HUDs get the clock and score immediately
    this.sink.onLive();
  }

  private stepPlayer(p: MatchPlayer): void {
    if (p.isBot) {
      const input = p.brain!.think(this.senseFor(p), ++p.botSeq);
      this.applyInput(p, input);
      return;
    }
    if (!p.connected) {
      // Body stays in the world but receives no intent while the player is away.
      const idle = neutralInput(p.ack, p.state.yaw, p.state.pitch, this.time);
      this.applyInput(p, idle);
      return;
    }
    p.credits = Math.min(MAX_INPUT_CREDITS, p.credits + 1);
    let processed = 0;
    while (p.queue.length > 0 && processed < MAX_INPUTS_PER_TICK && p.credits > 0) {
      const input = p.queue.shift()!;
      p.credits--;
      processed++;
      p.holdTicks = 0;
      p.lastInput = input;
      p.ack = input.seq;
      this.applyInput(p, input);
    }
    if (processed === 0) {
      // Nothing arrived: repeat the last intent, dropping edge actions once it goes stale.
      p.holdTicks++;
      let input = p.lastInput;
      if (p.holdTicks > INPUT_HOLD_TICKS && (input.buttons & (BTN.FIRE | BTN.JUMP)) !== 0) {
        input = { ...input, buttons: input.buttons & ~(BTN.FIRE | BTN.JUMP) };
        p.lastInput = input;
      }
      this.applyInput(p, input);
    }
  }

  private senseFor(p: MatchPlayer) {
    const others: BotObservation[] = [];
    for (const o of this.players.values()) {
      if (o === p) continue;
      others.push({ id: o.id, team: o.team, pos: o.state.pos, stance: o.state.stance, alive: o.state.alive });
    }
    return { timeMs: this.time, self: p.state, others, shots: this.shotsLastTick };
  }

  private applyInput(p: MatchPlayer, input: InputCmd): void {
    const s = p.state;
    const wasAlive = s.alive;
    simulateStep(s, input, this.world, TICK_DT);
    if (wasAlive && !s.alive) {
      // Only the kill Z does this inside the sim.
      this.kill(p, null, 'world', false);
      return;
    }
    if (!s.alive) return;
    const events = stepWeapons(s, input, TICK_DT);
    for (const ev of events) {
      const weapon = s.weapons[ev.weaponIndex].id;
      if (ev.kind === 'fire') this.resolveShot(p, weapon, ev.shotIndex, input);
      else if (ev.kind === 'reload_start') this.emit({ e: 'reload', id: p.id, w: weapon });
      else if (ev.kind === 'switch_start') this.emit({ e: 'switch', id: p.id, w: weapon });
    }
    if (s.alive) {
      if (s.regenDelay > 0) s.regenDelay = Math.max(0, s.regenDelay - TICK_DT);
      else if (s.health < MAX_HEALTH) s.health = Math.min(MAX_HEALTH, s.health + HEALTH_REGEN_RATE * TICK_DT);
    }
  }

  // ---------------------------------------------------------------------------
  // Shots, damage, deaths
  // ---------------------------------------------------------------------------

  private resolveShot(shooter: MatchPlayer, weaponId: WeaponId, shotIndex: number, input: InputCmd): void {
    const def = WEAPONS[weaponId];
    const s = shooter.state;
    const kin = computeShot(s, def, shotIndex, this.seed, shooter.id);
    const origin = eyePosition(s);
    if (shooter.brain) shooter.brain.onOwnShot(kin.kickPitch, kin.kickYaw, def.recoil.persistent);

    // Lag compensation: trace against the world as the shooter saw it. Bots act
    // on the authoritative present, so their shots are not rewound.
    const rewindTo = shooter.isBot || !Number.isFinite(input.time)
      ? this.time
      : clamp(input.time - INTERP_DELAY_MS, this.time - MAX_LAG_COMP_MS, this.time);
    const targets: HitTarget[] = [];
    for (const o of this.players.values()) {
      if (o === shooter) continue;
      if (!this.settings.friendlyFire && o.team === shooter.team) continue;
      const pose = this.poseAt(o, rewindTo);
      if (pose) targets.push(pose);
    }
    const hit = traceShot(this.world, origin, kin.dir, def.range, targets);

    this.emit({ e: 'fire', id: shooter.id, w: weaponId, o: toTuple(origin), d: toTuple(kin.dir), s: shotIndex }, shooter.id);
    this.shotsThisTick.push({ id: shooter.id, team: shooter.team, pos: origin });

    if (hit.kind === 'world') {
      this.emit({ e: 'impact', p: toTuple(hit.point), n: toTuple(hit.normal), m: hit.material, w: weaponId });
    } else if (hit.kind === 'player') {
      const victim = this.players.get(hit.id);
      if (victim) this.applyDamage(victim, shooter, damageAtDistance(def, hit.dist, hit.headshot), hit.headshot, weaponId);
    }
  }

  private applyDamage(victim: MatchPlayer, attacker: MatchPlayer, amount: number, headshot: boolean, weapon: WeaponId): void {
    const s = victim.state;
    if (!s.alive) return;
    s.health = Math.max(0, s.health - amount);
    s.regenDelay = HEALTH_REGEN_DELAY;
    let dx = attacker.state.pos.x - s.pos.x;
    let dz = attacker.state.pos.z - s.pos.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) { dx /= len; dz /= len; } else { dx = 0; dz = 1; }
    this.emit({
      e: 'dmg',
      to: victim.id,
      from: attacker.id,
      amt: amount,
      hs: headshot ? 1 : 0,
      dir: [Math.round(dx * 1000) / 1000, Math.round(dz * 1000) / 1000],
      hp: Math.round(s.health),
    });
    if (s.health <= 0) this.kill(victim, attacker, weapon, headshot);
  }

  private kill(victim: MatchPlayer, killer: MatchPlayer | null, weapon: WeaponId | 'world', headshot: boolean): void {
    const s = victim.state;
    s.alive = false;
    s.health = 0;
    s.vel.x = s.vel.y = s.vel.z = 0;
    victim.deaths++;
    victim.spawnAtTick = this.tick + Math.max(1, Math.round(this.settings.respawnDelaySec * TICK_RATE));
    const credited = killer && killer !== victim && killer.team !== victim.team;
    if (credited) {
      killer.kills++;
      killer.score = killer.kills * SCORE_PER_KILL;
    }
    this.emit({ e: 'kill', k: killer ? killer.id : victim.id, v: victim.id, w: weapon, hs: headshot ? 1 : 0 });
    this.emit({ e: 'death', id: victim.id, p: toTuple(s.pos) });
    this.scoreboardDue = true;
    this.log.debug(`kill: ${killer ? killer.name : 'world'} -> ${victim.name} (${weapon}${headshot ? ', headshot' : ''})`);
  }

  // ---------------------------------------------------------------------------
  // Pose history (lag compensation)
  // ---------------------------------------------------------------------------

  private recordPose(p: MatchPlayer): void {
    const s = p.state;
    const sample: PoseSample = { time: this.time, x: s.pos.x, y: s.pos.y, z: s.pos.z, stance: s.stance, alive: s.alive };
    if (p.history.length < HISTORY_LENGTH) {
      p.history.push(sample);
      p.historyCount = p.history.length;
      p.historyHead = p.history.length - 1;
    } else {
      p.historyHead = (p.historyHead + 1) % HISTORY_LENGTH;
      p.history[p.historyHead] = sample;
    }
  }

  private clearHistory(p: MatchPlayer): void {
    p.history.length = 0;
    p.historyCount = 0;
    p.historyHead = 0;
  }

  /**
   * The player's hit target at time `t`, interpolated between the two nearest
   * recorded poses. Returns null when the player had no living body then.
   */
  private poseAt(p: MatchPlayer, t: number): HitTarget | null {
    const n = p.historyCount;
    if (n === 0) return p.state.alive ? { id: p.id, pos: p.state.pos, stance: p.state.stance } : null;
    const len = p.history.length;
    const at = (k: number): PoseSample => p.history[(((p.historyHead - k) % len) + len) % len];
    const newest = at(0);
    if (t >= newest.time) return newest.alive ? { id: p.id, pos: { x: newest.x, y: newest.y, z: newest.z }, stance: newest.stance } : null;
    // Walk back until we find the sample at or before t.
    let after = newest;
    for (let k = 1; k < n; k++) {
      const before = at(k);
      if (before.time <= t) {
        if (!before.alive || !after.alive) return null;
        const span = after.time - before.time;
        const f = span > 1e-6 ? (t - before.time) / span : 0;
        return {
          id: p.id,
          pos: { x: before.x + (after.x - before.x) * f, y: before.y + (after.y - before.y) * f, z: before.z + (after.z - before.z) * f },
          stance: f < 0.5 ? before.stance : after.stance,
        };
      }
      after = before;
    }
    const oldest = after;
    return oldest.alive ? { id: p.id, pos: { x: oldest.x, y: oldest.y, z: oldest.z }, stance: oldest.stance } : null;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  private spawn(p: MatchPlayer): void {
    const sp = this.chooseSpawn(p);
    const state = createPlayerState(sp.pos, sp.yaw, p.loadout.primary, p.loadout.secondary);
    p.state = state;
    p.spawnAtTick = null;
    p.lastInput = neutralInput(p.ack, sp.yaw, 0, this.time);
    p.holdTicks = 0;
    this.clearHistory(p);
    if (p.brain) p.brain.onSpawn(state);
    this.emit({ e: 'spawn', id: p.id, p: toTuple(state.pos), team: p.team });
  }

  /**
   * Prefer the team spawn farthest from living enemies that no enemy can see;
   * fall back to neutral spawns, then to any spawn.
   */
  private chooseSpawn(p: MatchPlayer): SpawnPoint {
    const enemies: MatchPlayer[] = [];
    const living: MatchPlayer[] = [];
    for (const o of this.players.values()) {
      if (o === p || !o.state.alive) continue;
      living.push(o);
      if (o.team !== p.team) enemies.push(o);
    }
    const usable = (sp: SpawnPoint): boolean =>
      playerFits(this.world, sp.pos, 'stand') && !living.some((o) => Math.hypot(o.state.pos.x - sp.pos.x, o.state.pos.z - sp.pos.z) < 1);
    const minEnemyDist = (sp: SpawnPoint): number => {
      let d = Infinity;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.state.pos.x - sp.pos.x, e.state.pos.y - sp.pos.y, e.state.pos.z - sp.pos.z));
      return d;
    };
    const seen = (sp: SpawnPoint): boolean => {
      const eye = eyePosition({ pos: sp.pos, stance: 'stand' });
      return enemies.some((e) => lineOfSight(this.world, eyePosition(e.state), eye));
    };
    const pick = (list: readonly SpawnPoint[], requireHidden: boolean): SpawnPoint | null => {
      let best: SpawnPoint | null = null;
      let bestDist = -1;
      for (const sp of list) {
        if (!usable(sp)) continue;
        if (requireHidden && seen(sp)) continue;
        const d = minEnemyDist(sp);
        if (d > bestDist) { bestDist = d; best = sp; }
      }
      return best;
    };
    const team = this.map.spawns[p.team];
    const all = [...team, ...this.map.spawns.neutral, ...this.map.spawns[otherTeam(p.team)]];
    return (
      pick(team, true) ??
      pick(this.map.spawns.neutral, true) ??
      pick(all, false) ??
      team[0] ??
      this.map.spawns.neutral[0]
    );
  }

  // ---------------------------------------------------------------------------
  // Mode rules (Team Deathmatch)
  // ---------------------------------------------------------------------------

  teamKills(team: Team): number {
    let k = 0;
    for (const p of this.players.values()) if (p.team === team) k += p.kills;
    return k;
  }

  timeLeftSec(): number {
    if (this.phase === 'loading') return this.settings.timeLimitSec;
    const elapsed = (this.tick - this.liveTick) * TICK_DT;
    return Math.max(0, this.settings.timeLimitSec - elapsed);
  }

  private applyRules(): void {
    const tig = this.teamKills('tigris');
    const eup = this.teamKills('euphrates');
    const leader: Team | null = tig > eup ? 'tigris' : eup > tig ? 'euphrates' : this.leader;
    if (leader !== this.leader && leader) {
      this.emit({ e: 'announce', k: 'lead_taken', team: leader });
      this.emit({ e: 'announce', k: 'lead_lost', team: otherTeam(leader) });
    }
    this.leader = leader;

    const limit = this.settings.scoreLimit;
    if (tig >= limit || eup >= limit) {
      this.end(tig === eup ? 'draw' : tig > eup ? 'tigris' : 'euphrates', 'score');
      return;
    }
    const left = this.timeLeftSec();
    const total = this.settings.timeLimitSec;
    if (!this.announced.halfway && left <= total / 2) { this.announced.halfway = true; this.emit({ e: 'announce', k: 'halfway' }); }
    if (!this.announced.lastMinute && total > 90 && left <= 60) { this.announced.lastMinute = true; this.emit({ e: 'announce', k: 'last_minute' }); }
    if (!this.announced.tenSeconds && left <= 10) { this.announced.tenSeconds = true; this.emit({ e: 'announce', k: 'ten_seconds' }); }
    if (left <= 0) this.end(tig === eup ? 'draw' : tig > eup ? 'tigris' : 'euphrates', 'time');
  }

  /** End the match now (also used by the room for forfeits). */
  end(winner: Team | 'draw', reason: MatchResults['reason']): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.emit({ e: 'announce', k: 'match_end' });
    const board = this.scoreboard();
    this.results = {
      winner,
      reason,
      scoreboard: board,
      mvpId: this.mvp(),
      nextMapId: this.nextMapId(),
      returnToLobbySec: 12,
    };
    // Flush pending events (the deciding kill) before the end message.
    this.sendSnapshots();
    this.broadcast({ t: 'scoreboard', board });
    this.broadcast({ t: 'match.end', results: this.results });
    this.log.info(`match ${this.matchNumber} ended: ${winner} by ${reason} (${board.teams.tigris}-${board.teams.euphrates})`);
    this.sink.onEnd(this.results);
  }

  private mvp(): number | null {
    let best: MatchPlayer | null = null;
    for (const p of this.players.values()) {
      if (p.score <= 0) continue;
      if (!best || p.score > best.score || (p.score === best.score && p.deaths < best.deaths)) best = p;
    }
    return best ? best.id : null;
  }

  private nextMapId(): string {
    const rotation = this.settings.mapRotation.filter(isAllowedMapId);
    if (rotation.length === 0) return this.map.id;
    const idx = rotation.indexOf(this.map.id);
    return rotation[(idx + 1) % rotation.length];
  }

  // ---------------------------------------------------------------------------
  // Outgoing
  // ---------------------------------------------------------------------------

  scoreboard(): ScoreboardState {
    const players = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, score: p.score, ping: p.ping, isBot: p.isBot }))
      .sort((a, b) => b.score - a.score || a.deaths - b.deaths || a.id - b.id);
    return {
      teams: { tigris: this.teamKills('tigris'), euphrates: this.teamKills('euphrates') },
      players,
      timeLeftSec: Math.ceil(this.timeLeftSec()),
      scoreLimit: this.settings.scoreLimit,
      mode: this.settings.mode,
    };
  }

  /** Queue an event for every connected human (optionally excluding one player). */
  private emit(ev: GameEvent, exceptId?: number): void {
    for (const p of this.players.values()) {
      if (p.isBot || !p.connected || p.id === exceptId) continue;
      if (p.events.length >= MAX_PENDING_EVENTS) p.events.shift();
      p.events.push(ev);
    }
  }

  private broadcast(msg: S2C): void {
    for (const p of this.players.values()) if (!p.isBot && p.connected) this.sink.send(p.id, msg);
  }

  private sendSnapshots(): void {
    for (const p of this.players.values()) {
      if (p.isBot || !p.connected) continue;
      const others = [];
      for (const o of this.players.values()) {
        if (o === p || !o.state.alive) continue;
        others.push(toPlayerSnap(o.id, o.team, o.state));
      }
      const snap: Snapshot = {
        tick: this.tick,
        st: Math.round(this.time),
        ack: p.ack,
        players: others,
        self: p.state,
        events: p.events,
      };
      if (!p.state.alive && p.spawnAtTick !== null) snap.respawnIn = Math.max(0, (p.spawnAtTick - this.tick) * TICK_DT);
      p.events = [];
      this.sink.send(p.id, { t: 'snapshot', snap });
    }
  }
}
