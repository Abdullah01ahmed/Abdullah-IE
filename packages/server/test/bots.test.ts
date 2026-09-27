/**
 * Bot behaviour: difficulty differentiation, perception limits and basic sanity.
 */
import { describe, expect, it } from 'vitest';
import {
  BOT_PROFILES,
  BTN,
  DEFAULT_LOADOUT,
  TICK_RATE,
  createPlayerState,
  testArena,
  type BotDifficultyId,
  type InputCmd,
  type MatchResults,
} from '@tra/shared';
import { BotBrain, getNavGrid, type BotSenses } from '../src/Bots';
import { Match, getWorld } from '../src/Match';
import { TICK_MS } from '../src/clock';
import { testSettings } from './helpers';

function botMatch(a: BotDifficultyId, b: BotDifficultyId, seed = 1): Match {
  const settings = testSettings({ scoreLimit: 500, timeLimitSec: 3600, bots: { mode: 'fixed', tigris: 5, euphrates: 5, difficulty: a, replaceWithHumans: true } });
  const match = new Match({ map: testArena, settings, seed, startTick: 0, startTime: 0, matchNumber: 1 }, {
    send: () => undefined,
    onLive: () => undefined,
    onEnd: (_r: MatchResults) => undefined,
  });
  for (let i = 0; i < 5; i++) {
    match.addPlayer({ id: 1 + i, name: `A${i}`, team: 'tigris', isBot: true, botDifficulty: a, loadout: DEFAULT_LOADOUT, connected: true });
    match.addPlayer({ id: 6 + i, name: `B${i}`, team: 'euphrates', isBot: true, botDifficulty: b, loadout: DEFAULT_LOADOUT, connected: true });
  }
  return match;
}

function runSeconds(match: Match, seconds: number): void {
  const ticks = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < ticks; i++) match.step(match.time + TICK_MS);
}

describe('bot difficulty', () => {
  it('5 extreme bots beat 5 easy bots decisively on test_arena', () => {
    const match = botMatch('extreme', 'easy', 3);
    runSeconds(match, 90);
    const board = match.scoreboard();
    const extreme = board.teams.tigris;
    const easy = board.teams.euphrates;
    expect(extreme).toBeGreaterThan(easy * 3);
    expect(extreme).toBeGreaterThanOrEqual(20);
  });

  it('difficulty is monotonic: each preset out-frags the one below it', () => {
    const pairs: [BotDifficultyId, BotDifficultyId][] = [['normal', 'easy'], ['hard', 'normal'], ['extreme', 'hard']];
    for (const [hi, lo] of pairs) {
      const match = botMatch(hi, lo, 3);
      runSeconds(match, 60);
      const board = match.scoreboard();
      expect(board.teams.tigris, `${hi} vs ${lo}`).toBeGreaterThan(board.teams.euphrates);
    }
  });

  it('bots leave their spawns, fight, and the simulation is reproducible for a seed', () => {
    const a = botMatch('normal', 'normal', 11);
    const b = botMatch('normal', 'normal', 11);
    runSeconds(a, 45);
    runSeconds(b, 45);
    const boardA = a.scoreboard();
    expect(boardA.teams.tigris + boardA.teams.euphrates).toBeGreaterThan(0);
    for (const p of a.players.values()) {
      const spawnX = p.team === 'tigris' ? -17.5 : 17.5;
      expect(Math.abs(p.state.pos.x - spawnX) > 1 || !p.state.alive || p.deaths > 0).toBe(true);
    }
    for (const p of a.players.values()) {
      const q = b.getPlayer(p.id)!;
      expect(q.state.pos).toEqual(p.state.pos);
      expect(q.kills).toBe(p.kills);
    }
  });
});

describe('BotBrain perception', () => {
  const world = getWorld(testArena);

  function brain(id = 1, difficulty: BotDifficultyId = 'extreme'): BotBrain {
    return new BotBrain({ id, team: 'tigris', profile: BOT_PROFILES[difficulty], seed: 99, map: testArena, world });
  }

  function senses(selfPos: { x: number; z: number }, yaw: number, enemyPos: { x: number; z: number }, timeMs: number): BotSenses {
    const self = createPlayerState({ x: selfPos.x, y: 0, z: selfPos.z }, yaw, 'dijla7', 'shatt9');
    self.onGround = true;
    return {
      timeMs,
      self,
      others: [{ id: 2, team: 'euphrates', pos: { x: enemyPos.x, y: 0, z: enemyPos.z }, stance: 'stand', alive: true }],
      shots: [],
    };
  }

  it('caches one nav grid per map', () => {
    expect(getNavGrid(testArena, world)).toBe(getNavGrid(testArena, world));
  });

  it('fires at a visible enemy after its reaction time', () => {
    const b = brain();
    const first = createPlayerState({ x: -10, y: 0, z: 12 }, Math.PI / 2, 'dijla7', 'shatt9');
    b.onSpawn(first);
    let firstFireMs: number | null = null;
    for (let t = 0; t < 3 * TICK_RATE; t++) {
      const now = t * TICK_MS;
      const cmd: InputCmd = b.think(senses({ x: -10, z: 12 }, Math.PI / 2, { x: 0, z: 12 }, now), t + 1);
      if (cmd.buttons & BTN.FIRE) { firstFireMs = now; break; }
    }
    expect(firstFireMs).not.toBeNull();
    expect(firstFireMs!).toBeGreaterThanOrEqual(BOT_PROFILES.extreme.reactionTime * 1000 - TICK_MS);
    expect(firstFireMs!).toBeLessThan(1500);
  });

  it('never fires at an enemy it cannot see (behind the central platform)', () => {
    const b = brain();
    b.onSpawn(createPlayerState({ x: -10, y: 0, z: 0 }, Math.PI / 2, 'dijla7', 'shatt9'));
    for (let t = 0; t < 5 * TICK_RATE; t++) {
      const cmd = b.think(senses({ x: -10, z: 0 }, Math.PI / 2, { x: 10, z: 0 }, t * TICK_MS), t + 1);
      expect(cmd.buttons & BTN.FIRE).toBe(0);
    }
  });

  it('ignores an enemy behind its back until it turns', () => {
    const b = brain(1, 'easy'); // 100° field of view
    b.onSpawn(createPlayerState({ x: -10, y: 0, z: 12 }, -Math.PI / 2, 'dijla7', 'shatt9'));
    // Enemy at +X while the bot faces -X: outside the FOV, so no reaction in the first half second.
    for (let t = 0; t < TICK_RATE / 2; t++) {
      const cmd = b.think(senses({ x: -10, z: 12 }, -Math.PI / 2, { x: 0, z: 12 }, t * TICK_MS), t + 1);
      expect(cmd.buttons & BTN.FIRE).toBe(0);
      expect(cmd.buttons & BTN.ADS).toBe(0);
    }
  });

  it('does nothing while dead', () => {
    const b = brain();
    const s = senses({ x: -10, z: 12 }, Math.PI / 2, { x: 0, z: 12 }, 5000);
    s.self.alive = false;
    const cmd = b.think(s, 1);
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveY).toBe(0);
    expect(cmd.buttons).toBe(0);
  });
});
