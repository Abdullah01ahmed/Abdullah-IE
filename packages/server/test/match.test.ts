/**
 * Match rules, driven tick by tick without sockets or timers on the test arena.
 */
import { describe, expect, it } from 'vitest';
import {
  BTN,
  DEFAULT_LOADOUT,
  MAX_HEALTH,
  TICK_RATE,
  WEAPONS,
  playerFits,
  testArena,
  type GameEvent,
  type InputCmd,
  type MatchResults,
  type MatchSettings,
  type S2C,
  type Team,
  type Vec3,
} from '@tra/shared';
import { Match, SCORE_PER_KILL } from '../src/Match';
import { TICK_MS } from '../src/clock';
import { testSettings } from './helpers';

interface Harness {
  match: Match;
  settings: MatchSettings;
  sent: Map<number, S2C[]>;
  ended: MatchResults[];
  seqs: Map<number, number>;
  /** Advance one tick, queuing the given per-player inputs first. */
  step(inputs?: Record<number, Partial<InputCmd>>): void;
  run(ticks: number, inputs?: Record<number, Partial<InputCmd>>): void;
  events(id: number): GameEvent[];
  addHuman(id: number, team: Team): void;
  /** Move a body somewhere and let it settle so the pose history is consistent. */
  place(id: number, pos: Vec3, yaw: number, hold?: Partial<InputCmd>): void;
}

function harness(over: Partial<MatchSettings> = {}, seed = 1): Harness {
  const settings = testSettings(over);
  const sent = new Map<number, S2C[]>();
  const ended: MatchResults[] = [];
  const match = new Match(
    { map: testArena, settings, seed, startTick: 0, startTime: 0, matchNumber: 1 },
    {
      send: (id, msg) => {
        let list = sent.get(id);
        if (!list) sent.set(id, (list = []));
        list.push(msg);
      },
      onLive: () => undefined,
      onEnd: (r) => ended.push(r),
    },
  );
  const seqs = new Map<number, number>();
  const h: Harness = {
    match,
    settings,
    sent,
    ended,
    seqs,
    step(inputs = {}) {
      const time = match.time + TICK_MS;
      for (const [idStr, partial] of Object.entries(inputs)) {
        const id = Number(idStr);
        const p = match.getPlayer(id)!;
        const seq = (seqs.get(id) ?? 0) + 1;
        seqs.set(id, seq);
        match.queueInputs(id, [{ seq, moveX: 0, moveY: 0, yaw: p.state.yaw, pitch: p.state.pitch, buttons: 0, time, ...partial }]);
      }
      match.step(time);
    },
    run(ticks, inputs) {
      for (let i = 0; i < ticks; i++) h.step(inputs);
    },
    events(id) {
      const out: GameEvent[] = [];
      for (const m of sent.get(id) ?? []) if (m.t === 'snapshot') out.push(...m.snap.events);
      return out;
    },
    addHuman(id, team) {
      match.addPlayer({ id, name: `P${id}`, team, isBot: false, loadout: DEFAULT_LOADOUT, connected: true });
      match.markLoaded(id);
    },
    place(id, pos, yaw, hold = {}) {
      const p = match.getPlayer(id)!;
      p.state.pos = { ...pos };
      p.state.vel = { x: 0, y: 0, z: 0 };
      p.state.yaw = yaw;
      p.state.pitch = 0;
      h.run(12, { [id]: { yaw, pitch: 0, ...hold } });
    },
  };
  return h;
}

/** Two players facing each other across the open lane at z = 12 (clear line of sight). */
function duel(over: Partial<MatchSettings> = {}, teams: [Team, Team] = ['tigris', 'euphrates']): Harness {
  const h = harness({ respawnDelaySec: 3, ...over });
  h.addHuman(1, teams[0]);
  h.addHuman(2, teams[1]);
  h.step(); // goes live and spawns both
  expect(h.match.phase).toBe('playing');
  h.place(2, { x: 0, y: 0, z: 12 }, -Math.PI / 2);
  h.place(1, { x: -10, y: 0, z: 12 }, Math.PI / 2, { buttons: BTN.ADS });
  return h;
}

/** Hold the trigger until the victim dies (or the tick budget runs out). Returns the death tick. */
function fireUntilDead(h: Harness, shooter: number, victim: number, maxTicks = 120): number | null {
  const p1 = h.match.getPlayer(shooter)!;
  for (let i = 0; i < maxTicks; i++) {
    h.step({ [shooter]: { yaw: p1.state.yaw, buttons: BTN.ADS | BTN.FIRE } });
    if (!h.match.getPlayer(victim)!.state.alive) return h.match.tick;
  }
  return null;
}

describe('Match rules (test_arena)', () => {
  it('goes live once everyone has loaded and spawns players at valid team spawns', () => {
    const h = harness();
    h.addHuman(1, 'tigris');
    h.match.addPlayer({ id: 2, name: 'slow', team: 'euphrates', isBot: false, loadout: DEFAULT_LOADOUT, connected: true });
    h.step();
    expect(h.match.phase).toBe('loading');
    h.match.markLoaded(2);
    h.step();
    expect(h.match.phase).toBe('playing');
    for (const id of [1, 2]) {
      const p = h.match.getPlayer(id)!;
      expect(p.state.alive).toBe(true);
      expect(playerFits(h.match.world, p.state.pos, 'stand')).toBe(true);
      const list = testArena.spawns[p.team];
      expect(list.some((s) => s.pos.x === p.state.pos.x && s.pos.z === p.state.pos.z)).toBe(true);
    }
    h.run(3); // next snapshot carries the queued events
    expect(h.events(1).some((e) => e.e === 'announce' && e.k === 'match_start')).toBe(true);
    expect(h.events(1).filter((e) => e.e === 'spawn').map((e) => (e as { id: number }).id).sort()).toEqual([1, 2]);
  });

  it('credits kills, updates score and emits dmg/kill/death events', () => {
    const h = duel();
    const deathTick = fireUntilDead(h, 1, 2);
    expect(deathTick).not.toBeNull();
    const p1 = h.match.getPlayer(1)!;
    const p2 = h.match.getPlayer(2)!;
    expect(p1.kills).toBe(1);
    expect(p1.score).toBe(SCORE_PER_KILL);
    expect(p2.deaths).toBe(1);
    expect(p2.state.health).toBe(0);
    const ev = h.events(2);
    const dmg = ev.filter((e) => e.e === 'dmg') as Extract<GameEvent, { e: 'dmg' }>[];
    expect(dmg.length).toBeGreaterThan(0);
    for (const d of dmg) {
      expect(d.to).toBe(2);
      expect(d.from).toBe(1);
      expect(Math.hypot(d.dir[0], d.dir[1])).toBeCloseTo(1, 2);
      expect(d.dir[0]).toBeLessThan(0); // attacker is towards -X
    }
    expect(dmg[dmg.length - 1].hp).toBe(0);
    const kill = ev.find((e) => e.e === 'kill') as Extract<GameEvent, { e: 'kill' }>;
    expect(kill).toEqual({ e: 'kill', k: 1, v: 2, w: 'dijla7', hs: expect.any(Number) });
    expect(ev.some((e) => e.e === 'death' && e.id === 2)).toBe(true);
    // The victim never receives the shooter's own-shot echo but the shooter never receives its own 'fire'.
    expect(h.events(1).some((e) => e.e === 'fire')).toBe(false);
    expect(ev.some((e) => e.e === 'fire' && e.id === 1)).toBe(true);
    // A scoreboard goes out immediately on the kill.
    const boards = (h.sent.get(1) ?? []).filter((m) => m.t === 'scoreboard');
    expect(boards.length).toBeGreaterThan(0);
    const last = boards[boards.length - 1];
    if (last.t === 'scoreboard') expect(last.board.teams.tigris).toBe(1);
  });

  it('blocks team damage when friendly fire is off and allows it (without credit) when on', () => {
    const off = duel({ friendlyFire: false }, ['tigris', 'tigris']);
    off.run(60, { 1: { buttons: BTN.ADS | BTN.FIRE } });
    expect(off.match.getPlayer(2)!.state.health).toBe(MAX_HEALTH);
    expect(off.events(2).some((e) => e.e === 'dmg')).toBe(false);
    expect(off.match.getPlayer(1)!.state.weapons[0].ammo).toBeLessThan(WEAPONS.dijla7.magSize);

    const on = duel({ friendlyFire: true }, ['tigris', 'tigris']);
    const tick = fireUntilDead(on, 1, 2);
    expect(tick).not.toBeNull();
    expect(on.match.getPlayer(1)!.kills).toBe(0);
    expect(on.match.getPlayer(1)!.score).toBe(0);
    expect(on.match.getPlayer(2)!.deaths).toBe(1);
    expect(on.match.teamKills('tigris')).toBe(0);
  });

  it('respawns after the configured delay at a valid spawn hidden from enemies', () => {
    const h = duel({ respawnDelaySec: 3 });
    const deathTick = fireUntilDead(h, 1, 2)!;
    const p2 = h.match.getPlayer(2)!;
    // Park the killer where it can see every euphrates spawn; the victim must then use a neutral one.
    h.place(1, { x: 17.5, y: 0, z: -9 }, 0);
    const ticksSoFar = h.match.tick - deathTick;
    h.run(3 * TICK_RATE - ticksSoFar - 1);
    expect(p2.state.alive).toBe(false);
    const snap = [...(h.sent.get(2) ?? [])].reverse().find((m) => m.t === 'snapshot');
    expect(snap && snap.t === 'snapshot' ? snap.snap.respawnIn : undefined).toBeGreaterThan(0);
    h.run(1);
    expect(p2.state.alive).toBe(true);
    expect(p2.state.health).toBe(MAX_HEALTH);
    expect(playerFits(h.match.world, p2.state.pos, 'stand')).toBe(true);
    const isAt = (list: readonly { pos: Vec3 }[]): boolean => list.some((s) => s.pos.x === p2.state.pos.x && s.pos.z === p2.state.pos.z);
    expect(isAt(testArena.spawns.euphrates)).toBe(false);
    expect(isAt(testArena.spawns.neutral)).toBe(true);
    expect(h.events(1).filter((e) => e.e === 'spawn' && e.id === 2).length).toBe(2);
  });

  it('ends on the score limit with the right winner, MVP and results', () => {
    const h = duel({ scoreLimit: 5, respawnDelaySec: 0 });
    for (let k = 0; k < 5; k++) {
      while (!h.match.getPlayer(2)!.state.alive) h.step();
      h.place(2, { x: 0, y: 0, z: 12 }, -Math.PI / 2);
      h.place(1, { x: -10, y: 0, z: 12 }, Math.PI / 2, { buttons: BTN.ADS });
      expect(fireUntilDead(h, 1, 2)).not.toBeNull();
    }
    expect(h.match.phase).toBe('ended');
    expect(h.ended).toHaveLength(1);
    const r = h.ended[0];
    expect(r.winner).toBe('tigris');
    expect(r.reason).toBe('score');
    expect(r.mvpId).toBe(1);
    expect(r.nextMapId).toBe('test_arena');
    expect(r.returnToLobbySec).toBe(12);
    expect(r.scoreboard.teams).toEqual({ tigris: 5, euphrates: 0 });
    expect(r.scoreboard.players[0]).toMatchObject({ id: 1, kills: 5, score: 5 * SCORE_PER_KILL });
    const msgs = h.sent.get(1)!;
    expect(msgs[msgs.length - 1].t).toBe('match.end');
    expect(h.events(2).some((e) => e.e === 'announce' && e.k === 'match_end')).toBe(true);
    expect(h.events(2).some((e) => e.e === 'announce' && e.k === 'lead_taken' && e.team === 'tigris')).toBe(true);
    expect(h.events(2).some((e) => e.e === 'announce' && e.k === 'lead_lost' && e.team === 'euphrates')).toBe(true);
    // Stepping an ended match is a no-op.
    const tick = h.match.tick;
    h.step();
    expect(h.match.tick).toBe(tick);
  });

  it('ends on the time limit with a draw when nobody scored', () => {
    const h = harness({ timeLimitSec: 60 });
    h.addHuman(1, 'tigris');
    h.addHuman(2, 'euphrates');
    h.run(60 * TICK_RATE + 2);
    expect(h.match.phase).toBe('ended');
    expect(h.ended[0].reason).toBe('time');
    expect(h.ended[0].winner).toBe('draw');
    expect(h.ended[0].mvpId).toBeNull();
    const kinds = h.events(1).filter((e) => e.e === 'announce').map((e) => (e as { k: string }).k);
    expect(kinds).toEqual(expect.arrayContaining(['match_start', 'halfway', 'ten_seconds', 'match_end']));
  });

  it('kills players that fall below the kill Z and credits nobody', () => {
    const h = duel();
    const p2 = h.match.getPlayer(2)!;
    p2.state.pos.y = testArena.killZ - 1;
    h.run(2);
    expect(p2.state.alive).toBe(false);
    expect(p2.deaths).toBe(1);
    expect(h.match.getPlayer(1)!.kills).toBe(0);
    const kill = h.events(1).find((e) => e.e === 'kill');
    expect(kill).toEqual({ e: 'kill', k: 2, v: 2, w: 'world', hs: 0 });
  });

  it('validates and acknowledges inputs; movement follows the client intent', () => {
    const h = duel();
    const p2 = h.match.getPlayer(2)!;
    const start = { ...p2.state.pos };
    // A batch with a stale seq, a NaN and an out-of-range strafe: only the good commands count.
    h.match.queueInputs(2, [
      { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, time: 0 },
      { seq: 50, moveX: Number.NaN, moveY: 1, yaw: 0, pitch: 0, buttons: 0, time: 0 },
      { seq: 51, moveX: 5, moveY: 0, yaw: 0, pitch: 0, buttons: 1 << 20, time: 0 },
    ]);
    h.step();
    expect(p2.ack).toBe(51);
    expect(p2.state.vel.x).toBeGreaterThan(0); // moveX clamped to +1 → strafes right (+X when facing +Z)
    h.seqs.set(2, 51);
    h.run(60, { 2: { moveY: 1, yaw: Math.PI } }); // walk -Z down the open lane
    expect(start.z - p2.state.pos.z).toBeGreaterThan(3);
    expect(p2.ack).toBe(111);
    const snaps = (h.sent.get(1) ?? []).filter((m) => m.t === 'snapshot');
    const ticks = snaps.map((m) => (m.t === 'snapshot' ? m.snap.tick : 0));
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    const last = snaps[snaps.length - 1];
    if (last.t === 'snapshot') {
      expect(last.snap.players.map((p) => p.id)).toEqual([2]);
      expect(last.snap.self).toBeDefined();
    }
  });

  it('holds the last input briefly, then drops fire/jump when the client goes quiet', () => {
    const h = duel();
    const p2 = h.match.getPlayer(2)!;
    h.step({ 2: { moveY: 1, yaw: Math.PI, buttons: BTN.FIRE } });
    const ammoAfterFirst = p2.state.weapons[0].ammo;
    expect(ammoAfterFirst).toBe(WEAPONS.dijla7.magSize - 1);
    h.run(40); // no inputs from player 2
    expect(p2.state.vel.z).toBeLessThan(-1); // still walking (-Z) on the held input
    // Fire was cleared after INPUT_HOLD_TICKS, so at most one more shot slipped through.
    expect(p2.state.weapons[0].ammo).toBeGreaterThanOrEqual(ammoAfterFirst - 1);
  });
});

describe('lag compensation', () => {
  /**
   * The victim sprints across the shooter's line of fire. The shooter fires at
   * the spot where the victim was 100 ms ago (what an interpolating client
   * sees). With `timeOffset` = 0 the server rewinds and the shot lands; with
   * +100 ms (T clamped to now) it is traced against the present and misses.
   */
  function scenario(timeOffset: number): { hit: boolean; displacement: number } {
    const h = duel({ respawnDelaySec: 3 });
    const p1 = h.match.getPlayer(1)!;
    const p2 = h.match.getPlayer(2)!;
    // Shooter aims +X from x = -14, slightly downward so the ray crosses the body box at chest height 6 m out.
    const pitch = Math.atan(0.6 / 6);
    h.place(1, { x: -14, y: 0, z: 12 }, Math.PI / 2, { pitch, buttons: BTN.ADS });
    h.place(2, { x: -8, y: 0, z: 9 }, 0);
    const zLog: number[] = [];
    let fired = false;
    let displacement = 0;
    for (let i = 0; i < 200 && !fired; i++) {
      const zAgo = zLog.length >= 6 ? zLog[zLog.length - 6] : -Infinity;
      if (zAgo >= 12) {
        // The victim was on the aim line 6 ticks (= INTERP_DELAY_MS) ago and has since moved on.
        displacement = p2.state.pos.z - zAgo;
        h.step({
          1: { yaw: Math.PI / 2, pitch, buttons: BTN.ADS | BTN.FIRE, time: h.match.time + TICK_MS + timeOffset },
          2: { moveY: 1, yaw: 0, buttons: BTN.SPRINT },
        });
        fired = true;
      } else {
        h.step({ 1: { yaw: Math.PI / 2, pitch, buttons: BTN.ADS }, 2: { moveY: 1, yaw: 0, buttons: BTN.SPRINT } });
        zLog.push(p2.state.pos.z);
      }
    }
    expect(fired).toBe(true);
    expect(p1.state.weapons[0].ammo).toBe(WEAPONS.dijla7.magSize - 1);
    h.run(3); // deliver the snapshot carrying the events
    const hit = h.events(2).some((e) => e.e === 'dmg' && e.to === 2);
    return { hit, displacement };
  }

  it('rewinds targets by the interpolation delay so shots at where a target WAS still land', () => {
    const rewound = scenario(0);
    expect(rewound.displacement).toBeGreaterThan(0.4); // the target moved well past its own hitbox width
    expect(rewound.hit).toBe(true);
    const present = scenario(100);
    expect(present.hit).toBe(false);
  });
});

describe('performance', () => {
  it('simulates 10 participants for 60 seconds well under real time', () => {
    const h = harness({ bots: { mode: 'fixed', tigris: 5, euphrates: 5, difficulty: 'hard', replaceWithHumans: true } }, 5);
    for (let i = 0; i < 5; i++) {
      h.match.addPlayer({ id: 1 + i, name: `T${i}`, team: 'tigris', isBot: true, loadout: DEFAULT_LOADOUT, connected: true });
      h.match.addPlayer({ id: 6 + i, name: `E${i}`, team: 'euphrates', isBot: true, loadout: DEFAULT_LOADOUT, connected: true });
    }
    const ticks = 60 * TICK_RATE;
    const t0 = performance.now();
    h.run(ticks);
    const elapsed = performance.now() - t0;
    expect(h.match.tick).toBe(ticks);
    expect(elapsed).toBeLessThan(15_000);
    const board = h.match.scoreboard();
    expect(board.teams.tigris + board.teams.euphrates).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] 10 bots × ${ticks} ticks in ${elapsed.toFixed(0)} ms (${(ticks / (elapsed / 1000) / TICK_RATE).toFixed(0)}× real time), kills ${board.teams.tigris}-${board.teams.euphrates}`);
  });
});

