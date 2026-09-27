/**
 * Time sources and the fixed-rate tick loop.
 *
 * Everything time-dependent in the server (room countdowns, reconnection grace,
 * match ticks, lag compensation) reads a `Clock` so tests can drive thousands
 * of ticks instantly with a `ManualClock` instead of waiting on real timers.
 */
import { performance } from 'node:perf_hooks';
import { TICK_DT } from '@tra/shared';

export interface Clock {
  /** Monotonic time in milliseconds. */
  now(): number;
}

export const TICK_MS = TICK_DT * 1000;

/** Real monotonic clock (performance.now()). */
export const realClock: Clock = { now: () => performance.now() };

/** Manually advanced clock for tests. */
export class ManualClock implements Clock {
  constructor(private t = 0) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

/** Maximum simulation ticks run per timer wake-up when the loop falls behind. */
export const MAX_CATCHUP_TICKS = 5;

/**
 * Deterministic 60 Hz loop: a setTimeout-based accumulator on the clock. It
 * runs whole ticks only, catches up at most MAX_CATCHUP_TICKS per wake and, if
 * it is further behind than that, drops the excess time instead of spinning.
 */
export class TickLoop {
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private acc = 0;
  private running = false;

  constructor(private readonly step: () => void, private readonly clock: Clock = realClock) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = this.clock.now();
    this.acc = 0;
    this.schedule(TICK_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => this.wake(), Math.max(1, Math.floor(delayMs)));
  }

  private wake(): void {
    if (!this.running) return;
    const now = this.clock.now();
    this.acc += now - this.last;
    this.last = now;
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      this.step();
      this.acc -= TICK_MS;
      ticks++;
    }
    // Too far behind (e.g. the event loop was blocked): forget the backlog so
    // the next wake does not try to replay it — the sim slows down instead of
    // spiralling into ever-longer catch-up bursts.
    if (this.acc >= TICK_MS) this.acc = TICK_MS * 0.5;
    if (this.running) this.schedule(TICK_MS - this.acc);
  }
}
