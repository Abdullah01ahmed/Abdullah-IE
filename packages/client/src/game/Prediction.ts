/**
 * Client-side prediction for the local player: every tick an InputCmd is
 * applied immediately to a predicted copy of the simulation state and kept in
 * a pending list until the server acknowledges it. When an authoritative
 * snapshot arrives we rewind to it and replay the unacknowledged inputs.
 *
 * Pure simulation glue (no Babylon) so the replay logic is unit-testable.
 */
import {
  TICK_DT,
  assignPlayerState,
  clonePlayerState,
  simulateStep,
  stepWeapons,
  type CollisionWorld,
  type InputCmd,
  type MoveResult,
  type PlayerSimState,
  type WeaponEvent,
} from '@tra/shared';

export interface TickIntent {
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  buttons: number;
}

export interface TickResult {
  cmd: InputCmd;
  events: WeaponEvent[];
  move: MoveResult;
}

export interface Correction {
  /** Distance between the old prediction and the corrected state (m). */
  error: number;
  /** Old position minus corrected position (for visual smoothing). */
  dx: number;
  dy: number;
  dz: number;
  /** Inputs replayed on top of the authoritative state. */
  replayed: number;
}

/** Apply one command to a state: movement first, then weapon handling. */
export function applyCommand(state: PlayerSimState, cmd: InputCmd, world: CollisionWorld): { events: WeaponEvent[]; move: MoveResult } {
  const move = simulateStep(state, cmd, world, TICK_DT);
  const events = stepWeapons(state, cmd, TICK_DT);
  return { events, move };
}

export class Predictor {
  /** The predicted state (mutated in place every tick). */
  readonly state: PlayerSimState;
  /** Unacknowledged commands, oldest first. */
  readonly pending: InputCmd[] = [];
  /** Sequence number of the last command produced. */
  seq = 0;

  constructor(
    private readonly world: CollisionWorld,
    initial: PlayerSimState,
  ) {
    this.state = clonePlayerState(initial);
  }

  /** Build and apply the next command. `time` is the client's server-clock estimate (ms). */
  step(intent: TickIntent, time: number): TickResult {
    const cmd: InputCmd = {
      seq: ++this.seq,
      moveX: intent.moveX,
      moveY: intent.moveY,
      yaw: intent.yaw,
      pitch: intent.pitch,
      buttons: intent.buttons,
      time,
    };
    const { events, move } = applyCommand(this.state, cmd, this.world);
    this.pending.push(cmd);
    return { cmd, events, move };
  }

  /**
   * Rewind to the authoritative state and replay every command the server has
   * not processed yet (seq > ack).
   */
  reconcile(self: PlayerSimState, ack: number): Correction {
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop].seq <= ack) drop++;
    if (drop > 0) this.pending.splice(0, drop);
    const oldX = this.state.pos.x;
    const oldY = this.state.pos.y;
    const oldZ = this.state.pos.z;
    assignPlayerState(this.state, self);
    for (const cmd of this.pending) applyCommand(this.state, cmd, this.world);
    const dx = oldX - this.state.pos.x;
    const dy = oldY - this.state.pos.y;
    const dz = oldZ - this.state.pos.z;
    return { error: Math.sqrt(dx * dx + dy * dy + dz * dz), dx, dy, dz, replayed: this.pending.length };
  }

  /** Adopt a state wholesale and forget pending inputs (respawn / teleport). */
  reset(state: PlayerSimState): void {
    assignPlayerState(this.state, state);
    this.pending.length = 0;
  }
}
