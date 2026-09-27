/**
 * Input: binding resolution (pure, testable) and the DOM layer that feeds it.
 *
 * `InputTracker` turns raw key/mouse/wheel activity into the per-tick move
 * axes and BTN mask the simulation consumes, honouring hold/toggle options and
 * making sure taps shorter than a tick still register for exactly one tick.
 *
 * `InputManager` owns the DOM listeners and pointer lock for a canvas.
 */
import { BTN } from '@tra/shared';
import type { GameAction } from '../state/settings';

export interface InputOptions {
  toggleAds: boolean;
  toggleCrouch: boolean;
  toggleSprint: boolean;
}

export interface TickInput {
  moveX: number;
  moveY: number;
  buttons: number;
}

/** Simulation button flag for each bindable action (UI-only actions have none). */
export const ACTION_BUTTONS: Partial<Record<GameAction, number>> = {
  jump: BTN.JUMP,
  crouch: BTN.CROUCH,
  sprint: BTN.SPRINT,
  fire: BTN.FIRE,
  ads: BTN.ADS,
  reload: BTN.RELOAD,
  switch: BTN.SWITCH,
  weapon1: BTN.WEAPON1,
  weapon2: BTN.WEAPON2,
  melee: BTN.MELEE,
  lethal: BTN.LETHAL,
  tactical: BTN.TACTICAL,
  interact: BTN.INTERACT,
};

const SIM_ACTIONS: readonly GameAction[] = [
  'forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'fire', 'ads', 'reload', 'switch',
  'weapon1', 'weapon2', 'melee', 'lethal', 'tactical', 'interact',
];

/** Binding code for a MouseEvent.button value. */
export function mouseCode(button: number): string {
  return `Mouse${button}`;
}

export class InputTracker {
  private held = new Set<string>();
  /** Codes pressed since the last sample (so a tap inside one tick still counts). */
  private tapped = new Set<string>();
  private codeToActions = new Map<string, GameAction[]>();
  private prevActive = new Set<GameAction>();
  private latchAds = false;
  private latchCrouch = false;
  private latchSprint = false;
  private mouseDx = 0;
  private mouseDy = 0;
  private options: InputOptions;

  constructor(bindings: Record<GameAction, string[]>, options: InputOptions) {
    this.options = { ...options };
    this.setBindings(bindings, options);
  }

  setBindings(bindings: Record<GameAction, string[]>, options: InputOptions): void {
    this.options = { ...options };
    this.codeToActions.clear();
    for (const action of Object.keys(bindings) as GameAction[]) {
      for (const code of bindings[action]) {
        let list = this.codeToActions.get(code);
        if (!list) this.codeToActions.set(code, (list = []));
        if (!list.includes(action)) list.push(action);
      }
    }
    if (!options.toggleAds) this.latchAds = false;
    if (!options.toggleCrouch) this.latchCrouch = false;
    if (!options.toggleSprint) this.latchSprint = false;
  }

  /** True when this code is bound to any action (used to preventDefault). */
  isBound(code: string): boolean {
    return this.codeToActions.has(code);
  }

  press(code: string): void {
    if (this.held.has(code)) return; // key repeat
    this.held.add(code);
    this.tapped.add(code);
  }

  release(code: string): void {
    this.held.delete(code);
  }

  /** Wheel notch: one pulse of WheelUp / WheelDown for the next tick. */
  wheel(deltaY: number): void {
    if (deltaY === 0) return;
    this.tapped.add(deltaY < 0 ? 'WheelUp' : 'WheelDown');
  }

  addMouseDelta(dx: number, dy: number): void {
    this.mouseDx += dx;
    this.mouseDy += dy;
  }

  /** Read and reset accumulated mouse motion. */
  takeMouseDelta(out: { dx: number; dy: number }): void {
    out.dx = this.mouseDx;
    out.dy = this.mouseDy;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }

  /** Raw "is any binding of this action currently held" (no toggles). */
  isDown(action: GameAction): boolean {
    for (const [code, actions] of this.codeToActions) {
      if (actions.includes(action) && (this.held.has(code) || this.tapped.has(code))) return true;
    }
    return false;
  }

  /** Produce this tick's input, consuming taps and applying toggle latches. */
  sample(out: TickInput): TickInput {
    const active = new Set<GameAction>();
    for (const [code, actions] of this.codeToActions) {
      if (this.held.has(code) || this.tapped.has(code)) for (const a of actions) active.add(a);
    }
    this.tapped.clear();
    const edge = (a: GameAction) => active.has(a) && !this.prevActive.has(a);

    out.moveX = (active.has('right') ? 1 : 0) - (active.has('left') ? 1 : 0);
    out.moveY = (active.has('forward') ? 1 : 0) - (active.has('back') ? 1 : 0);

    if (this.options.toggleAds && edge('ads')) this.latchAds = !this.latchAds;
    if (this.options.toggleCrouch && edge('crouch')) this.latchCrouch = !this.latchCrouch;
    if (this.options.toggleSprint) {
      if (edge('sprint')) this.latchSprint = !this.latchSprint;
      // Sprint needs forward input; letting go of W ends a toggled sprint.
      if (out.moveY <= 0.3) this.latchSprint = false;
    }

    let buttons = 0;
    for (const a of SIM_ACTIONS) {
      const bit = ACTION_BUTTONS[a];
      if (bit === undefined) continue;
      let on = active.has(a);
      if (a === 'ads' && this.options.toggleAds) on = this.latchAds;
      else if (a === 'crouch' && this.options.toggleCrouch) on = this.latchCrouch;
      else if (a === 'sprint' && this.options.toggleSprint) on = this.latchSprint;
      if (on) buttons |= bit;
    }
    out.buttons = buttons;
    this.prevActive = active;
    return out;
  }

  /** Drop every held key and toggle (pause, focus loss, death). */
  releaseAll(): void {
    this.held.clear();
    this.tapped.clear();
    this.prevActive.clear();
    this.latchAds = false;
    this.latchCrouch = false;
    this.latchSprint = false;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }
}

/** Keys the browser would otherwise act on while we have pointer lock. */
const ALWAYS_PREVENT = new Set(['Tab', 'Space', 'Backspace', 'F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12', 'Quote', 'Slash']);

/**
 * DOM input for a game canvas: keyboard by KeyboardEvent.code, mouse buttons,
 * wheel, relative mouse motion under pointer lock.
 */
export class InputManager {
  readonly tracker: InputTracker;
  /** When false, events are ignored and nothing is held (pause / chat). */
  enabled = true;
  /** Called after pointer lock is acquired or lost. */
  onLockChange: ((locked: boolean) => void) | null = null;
  /** Called on any pointer/keyboard gesture (used to resume audio). */
  onGesture: (() => void) | null = null;
  /** Fired when the canvas is clicked while unlocked and enabled (UI may re-lock). */
  onCanvasClick: (() => void) | null = null;

  private locked = false;
  private readonly doc: Document;
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, bindings: Record<GameAction, string[]>, options: InputOptions) {
    this.tracker = new InputTracker(bindings, options);
    this.doc = canvas.ownerDocument;
    const win = this.doc.defaultView ?? window;
    const on = <K extends keyof DocumentEventMap>(target: Document, type: K, fn: (ev: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    const onWin = <K extends keyof WindowEventMap>(type: K, fn: (ev: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      win.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => win.removeEventListener(type, fn as EventListener, opts));
    };
    const onCanvas = <K extends keyof HTMLElementEventMap>(type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
    };

    onWin('keydown', (e) => {
      this.onGesture?.();
      if (!this.enabled) return;
      if (this.locked && (this.tracker.isBound(e.code) || ALWAYS_PREVENT.has(e.code))) e.preventDefault();
      if (e.repeat) return;
      this.tracker.press(e.code);
    });
    onWin('keyup', (e) => {
      this.tracker.release(e.code);
    });
    onWin('blur', () => this.tracker.releaseAll());
    onCanvas('mousedown', (e) => {
      this.onGesture?.();
      if (!this.enabled) return;
      if (!this.locked) {
        this.onCanvasClick?.();
        return;
      }
      e.preventDefault();
      this.tracker.press(mouseCode(e.button));
    });
    onWin('mouseup', (e) => {
      this.tracker.release(mouseCode(e.button));
    });
    onCanvas('contextmenu', (e) => e.preventDefault());
    onCanvas('wheel', (e) => {
      if (!this.enabled || !this.locked) return;
      e.preventDefault();
      this.tracker.wheel(e.deltaY);
    }, { passive: false });
    onWin('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      this.tracker.addMouseDelta(e.movementX, e.movementY);
    });
    on(this.doc, 'pointerlockchange', () => {
      const nowLocked = this.doc.pointerLockElement === canvas;
      if (nowLocked === this.locked) return;
      this.locked = nowLocked;
      if (!nowLocked) this.tracker.releaseAll();
      this.onLockChange?.(nowLocked);
    });
    on(this.doc, 'pointerlockerror', () => {
      this.locked = false;
      this.onLockChange?.(false);
    });
  }

  get isLocked(): boolean {
    return this.locked;
  }

  setBindings(bindings: Record<GameAction, string[]>, options: InputOptions): void {
    this.tracker.setBindings(bindings, options);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.tracker.releaseAll();
  }

  /** Must be called from a user gesture. Ignored where pointer lock is unavailable. */
  requestPointerLock(): void {
    const el = this.canvas as HTMLCanvasElement & { requestPointerLock?: (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void };
    if (typeof el.requestPointerLock !== 'function') return;
    try {
      // Raw mouse input (no OS acceleration) when the platform supports it.
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          try {
            void el.requestPointerLock!();
          } catch {
            /* unavailable */
          }
        });
      }
    } catch {
      try {
        void el.requestPointerLock();
      } catch {
        /* unavailable */
      }
    }
  }

  exitPointerLock(): void {
    const d = this.doc as Document & { exitPointerLock?: () => void };
    if (typeof d.exitPointerLock === 'function' && d.pointerLockElement === this.canvas) d.exitPointerLock();
  }

  dispose(): void {
    this.exitPointerLock();
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.tracker.releaseAll();
  }
}
