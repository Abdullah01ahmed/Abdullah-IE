/**
 * End-to-end server behaviour over real WebSocket connections.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BTN, MAX_PLAYERS, PROTOCOL_VERSION, TEAM_SIZE, type InputCmd } from '@tra/shared';
import type { GameServer } from '../src/Server';
import { TestClient, sleep, startServer, testSettings } from './helpers';

const servers: GameServer[] = [];
const clients: TestClient[] = [];

async function server(opts: Parameters<typeof startServer>[0] = {}): Promise<GameServer> {
  const s = await startServer(opts);
  servers.push(s);
  return s;
}

async function join(port: number, name: string, hello: Record<string, unknown> = {}) {
  const res = await TestClient.join(port, name, hello);
  clients.push(res.client);
  return res;
}

async function welcome(port: number, name: string, hello: Record<string, unknown> = {}) {
  const res = await TestClient.welcome(port, name, hello);
  clients.push(res.client);
  return res;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.terminate();
  for (const s of servers.splice(0)) await s.close();
});

describe('joining', () => {
  it('two clients join, get distinct ids, a room listing both, and the first is host', async () => {
    const s = await server();
    const a = await welcome(s.port, 'Alice');
    const b = await welcome(s.port, 'Bob');
    expect(a.welcome.playerId).not.toBe(b.welcome.playerId);
    expect(a.welcome.tickRate).toBe(60);
    expect(a.welcome.snapshotRate).toBe(20);
    expect(typeof a.welcome.token).toBe('string');
    expect(a.welcome.room.hostId).toBe(a.welcome.playerId);
    expect(a.welcome.room.serverName).toBe('Test Server');
    const room = await a.client.next('room', (m) => m.room.players.length === 2);
    expect(room.room.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(room.room.players.map((p) => p.team)).toEqual(['tigris', 'euphrates']);
    expect(b.welcome.room.players).toHaveLength(2);
  });

  it('enforces the password', async () => {
    const s = await server({ password: 'sesame' });
    const bad = await join(s.port, 'Ali', { password: 'wrong' });
    expect(bad.reply).toMatchObject({ t: 'reject', code: 'BAD_PASSWORD' });
    await bad.client.closedPromise();
    const none = await join(s.port, 'Ali');
    expect(none.reply).toMatchObject({ t: 'reject', code: 'BAD_PASSWORD' });
    const ok = await join(s.port, 'Ali', { password: 'sesame' });
    expect(ok.reply.t).toBe('welcome');
    expect((ok.reply as { room: { passwordProtected: boolean } }).room.passwordProtected).toBe(true);
  });

  it('rejects protocol mismatches, duplicate and invalid names', async () => {
    const s = await server();
    expect((await join(s.port, 'Ali', { version: PROTOCOL_VERSION + 1 })).reply).toMatchObject({ t: 'reject', code: 'VERSION_MISMATCH' });
    await welcome(s.port, 'Ali');
    expect((await join(s.port, 'ali')).reply).toMatchObject({ t: 'reject', code: 'NAME_TAKEN' });
    expect((await join(s.port, '')).reply).toMatchObject({ t: 'reject', code: 'INVALID_NAME' });
    expect((await join(s.port, 'x'.repeat(25))).reply).toMatchObject({ t: 'reject', code: 'INVALID_NAME' });
    const stripped = await welcome(s.port, ' Zai\u0007d ');
    expect(stripped.welcome.room.players.find((p) => p.id === stripped.welcome.playerId)?.name).toBe('Zaid');
  });

  it('answers ping immediately, tolerates garbage, and drops silent or flooding connections', async () => {
    const s = await server({ helloTimeoutMs: 300, rateLimitPerSec: 60 });
    const c = await TestClient.open(s.port);
    clients.push(c);
    c.sendRaw('not json');
    c.sendRaw('{"nope":1}');
    c.send({ t: 'ping', cs: 1234 });
    const pong = await c.next('pong');
    expect(pong.cs).toBe(1234);
    expect(pong.st).toBeGreaterThan(0);
    // No hello → refused with TIMEOUT.
    const rej = await c.next('reject');
    expect(rej.code).toBe('TIMEOUT');
    await c.closedPromise();

    const flood = await welcome(s.port, 'Flood');
    for (let i = 0; i < 100; i++) flood.client.send({ t: 'ping', cs: i });
    const kicked = await flood.client.next('kicked');
    expect(kicked.reason).toBe('RATE_LIMITED');
    await flood.client.closedPromise();
  });

  it('exposes a JSON status endpoint', async () => {
    const s = await server();
    await welcome(s.port, 'One');
    const res = await fetch(`http://127.0.0.1:${s.port}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { players: number; maxPlayers: number; phase: string; protocol: number };
    expect(body).toMatchObject({ players: 1, maxPlayers: MAX_PLAYERS, phase: 'lobby', protocol: PROTOCOL_VERSION });
  });
});

describe('capacity and teams', () => {
  it('admits 10 humans and refuses the 11th with SERVER_FULL', async () => {
    const s = await server();
    for (let i = 0; i < MAX_PLAYERS; i++) await welcome(s.port, `P${i}`);
    const extra = await join(s.port, 'Extra');
    expect(extra.reply).toMatchObject({ t: 'reject', code: 'SERVER_FULL' });
    await extra.client.closedPromise();
    const room = s.room.toState();
    expect(room.players).toHaveLength(MAX_PLAYERS);
    expect(room.players.filter((p) => p.team === 'tigris')).toHaveLength(TEAM_SIZE);
  });

  it('a joining human takes over a bot slot when replaceWithHumans is on', async () => {
    const s = await server({ settings: testSettings({}, { mode: 'fill', replaceWithHumans: true }) });
    expect(s.room.toState().players.filter((p) => p.isBot)).toHaveLength(MAX_PLAYERS);
    const a = await welcome(s.port, 'Human');
    const players = a.welcome.room.players;
    expect(players).toHaveLength(MAX_PLAYERS);
    expect(players.filter((p) => p.isBot)).toHaveLength(MAX_PLAYERS - 1);
    expect(players.filter((p) => p.team === 'tigris')).toHaveLength(TEAM_SIZE);
  });

  it('refuses a human when the server is full and bots may not be replaced', async () => {
    const s = await server({ settings: testSettings({}, { mode: 'fixed', tigris: 4, euphrates: 4, replaceWithHumans: false }) });
    await welcome(s.port, 'H1');
    await welcome(s.port, 'H2');
    const late = await join(s.port, 'H3');
    expect(late.reply).toMatchObject({ t: 'reject', code: 'SERVER_FULL' });
  });

  it('keeps teams unchanged when switching to a full team', async () => {
    const s = await server();
    const all = [];
    for (let i = 0; i < MAX_PLAYERS; i++) all.push(await welcome(s.port, `P${i}`));
    const mover = all[1]; // euphrates
    mover.client.send({ t: 'lobby.team', team: 'tigris' });
    mover.client.send({ t: 'lobby.ready', ready: true });
    const room = await mover.client.next('room', (m) => m.room.players.some((p) => p.id === mover.welcome.playerId && p.ready));
    expect(room.room.players.find((p) => p.id === mover.welcome.playerId)?.team).toBe('euphrates');
    expect(room.room.players.filter((p) => p.team === 'tigris')).toHaveLength(TEAM_SIZE);
    expect(room.room.players.filter((p) => p.team === 'euphrates')).toHaveLength(TEAM_SIZE);
  });
});

describe('match flow', () => {
  it('host start → countdown → match.start → snapshots with acks, movement and other players', async () => {
    const s = await server();
    const a = await welcome(s.port, 'Host');
    const b = await welcome(s.port, 'Guest');
    a.client.send({ t: 'lobby.start' });
    const counting = await a.client.next('room', (m) => m.room.countdown !== null);
    expect(counting.room.countdown).toBeGreaterThan(0);
    const start = await a.client.next('match.start');
    expect(start.match.mapId).toBe('test_arena');
    expect(start.match.matchNumber).toBe(1);
    await b.client.next('match.start');
    a.client.send({ t: 'loaded' });
    b.client.send({ t: 'loaded' });
    await a.client.next('room', (m) => m.room.phase === 'playing');

    const first = await a.client.next('snapshot', (m) => m.snap.self?.alive === true);
    const startPos = first.snap.self!.pos;
    // Walk forward (facing +X out of the tigris spawn) for ~half a second.
    const cmds: InputCmd[] = [];
    for (let seq = 1; seq <= 30; seq++) {
      cmds.push({ seq, moveX: 0, moveY: 1, yaw: Math.PI / 2, pitch: 0, buttons: BTN.SPRINT, time: 0 });
    }
    for (const cmd of cmds) {
      a.client.send({ t: 'input', cmds: [cmd] });
      await sleep(16);
    }
    const acked = await a.client.next('snapshot', (m) => m.snap.ack >= 30);
    expect(acked.snap.ack).toBe(30);
    expect(acked.snap.self!.pos.x).toBeGreaterThan(startPos.x + 1);
    const withOther = await a.client.next('snapshot', (m) => m.snap.players.length === 1);
    expect(withOther.snap.players[0].id).toBe(b.welcome.playerId);
    expect(withOther.snap.players[0].team).toBe('euphrates');
    const ticks = a.client.messages.filter((m) => m.t === 'snapshot').map((m) => (m.t === 'snapshot' ? m.snap.tick : 0));
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    // Snapshots for the guest list the host as the other player.
    const guestSnap = await b.client.next('snapshot', (m) => m.snap.players.length === 1);
    expect(guestSnap.snap.players[0].id).toBe(a.welcome.playerId);
    expect(guestSnap.snap.self).toBeDefined();
    const board = await a.client.next('scoreboard');
    expect(board.board.scoreLimit).toBe(testSettings().scoreLimit);
    expect(board.board.players.map((p) => p.id).sort()).toEqual([a.welcome.playerId, b.welcome.playerId].sort());
  });

  it('ignores settings and start commands from non-hosts', async () => {
    const s = await server();
    const a = await welcome(s.port, 'Host');
    const b = await welcome(s.port, 'Guest');
    await a.client.next('room', (m) => m.room.players.length === 2);
    b.client.send({ t: 'lobby.settings', settings: { scoreLimit: 10, friendlyFire: true } });
    b.client.send({ t: 'lobby.start' });
    b.client.send({ t: 'lobby.addBot', team: 'auto' });
    await sleep(300);
    const state = s.room.toState();
    expect(state.phase).toBe('lobby');
    expect(state.countdown).toBeNull();
    expect(state.settings.scoreLimit).toBe(testSettings().scoreLimit);
    expect(state.settings.friendlyFire).toBe(false);
    expect(state.players).toHaveLength(2);
    expect(b.client.messages.filter((m) => m.t === 'room').length).toBeLessThanOrEqual(1);
  });

  it('marks a dropped client disconnected, lets it reconnect with its token, then removes it after the grace period', async () => {
    const s = await server({ room: { reconnectGraceMs: 1200 } });
    const a = await welcome(s.port, 'Host');
    const b = await welcome(s.port, 'Guest');
    a.client.send({ t: 'lobby.start' });
    await a.client.next('match.start');
    await b.client.next('match.start');
    a.client.send({ t: 'loaded' });
    b.client.send({ t: 'loaded' });
    await a.client.next('room', (m) => m.room.phase === 'playing');

    b.client.terminate();
    const held = await a.client.next('room', (m) => m.room.players.some((p) => p.id === b.welcome.playerId && !p.connected));
    expect(held.room.players).toHaveLength(2);

    const back = await welcome(s.port, 'Guest', { token: b.welcome.token });
    expect(back.welcome.playerId).toBe(b.welcome.playerId);
    expect(back.welcome.match?.matchNumber).toBe(1);
    await a.client.next('room', (m) => m.room.players.some((p) => p.id === b.welcome.playerId && p.connected));
    back.client.send({ t: 'loaded' });
    await back.client.next('snapshot', (m) => m.snap.self?.alive === true);

    back.client.terminate();
    await a.client.next('room', (m) => m.room.players.some((p) => p.id === b.welcome.playerId && !p.connected));
    const gone = await a.client.next('room', (m) => !m.room.players.some((p) => p.id === b.welcome.playerId), 5000);
    expect(gone.room.players.map((p) => p.id)).toEqual([a.welcome.playerId]);
  });

  it('kicks connected clients with SERVER_SHUTDOWN when the server closes', async () => {
    const s = await server();
    const a = await welcome(s.port, 'Host');
    await s.close();
    servers.pop();
    const kicked = a.client.last('kicked') ?? (await a.client.next('kicked'));
    expect(kicked.reason).toBe('SERVER_SHUTDOWN');
    await a.client.closedPromise();
  });
});
