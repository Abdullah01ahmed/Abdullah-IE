/**
 * Room / lobby logic without sockets: teams, bots, host commands, phases,
 * reconnection grace and the TEAM_SIZE invariant under random operations.
 */
import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES,
  DEFAULT_MATCH_SETTINGS,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  TEAM_SIZE,
  mulberry32,
  type BotFillMode,
  type RoomState,
  type Team,
} from '@tra/shared';
import { sanitizeName, sanitizeSettings } from '../src/Room';
import { FakeLink, makeRoom, testSettings } from './helpers';

function teamSizes(state: RoomState): Record<Team, number> {
  const out: Record<Team, number> = { tigris: 0, euphrates: 0 };
  for (const p of state.players) out[p.team]++;
  return out;
}

function assertInvariants(state: RoomState): void {
  const sizes = teamSizes(state);
  expect(sizes.tigris).toBeLessThanOrEqual(TEAM_SIZE);
  expect(sizes.euphrates).toBeLessThanOrEqual(TEAM_SIZE);
  expect(state.players.length).toBeLessThanOrEqual(MAX_PLAYERS);
  const names = state.players.map((p) => p.name.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
  const ids = state.players.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
  if (state.hostId !== null) {
    const host = state.players.find((p) => p.id === state.hostId);
    expect(host && !host.isBot && host.connected).toBe(true);
  }
}

describe('Room: joining and teams', () => {
  it('makes the first human host and auto-balances alternating teams', () => {
    const h = makeRoom();
    const a = h.join('Alice');
    const b = h.join('Bob');
    const c = h.join('Cara');
    const s = h.room.toState();
    expect(s.hostId).toBe(a.id);
    expect(s.players.map((p) => p.team)).toEqual(['tigris', 'euphrates', 'tigris']);
    expect(a.link.last('welcome')?.playerId).toBe(a.id);
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
    h.run(1);
    expect(a.link.count('room')).toBe(1); // three joins coalesced into one broadcast
    expect(a.link.last('room')?.room.players).toHaveLength(3);
  });

  it('validates version, password and names', () => {
    const h = makeRoom({ password: 'secret' });
    const link = new FakeLink();
    expect(h.room.join({ name: 'A', version: PROTOCOL_VERSION + 1, password: 'secret', link })).toMatchObject({ ok: false, code: 'VERSION_MISMATCH' });
    expect(h.room.join({ name: 'A', version: PROTOCOL_VERSION, password: 'nope', link })).toMatchObject({ ok: false, code: 'BAD_PASSWORD' });
    expect(h.room.join({ name: '   ', version: PROTOCOL_VERSION, password: 'secret', link })).toMatchObject({ ok: false, code: 'INVALID_NAME' });
    expect(h.room.join({ name: 'x'.repeat(21), version: PROTOCOL_VERSION, password: 'secret', link })).toMatchObject({ ok: false, code: 'INVALID_NAME' });
    expect(h.room.join({ name: 42, version: PROTOCOL_VERSION, password: 'secret', link })).toMatchObject({ ok: false, code: 'INVALID_NAME' });
    expect(h.room.join({ name: 'Al\u0007ice', version: PROTOCOL_VERSION, password: 'secret', link })).toMatchObject({ ok: true });
    expect(h.room.toState().players[0].name).toBe('Alice');
    expect(h.room.join({ name: 'alice', version: PROTOCOL_VERSION, password: 'secret', link })).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
    expect(sanitizeName('  Zaid   al-Basri ')).toBe('Zaid al-Basri');
    expect(sanitizeName('')).toBeNull();
  });

  it('refuses the 11th human with SERVER_FULL', () => {
    const h = makeRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) h.join(`P${i}`);
    const link = new FakeLink();
    expect(h.room.join({ name: 'Extra', version: PROTOCOL_VERSION, link })).toMatchObject({ ok: false, code: 'SERVER_FULL' });
    assertInvariants(h.room.toState());
  });

  it('leaves teams unchanged when switching to a full team, and balances on auto', () => {
    const h = makeRoom();
    const players = Array.from({ length: MAX_PLAYERS }, (_, i) => h.join(`P${i}`));
    const before = h.room.toState().players.map((p) => p.team);
    h.room.handleMessage(players[1].id, { t: 'lobby.team', team: 'tigris' });
    expect(h.room.toState().players.map((p) => p.team)).toEqual(before);
    h.room.removePlayer(players[0].id);
    // Tigris now has 4: an euphrates player asking for auto balance moves over.
    h.room.handleMessage(players[1].id, { t: 'lobby.team', team: 'auto' });
    expect(h.room.toState().players.find((p) => p.id === players[1].id)?.team).toBe('tigris');
    assertInvariants(h.room.toState());
  });

  it('passes the host role on when the host leaves', () => {
    const h = makeRoom();
    const a = h.join('A');
    const b = h.join('B');
    h.room.handleMessage(a.id, { t: 'leave' });
    expect(a.link.closed).toBe(true);
    expect(h.room.hostId).toBe(b.id);
    expect(h.room.toState().players.map((p) => p.id)).toEqual([b.id]);
  });
});

describe('Room: bots', () => {
  it('fixed mode keeps exact counts clamped to the free slots', () => {
    const h = makeRoom({ settings: testSettings({}, { mode: 'fixed', tigris: 3, euphrates: 2 }) });
    let s = h.room.toState();
    expect(s.players.filter((p) => p.isBot && p.team === 'tigris')).toHaveLength(3);
    expect(s.players.filter((p) => p.isBot && p.team === 'euphrates')).toHaveLength(2);
    for (let i = 0; i < 4; i++) h.join(`T${i}`, {}), h.room.handleMessage(i + 100, { t: 'lobby.team', team: 'tigris' });
    // Four humans forced onto tigris → only two slots remain for its three configured bots.
    const humans = h.room.toState().players.filter((p) => !p.isBot);
    for (const p of humans) h.room.handleMessage(p.id, { t: 'lobby.team', team: 'tigris' });
    s = h.room.toState();
    const sizes = teamSizes(s);
    expect(sizes.tigris).toBeLessThanOrEqual(TEAM_SIZE);
    expect(s.players.filter((p) => !p.isBot && p.team === 'tigris').length + s.players.filter((p) => p.isBot && p.team === 'tigris').length).toBe(sizes.tigris);
    expect(s.players.filter((p) => p.isBot && p.team === 'tigris').length).toBe(Math.min(3, TEAM_SIZE - s.players.filter((p) => !p.isBot && p.team === 'tigris').length));
    assertInvariants(s);
  });

  it('fill mode keeps both teams at five around the humans and re-evaluates on switches', () => {
    const h = makeRoom({ settings: testSettings({}, { mode: 'fill' }) });
    expect(h.room.toState().players).toHaveLength(MAX_PLAYERS);
    const a = h.join('A');
    const b = h.join('B');
    let s = h.room.toState();
    expect(s.players).toHaveLength(MAX_PLAYERS);
    expect(teamSizes(s)).toEqual({ tigris: 5, euphrates: 5 });
    expect(s.players.filter((p) => !p.isBot).map((p) => p.team)).toEqual(['tigris', 'euphrates']);
    h.room.handleMessage(b.id, { t: 'lobby.team', team: 'tigris' });
    s = h.room.toState();
    expect(s.players.find((p) => p.id === b.id)?.team).toBe('tigris');
    expect(teamSizes(s)).toEqual({ tigris: 5, euphrates: 5 });
    expect(s.players.filter((p) => p.isBot && p.team === 'tigris')).toHaveLength(3);
    expect(s.players.filter((p) => p.isBot && p.team === 'euphrates')).toHaveLength(5);
    h.room.removePlayer(a.id);
    s = h.room.toState();
    expect(teamSizes(s)).toEqual({ tigris: 5, euphrates: 5 });
    expect(s.players.filter((p) => p.isBot)).toHaveLength(9);
    assertInvariants(s);
  });

  it('a joining human takes over a bot slot only when replaceWithHumans is on', () => {
    const on = makeRoom({ settings: testSettings({}, { mode: 'fill', replaceWithHumans: true }) });
    const first = on.join('Human');
    expect(on.room.toState().players).toHaveLength(MAX_PLAYERS);
    expect(on.room.toState().players.find((p) => p.id === first.id)?.team).toBe('tigris');

    const off = makeRoom({ settings: testSettings({}, { mode: 'fixed', tigris: 5, euphrates: 4, replaceWithHumans: false }) });
    off.join('Only'); // the one free euphrates slot
    expect(off.room.toState().players.find((p) => !p.isBot)?.team).toBe('euphrates');
    const link = new FakeLink();
    expect(off.room.join({ name: 'Late', version: PROTOCOL_VERSION, link })).toMatchObject({ ok: false, code: 'SERVER_FULL' });
    expect(off.room.toState().players).toHaveLength(MAX_PLAYERS);
  });

  it('host can add, remove and retune bots; a human joining with a bot name renames the bot', () => {
    const h = makeRoom();
    const host = h.join('Host');
    h.room.handleMessage(host.id, { t: 'lobby.addBot', team: 'euphrates', difficulty: 'hard' });
    h.room.handleMessage(host.id, { t: 'lobby.addBot', team: 'auto' });
    let s = h.room.toState();
    const bots = s.players.filter((p) => p.isBot);
    expect(bots).toHaveLength(2);
    expect(bots[0].team).toBe('euphrates');
    expect(bots[0].botDifficulty).toBe('hard');
    expect(bots[1].botDifficulty).toBe(DEFAULT_MATCH_SETTINGS.bots.difficulty);
    expect(s.settings.bots.mode).toBe('fixed');
    expect(bots.every((b) => BOT_NAMES.includes(b.name))).toBe(true);
    h.room.handleMessage(host.id, { t: 'lobby.botDifficulty', playerId: bots[1].id, difficulty: 'extreme' });
    expect(h.room.toState().players.find((p) => p.id === bots[1].id)?.botDifficulty).toBe('extreme');
    const stolenName = bots[0].name;
    h.join(stolenName);
    s = h.room.toState();
    expect(s.players.filter((p) => p.name.toLowerCase() === stolenName.toLowerCase())).toHaveLength(1);
    expect(s.players.find((p) => p.id === bots[0].id)?.name).not.toBe(stolenName);
    h.room.handleMessage(host.id, { t: 'lobby.removeBot', playerId: bots[0].id });
    s = h.room.toState();
    expect(s.players.filter((p) => p.isBot)).toHaveLength(1);
    expect(s.settings.bots.euphrates).toBe(0);
    h.room.handleMessage(host.id, { t: 'lobby.kick', playerId: bots[1].id });
    expect(h.room.toState().players.filter((p) => p.isBot)).toHaveLength(0);
    assertInvariants(h.room.toState());
  });

  it('never exceeds TEAM_SIZE across random joins, switches, leaves and bot changes', () => {
    const rng = mulberry32(2024);
    const h = makeRoom();
    const modes: BotFillMode[] = ['none', 'fixed', 'fill'];
    let counter = 0;
    for (let i = 0; i < 600; i++) {
      const state = h.room.toState();
      const humans = state.players.filter((p) => !p.isBot);
      const bots = state.players.filter((p) => p.isBot);
      const host = state.hostId ?? -1;
      const op = Math.floor(rng() * 9);
      switch (op) {
        case 0:
        case 1: {
          const link = new FakeLink();
          const res = h.room.join({ name: `H${counter++}`, version: PROTOCOL_VERSION, link });
          if (!res.ok) expect(res.code).toBe('SERVER_FULL');
          break;
        }
        case 2:
          if (humans.length) h.room.handleMessage(humans[Math.floor(rng() * humans.length)].id, { t: 'leave' });
          break;
        case 3:
          if (humans.length) {
            const teams: (Team | 'auto')[] = ['tigris', 'euphrates', 'auto'];
            h.room.handleMessage(humans[Math.floor(rng() * humans.length)].id, { t: 'lobby.team', team: teams[Math.floor(rng() * 3)] });
          }
          break;
        case 4:
          h.room.handleMessage(host, {
            t: 'lobby.settings',
            settings: {
              bots: {
                mode: modes[Math.floor(rng() * 3)],
                tigris: Math.floor(rng() * 7),
                euphrates: Math.floor(rng() * 7),
                difficulty: 'normal',
                replaceWithHumans: rng() < 0.5,
              },
            },
          });
          break;
        case 5:
          h.room.handleMessage(host, { t: 'lobby.addBot', team: rng() < 0.5 ? 'auto' : rng() < 0.5 ? 'tigris' : 'euphrates' });
          break;
        case 6:
          if (bots.length) h.room.handleMessage(host, { t: 'lobby.removeBot', playerId: bots[Math.floor(rng() * bots.length)].id });
          break;
        case 7:
          if (state.players.length) h.room.handleMessage(host, { t: 'lobby.kick', playerId: state.players[Math.floor(rng() * state.players.length)].id });
          break;
        case 8:
          h.run(1);
          break;
      }
      assertInvariants(h.room.toState());
    }
  });
});

describe('Room: host commands and phases', () => {
  it('ignores settings/start from non-hosts and sanitises host settings', () => {
    const h = makeRoom();
    const host = h.join('Host');
    const other = h.join('Other');
    h.room.handleMessage(other.id, { t: 'lobby.settings', settings: { scoreLimit: 10 } });
    h.room.handleMessage(other.id, { t: 'lobby.start' });
    expect(h.room.settings.scoreLimit).toBe(DEFAULT_MATCH_SETTINGS.scoreLimit);
    expect(h.room.countdownSeconds).toBeNull();
    h.room.handleMessage(host.id, { t: 'lobby.settings', settings: { scoreLimit: 100000, mapId: 'moon', mode: 'dom', timeLimitSec: 10, respawnDelaySec: 4.4, friendlyFire: true } as never });
    expect(h.room.settings).toMatchObject({ scoreLimit: 500, mapId: 'test_arena', mode: 'tdm', timeLimitSec: 60, respawnDelaySec: 4, friendlyFire: true });
    expect(sanitizeSettings({ mapRotation: ['nope', 'shanasheel'] }, h.room.settings).mapRotation).toEqual(['shanasheel']);
    expect(sanitizeSettings(null, h.room.settings)).toEqual(h.room.settings);
  });

  it('runs lobby → countdown → loading → playing → results → lobby', () => {
    const h = makeRoom({ settings: testSettings({ scoreLimit: 5, timeLimitSec: 60 }) });
    const a = h.join('A');
    const b = h.join('B');
    h.room.handleMessage(a.id, { t: 'lobby.start' });
    expect(h.room.countdownSeconds).toBe(1);
    h.run(1);
    expect(a.link.last('room')?.room.countdown).toBe(1);
    h.room.handleMessage(a.id, { t: 'lobby.cancelStart' });
    h.run(1);
    expect(a.link.last('room')?.room.countdown).toBeNull();
    h.room.handleMessage(a.id, { t: 'lobby.start' });
    h.runSeconds(1.05);
    expect(h.room.phase).toBe('loading');
    expect(a.link.count('match.start')).toBe(1);
    expect(b.link.last('match.start')?.match.mapId).toBe('test_arena');
    expect(a.link.last('room')?.room.matchNumber).toBe(1);
    h.room.handleMessage(a.id, { t: 'loaded' });
    h.room.handleMessage(b.id, { t: 'loaded' });
    h.run(1);
    expect(h.room.phase).toBe('playing');
    h.run(6);
    expect(a.link.count('snapshot')).toBeGreaterThanOrEqual(2);
    const snap = a.link.last('snapshot')!.snap;
    expect(snap.self?.alive).toBe(true);
    expect(snap.players.map((p) => p.id)).toEqual([b.id]);
    // Finish by the time limit.
    h.runSeconds(61);
    expect(h.room.phase).toBe('results');
    expect(a.link.last('match.end')?.results.reason).toBe('time');
    expect(a.link.last('room')?.room.phase).toBe('results');
    h.runSeconds(2.1);
    expect(h.room.phase).toBe('lobby');
    expect(h.room.match).toBeNull();
    expect(h.room.toState().players.every((p) => !p.ready)).toBe(true);
    expect(h.room.settings.mapId).toBe('test_arena');
  });

  it('returns to the lobby early once every human has continued', () => {
    const h = makeRoom({ settings: testSettings({ timeLimitSec: 60 }) });
    const a = h.join('A');
    h.room.handleMessage(a.id, { t: 'lobby.start' });
    h.runSeconds(1.05);
    h.room.handleMessage(a.id, { t: 'loaded' });
    h.runSeconds(61);
    expect(h.room.phase).toBe('results');
    h.room.handleMessage(a.id, { t: 'match.continue' });
    h.run(1);
    expect(h.room.phase).toBe('lobby');
  });

  it('dedicated servers have no host and auto-start when everyone is ready or after the wait', () => {
    const h = makeRoom({ dedicated: true, dedicatedCountdownSec: 1, dedicatedAutoStartSec: 5 });
    const a = h.join('A');
    expect(h.room.hostId).toBeNull();
    h.room.handleMessage(a.id, { t: 'lobby.start' }); // nobody is host on a dedicated server
    h.run(1);
    expect(h.room.countdownSeconds).toBeNull();
    h.room.handleMessage(a.id, { t: 'lobby.ready', ready: true });
    h.run(1);
    expect(h.room.countdownSeconds).toBe(1);
    h.runSeconds(1.05);
    expect(h.room.phase).toBe('loading');

    const late = makeRoom({ dedicated: true, dedicatedCountdownSec: 1, dedicatedAutoStartSec: 5 });
    late.join('Idle');
    late.runSeconds(4.5);
    expect(late.room.countdownSeconds).toBeNull();
    late.runSeconds(0.6);
    expect(late.room.countdownSeconds).toBe(1);
  });

  it('broadcasts chat with the sender name and team', () => {
    const h = makeRoom();
    const a = h.join('A');
    const b = h.join('B');
    h.room.handleMessage(a.id, { t: 'chat', text: '  marhaba \u0000 ' });
    expect(b.link.last('chat')).toEqual({ t: 'chat', from: a.id, name: 'A', team: 'tigris', text: 'marhaba' });
    h.room.handleMessage(a.id, { t: 'chat', text: '   ' });
    expect(b.link.count('chat')).toBe(1);
  });

  it('kicks humans with a message and closes their link', () => {
    const h = makeRoom();
    const a = h.join('A');
    const b = h.join('B');
    h.room.handleMessage(b.id, { t: 'lobby.kick', playerId: a.id }); // not host
    expect(h.room.toState().players).toHaveLength(2);
    h.room.handleMessage(a.id, { t: 'lobby.kick', playerId: b.id });
    expect(b.link.last('kicked')?.reason).toBe('KICKED');
    expect(b.link.closed).toBe(true);
    expect(h.room.toState().players.map((p) => p.id)).toEqual([a.id]);
  });
});

describe('Room: disconnects and reconnection', () => {
  function startedMatch() {
    const h = makeRoom({ reconnectGraceMs: 2000, settings: testSettings({}, { mode: 'fill' }) });
    const a = h.join('A');
    const b = h.join('B');
    h.room.handleMessage(a.id, { t: 'lobby.start' });
    h.runSeconds(1.05);
    h.room.handleMessage(a.id, { t: 'loaded' });
    h.room.handleMessage(b.id, { t: 'loaded' });
    h.run(2);
    expect(h.room.phase).toBe('playing');
    return { h, a, b };
  }

  it('removes players immediately in the lobby', () => {
    const h = makeRoom();
    h.join('A');
    const b = h.join('B');
    h.room.disconnect(b.id);
    expect(h.room.toState().players.map((p) => p.name)).toEqual(['A']);
  });

  it('holds a mid-match slot for the grace period, then removes and refills it', () => {
    const { h, a, b } = startedMatch();
    h.room.disconnect(b.id);
    h.run(1);
    let s = a.link.last('room')!.room;
    expect(s.players.find((p) => p.id === b.id)).toMatchObject({ connected: false, isBot: false });
    expect(s.players).toHaveLength(MAX_PLAYERS);
    expect(h.room.match!.getPlayer(b.id)!.connected).toBe(false);
    h.runSeconds(1.5);
    expect(h.room.toState().players.some((p) => p.id === b.id)).toBe(true);
    h.runSeconds(0.6);
    s = h.room.toState();
    expect(s.players.some((p) => p.id === b.id)).toBe(false);
    expect(teamSizes(s)).toEqual({ tigris: 5, euphrates: 5 }); // bot fill re-evaluated
    expect(h.room.match!.getPlayer(b.id)).toBeUndefined();
  });

  it('reconnects with the token (or the same name) to the same player id, keeping team and score', () => {
    const { h, a, b } = startedMatch();
    const mp = h.room.match!.getPlayer(b.id)!;
    mp.kills = 3;
    mp.score = 300;
    h.room.disconnect(b.id);
    h.runSeconds(1);
    const link2 = new FakeLink();
    const res = h.room.join({ name: 'B', version: PROTOCOL_VERSION, token: b.token, link: link2 });
    expect(res).toMatchObject({ ok: true, playerId: b.id, reconnected: true });
    const welcome = link2.last('welcome')!;
    expect(welcome.match?.matchNumber).toBe(1);
    expect(welcome.room.players.find((p) => p.id === b.id)).toMatchObject({ connected: true, team: 'euphrates', score: 300, kills: 3 });
    expect(h.room.match!.getPlayer(b.id)).toBe(mp);
    h.room.handleMessage(b.id, { t: 'loaded' });
    h.run(3);
    expect(link2.count('snapshot')).toBeGreaterThan(0);

    // A different client using only the name also resumes the slot.
    h.room.disconnect(b.id);
    h.run(1);
    const link3 = new FakeLink();
    expect(h.room.join({ name: 'b', version: PROTOCOL_VERSION, link: link3 })).toMatchObject({ ok: true, playerId: b.id, reconnected: true });
    // While the ghost is connected the name is simply taken.
    expect(h.room.join({ name: 'B', version: PROTOCOL_VERSION, link: new FakeLink() })).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
    expect(a.link.closed).toBe(false);
  });

  it('forfeits the match when no humans remain', () => {
    const { h, a, b } = startedMatch();
    h.room.handleMessage(a.id, { t: 'leave' });
    h.room.handleMessage(b.id, { t: 'leave' });
    expect(h.room.phase).toBe('results');
    expect(h.room.match?.results?.reason).toBe('forfeit');
  });
});
