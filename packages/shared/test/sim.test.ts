import { describe, expect, it } from 'vitest';
import {
  BTN,
  MOVEMENT,
  TICK_DT,
  WEAPONS,
  aimDirection,
  buildCollisionWorld,
  buildNavGrid,
  clonePlayerState,
  computeShot,
  createPlayerState,
  damageAtDistance,
  findPath,
  largestComponent,
  lineOfSight,
  nearestNode,
  raycastWorld,
  simulateStep,
  stepWeapons,
  testArena,
  traceShot,
  type InputCmd,
  type PlayerSimState,
} from '../src';

const world = buildCollisionWorld(testArena);

function cmd(seq: number, partial: Partial<InputCmd> = {}): InputCmd {
  return { seq, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, time: 0, ...partial };
}

function run(s: PlayerSimState, input: Partial<InputCmd>, ticks: number): void {
  for (let i = 0; i < ticks; i++) simulateStep(s, cmd(i + 1, input), world, TICK_DT);
}

function settle(s: PlayerSimState): void {
  run(s, {}, 60);
}

describe('movement', () => {
  it('falls to the ground and rests on it', () => {
    const s = createPlayerState({ x: -10, y: 2, z: 0 }, 0, 'dijla7', 'shatt9');
    settle(s);
    expect(s.onGround).toBe(true);
    expect(s.pos.y).toBeCloseTo(0, 2);
    expect(s.vel.y).toBe(0);
  });

  it('walks forward at walk speed and sprints faster', () => {
    const s = createPlayerState({ x: -10, y: 0, z: -10 }, 0, 'dijla7', 'shatt9');
    settle(s);
    const start = { ...s.pos };
    run(s, { moveY: 1 }, 60);
    const walked = Math.hypot(s.pos.x - start.x, s.pos.z - start.z);
    // Roughly walkSpeed * weapon multiplier for ~1 s (minus acceleration ramp).
    expect(walked).toBeGreaterThan(MOVEMENT.walkSpeed * 0.8);
    expect(walked).toBeLessThan(MOVEMENT.sprintSpeed);

    const s2 = createPlayerState({ x: -10, y: 0, z: -10 }, 0, 'dijla7', 'shatt9');
    settle(s2);
    run(s2, { moveY: 1, buttons: BTN.SPRINT }, 60);
    const sprinted = Math.hypot(s2.pos.x + 10, s2.pos.z + 10);
    expect(sprinted).toBeGreaterThan(walked * 1.2);
    expect(s2.sprinting).toBe(true);
  });

  it('is stopped by walls', () => {
    // Perimeter wall at x = -20 (thickness 1 → inner face at x = -20).
    const s = createPlayerState({ x: -18, y: 0, z: 0 }, -Math.PI / 2, 'dijla7', 'shatt9');
    settle(s);
    run(s, { moveY: 1, yaw: -Math.PI / 2 }, 120); // face -X
    expect(s.pos.x).toBeGreaterThan(-20 + MOVEMENT.capsuleRadius - 0.01);
    expect(s.pos.x).toBeLessThan(-19.5);
  });

  it('climbs stairs onto the platform', () => {
    // Stairs from z=-8 rising north to the platform top (2.4 m) at z=-4.
    const s = createPlayerState({ x: 0, y: 0, z: -11 }, 0, 'dijla7', 'shatt9');
    settle(s);
    run(s, { moveY: 1, yaw: 0 }, 180);
    expect(s.pos.y).toBeGreaterThan(2.3);
    expect(s.onGround).toBe(true);
  });

  it('jumps and lands', () => {
    const s = createPlayerState({ x: -10, y: 0, z: 5 }, 0, 'dijla7', 'shatt9');
    settle(s);
    simulateStep(s, cmd(1, { buttons: BTN.JUMP }), world, TICK_DT);
    expect(s.onGround).toBe(false);
    let maxY = 0;
    for (let i = 0; i < 90; i++) {
      simulateStep(s, cmd(i + 2, {}), world, TICK_DT);
      maxY = Math.max(maxY, s.pos.y);
    }
    expect(maxY).toBeGreaterThan(0.8);
    expect(maxY).toBeLessThan(1.4);
    expect(s.onGround).toBe(true);
    expect(s.pos.y).toBeCloseTo(0, 2);
  });

  it('holding jump does not bunny-hop repeatedly', () => {
    const s = createPlayerState({ x: -10, y: 0, z: 5 }, 0, 'dijla7', 'shatt9');
    settle(s);
    let jumps = 0;
    for (let i = 0; i < 180; i++) {
      const r = simulateStep(s, cmd(i + 1, { buttons: BTN.JUMP }), world, TICK_DT);
      if (r.jumped) jumps++;
    }
    expect(jumps).toBe(1);
  });

  it('mantles a 1.1 m ledge when jumping into it', () => {
    // Ledge block at x 6..9, z 6..9, height 1.1
    const s = createPlayerState({ x: 7.5, y: 0, z: 4.5 }, 0, 'dijla7', 'shatt9');
    settle(s);
    let mantled = false;
    for (let i = 0; i < 45; i++) {
      const r = simulateStep(s, cmd(i + 1, { moveY: 1, buttons: i < 3 ? BTN.JUMP : 0 }), world, TICK_DT);
      mantled ||= r.mantled;
    }
    expect(mantled).toBe(true);
    expect(s.pos.y).toBeGreaterThan(1.05);
    expect(s.onGround).toBe(true);
  });

  it('crouches and slides from a sprint', () => {
    const s = createPlayerState({ x: -12, y: 0, z: -12 }, 0, 'dijla7', 'shatt9');
    settle(s);
    run(s, { moveY: 1, buttons: BTN.SPRINT }, 40);
    let slid = false;
    for (let i = 0; i < 10; i++) {
      const r = simulateStep(s, cmd(100 + i, { moveY: 1, buttons: BTN.SPRINT | BTN.CROUCH }), world, TICK_DT);
      if (r.slideStarted) slid = true;
    }
    expect(slid).toBe(true);
    expect(s.stance).toBe('slide');
    run(s, { buttons: BTN.CROUCH }, 90);
    expect(s.stance).toBe('crouch');
    run(s, {}, 5);
    expect(s.stance).toBe('stand');
  });

  it('is deterministic: same inputs → identical state', () => {
    const a = createPlayerState({ x: -10, y: 0, z: -10 }, 0.3, 'dijla7', 'shatt9');
    const b = clonePlayerState(a);
    const seq: Partial<InputCmd>[] = [];
    for (let i = 0; i < 200; i++) {
      seq.push({ moveY: i % 30 < 20 ? 1 : 0, moveX: i % 50 > 40 ? 1 : 0, yaw: 0.3 + i * 0.01, buttons: i % 70 === 5 ? BTN.JUMP : i > 100 ? BTN.SPRINT : 0 });
    }
    seq.forEach((c, i) => simulateStep(a, cmd(i + 1, c), world, TICK_DT));
    seq.forEach((c, i) => simulateStep(b, cmd(i + 1, c), world, TICK_DT));
    expect(a).toEqual(b);
  });

  it('dies below kill Z', () => {
    const s = createPlayerState({ x: 0, y: -14.9, z: 0 }, 0, 'dijla7', 'shatt9');
    // Place outside any floor: the arena floor covers the bounds, so hack the position under it.
    s.pos.y = -14.99;
    simulateStep(s, cmd(1, {}), world, TICK_DT);
    simulateStep(s, cmd(2, {}), world, TICK_DT);
    expect(s.alive).toBe(false);
  });
});

describe('weapons', () => {
  it('fires at the weapon rate and consumes ammo', () => {
    const s = createPlayerState({ x: 0, y: 0, z: 0 }, 0, 'dijla7', 'shatt9');
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      const ev = stepWeapons(s, cmd(i + 1, { buttons: BTN.FIRE }), TICK_DT);
      shots += ev.filter((e) => e.kind === 'fire').length;
    }
    const expected = Math.floor(WEAPONS.dijla7.rpm / 60) + 1; // first shot immediate
    expect(Math.abs(shots - expected)).toBeLessThanOrEqual(1);
    expect(s.weapons[0].ammo).toBe(WEAPONS.dijla7.magSize - shots);
  });

  it('reloads from the reserve and cannot fire while reloading', () => {
    const s = createPlayerState({ x: 0, y: 0, z: 0 }, 0, 'dijla7', 'shatt9');
    s.weapons[0].ammo = 3;
    const ev = stepWeapons(s, cmd(1, { buttons: BTN.RELOAD }), TICK_DT);
    expect(ev.some((e) => e.kind === 'reload_start')).toBe(true);
    let fired = 0;
    let done = false;
    for (let i = 0; i < 200 && !done; i++) {
      const e = stepWeapons(s, cmd(i + 2, { buttons: BTN.FIRE }), TICK_DT);
      fired += e.filter((x) => x.kind === 'fire').length;
      done = e.some((x) => x.kind === 'reload_done');
    }
    expect(done).toBe(true);
    expect(fired).toBe(0);
    expect(s.weapons[0].ammo).toBe(WEAPONS.dijla7.magSize);
    expect(s.weapons[0].reserve).toBe(WEAPONS.dijla7.reserve - (WEAPONS.dijla7.magSize - 3));
  });

  it('switches weapons with a delay', () => {
    const s = createPlayerState({ x: 0, y: 0, z: 0 }, 0, 'dijla7', 'shatt9');
    const ev = stepWeapons(s, cmd(1, { buttons: BTN.SWITCH }), TICK_DT);
    expect(ev.some((e) => e.kind === 'switch_start')).toBe(true);
    expect(s.weaponIndex).toBe(1);
    let ticks = 0;
    while (s.switchTime > 0 && ticks < 100) { stepWeapons(s, cmd(ticks + 2, {}), TICK_DT); ticks++; }
    expect(ticks).toBeGreaterThan(10);
    // Holding SWITCH does not toggle again.
    expect(s.weaponIndex).toBe(1);
  });

  it('computes deterministic spread and recoil', () => {
    const s = createPlayerState({ x: 0, y: 0, z: 0 }, 0.2, 'dijla7', 'shatt9');
    const a = computeShot(s, WEAPONS.dijla7, 3, 12345, 7);
    const b = computeShot(s, WEAPONS.dijla7, 3, 12345, 7);
    const c = computeShot(s, WEAPONS.dijla7, 4, 12345, 7);
    expect(a).toEqual(b);
    expect(a.dir).not.toEqual(c.dir);
    expect(a.kickPitch).toBeLessThan(0); // kicks up
    // ADS shots are tighter than hip shots.
    s.ads = 1;
    const ads = computeShot(s, WEAPONS.dijla7, 3, 12345, 7);
    expect(ads.spreadDeg).toBeLessThan(a.spreadDeg);
  });

  it('applies damage falloff and headshot multiplier', () => {
    const d = WEAPONS.dijla7;
    expect(damageAtDistance(d, 5, false)).toBe(d.damage);
    expect(damageAtDistance(d, 5, true)).toBe(Math.round(d.damage * d.headshotMult));
    expect(damageAtDistance(d, 100, false)).toBe(Math.round(d.damage * d.minDamageMult));
    const mid = damageAtDistance(d, (d.falloffStart + d.falloffEnd) / 2, false);
    expect(mid).toBeLessThan(d.damage);
    expect(mid).toBeGreaterThan(d.damage * d.minDamageMult);
  });
});

describe('raycast & hitscan', () => {
  it('hits the world', () => {
    const hit = raycastWorld(world, { x: 0, y: 1, z: -15 }, { x: 0, y: 0, z: -1 }, 100);
    expect(hit).not.toBeNull();
    expect(hit!.point.z).toBeCloseTo(-20, 3);
    expect(hit!.normal.z).toBeCloseTo(1, 5);
  });

  it('respects line of sight through the central platform', () => {
    expect(lineOfSight(world, { x: -10, y: 1.6, z: 0 }, { x: 10, y: 1.6, z: 0 })).toBe(false);
    expect(lineOfSight(world, { x: -10, y: 1.6, z: 12 }, { x: 10, y: 1.6, z: 12 })).toBe(true);
  });

  it('hits players before walls, with headshots', () => {
    const origin = { x: -10, y: MOVEMENT.eyeHeightStand, z: 12 };
    const dir = aimDirection(Math.PI / 2, 0); // +X
    const body = traceShot(world, origin, dir, 200, [{ id: 5, pos: { x: 0, y: 0, z: 12 }, stance: 'stand' }]);
    expect(body.kind).toBe('player');
    if (body.kind === 'player') {
      expect(body.id).toBe(5);
      expect(body.headshot).toBe(true); // eye-level shot at a standing target hits the head
    }
    const lower = traceShot(world, { ...origin, y: 1.0 }, dir, 200, [{ id: 5, pos: { x: 0, y: 0, z: 12 }, stance: 'stand' }]);
    expect(lower.kind).toBe('player');
    if (lower.kind === 'player') expect(lower.headshot).toBe(false);
    const miss = traceShot(world, origin, dir, 200, [{ id: 5, pos: { x: 0, y: 0, z: 14 }, stance: 'stand' }]);
    expect(miss.kind).toBe('world');
  });
});

describe('navigation', () => {
  const grid = buildNavGrid(testArena, world);

  it('covers the ground and the platform', () => {
    expect(grid.nodes.length).toBeGreaterThan(800);
    const top = grid.nodes.filter((n) => Math.abs(n.pos.y - 2.4) < 0.01);
    expect(top.length).toBeGreaterThan(20);
  });

  it('connects every spawn point to every other one', () => {
    const comp = largestComponent(grid);
    const all = [...testArena.spawns.tigris, ...testArena.spawns.euphrates, ...testArena.spawns.neutral];
    for (const sp of all) {
      const n = nearestNode(grid, sp.pos);
      expect(n, `no node near spawn ${JSON.stringify(sp.pos)}`).not.toBeNull();
      expect(comp.has(n!.id), `spawn ${JSON.stringify(sp.pos)} not in main component`).toBe(true);
    }
    expect(comp.size / grid.nodes.length).toBeGreaterThan(0.95);
  });

  it('finds a path from a spawn up the stairs to the platform', () => {
    const from = nearestNode(grid, testArena.spawns.tigris[0].pos)!;
    const to = nearestNode(grid, { x: 0, y: 2.4, z: 0 })!;
    const path = findPath(grid, from.id, to.id);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(10);
    expect(path![path!.length - 1].pos.y).toBeCloseTo(2.4, 2);
  });
});
