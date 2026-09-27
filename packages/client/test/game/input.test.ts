import { BTN } from '@tra/shared';
import { describe, expect, it } from 'vitest';
import { InputTracker, mouseCode, type TickInput } from '../../src/game/Input';
import { DEFAULT_BINDINGS } from '../../src/state/settings';

const HOLD = { toggleAds: false, toggleCrouch: false, toggleSprint: false };

function sample(t: InputTracker): TickInput {
  return t.sample({ moveX: 0, moveY: 0, buttons: 0 });
}

describe('InputTracker', () => {
  it('maps bound keys to move axes and button flags', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, HOLD);
    t.press('KeyW');
    t.press('KeyD');
    t.press('Space');
    t.press('ShiftLeft');
    t.press(mouseCode(0));
    t.press(mouseCode(2));
    t.press('KeyR');
    t.press('Digit2');
    const out = sample(t);
    expect(out.moveY).toBe(1);
    expect(out.moveX).toBe(1);
    expect(out.buttons & BTN.JUMP).toBeTruthy();
    expect(out.buttons & BTN.SPRINT).toBeTruthy();
    expect(out.buttons & BTN.FIRE).toBeTruthy();
    expect(out.buttons & BTN.ADS).toBeTruthy();
    expect(out.buttons & BTN.RELOAD).toBeTruthy();
    expect(out.buttons & BTN.WEAPON2).toBeTruthy();
    expect(out.buttons & BTN.CROUCH).toBeFalsy();
    t.release('KeyW');
    t.press('KeyS');
    t.press('KeyA');
    const out2 = sample(t);
    expect(out2.moveY).toBe(-1);
    expect(out2.moveX).toBe(0); // A and D cancel
  });

  it('registers a tap shorter than one tick for exactly one tick', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, HOLD);
    t.press('KeyR');
    t.release('KeyR');
    expect(sample(t).buttons & BTN.RELOAD).toBeTruthy();
    expect(sample(t).buttons & BTN.RELOAD).toBeFalsy();
  });

  it('turns wheel notches into one-tick SWITCH pulses in either direction', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, HOLD);
    t.wheel(-100);
    expect(sample(t).buttons & BTN.SWITCH).toBeTruthy();
    expect(sample(t).buttons & BTN.SWITCH).toBeFalsy();
    t.wheel(120);
    expect(sample(t).buttons & BTN.SWITCH).toBeTruthy();
    expect(sample(t).buttons & BTN.SWITCH).toBeFalsy();
    t.wheel(0);
    expect(sample(t).buttons & BTN.SWITCH).toBeFalsy();
  });

  it('ignores key repeat and unbound keys', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, HOLD);
    t.press('KeyW');
    t.press('KeyW');
    t.press('KeyZ');
    expect(sample(t).moveY).toBe(1);
    expect(t.isBound('KeyZ')).toBe(false);
    expect(t.isBound('KeyW')).toBe(true);
  });

  it('hold mode releases when the key is released', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, HOLD);
    t.press('Mouse2');
    expect(sample(t).buttons & BTN.ADS).toBeTruthy();
    t.release('Mouse2');
    expect(sample(t).buttons & BTN.ADS).toBeFalsy();
  });

  it('toggle mode latches ADS and crouch on press edges', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, { toggleAds: true, toggleCrouch: true, toggleSprint: false });
    t.press('Mouse2');
    expect(sample(t).buttons & BTN.ADS).toBeTruthy();
    t.release('Mouse2');
    expect(sample(t).buttons & BTN.ADS).toBeTruthy(); // still latched
    t.press('Mouse2');
    t.release('Mouse2');
    expect(sample(t).buttons & BTN.ADS).toBeFalsy(); // toggled off
    t.press('KeyC');
    t.release('KeyC');
    expect(sample(t).buttons & BTN.CROUCH).toBeTruthy();
    expect(sample(t).buttons & BTN.CROUCH).toBeTruthy();
    t.press('KeyC');
    t.release('KeyC');
    expect(sample(t).buttons & BTN.CROUCH).toBeFalsy();
  });

  it('toggle sprint stays on while moving forward and clears when forward is released', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, { toggleAds: false, toggleCrouch: false, toggleSprint: true });
    t.press('KeyW');
    t.press('ShiftLeft');
    t.release('ShiftLeft');
    expect(sample(t).buttons & BTN.SPRINT).toBeTruthy();
    expect(sample(t).buttons & BTN.SPRINT).toBeTruthy();
    t.release('KeyW');
    expect(sample(t).buttons & BTN.SPRINT).toBeFalsy();
    t.press('KeyW');
    expect(sample(t).buttons & BTN.SPRINT).toBeFalsy(); // needs a new press
  });

  it('rebinding takes effect immediately and releaseAll clears everything', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, HOLD);
    t.setBindings({ ...DEFAULT_BINDINGS, fire: ['KeyF'], tactical: ['KeyX'] }, HOLD);
    t.press('KeyF');
    expect(sample(t).buttons & BTN.FIRE).toBeTruthy();
    t.press('Mouse0');
    expect(sample(t).buttons & BTN.FIRE).toBeTruthy(); // KeyF still held
    t.release('KeyF');
    expect(sample(t).buttons & BTN.FIRE).toBeFalsy(); // Mouse0 no longer bound to fire
    t.press('KeyW');
    t.addMouseDelta(5, -3);
    t.releaseAll();
    const d = { dx: 1, dy: 1 };
    t.takeMouseDelta(d);
    expect(d).toEqual({ dx: 0, dy: 0 });
    expect(sample(t).moveY).toBe(0);
  });

  it('accumulates and drains mouse deltas', () => {
    const t = new InputTracker(DEFAULT_BINDINGS, HOLD);
    t.addMouseDelta(3, 4);
    t.addMouseDelta(-1, 2);
    const d = { dx: 0, dy: 0 };
    t.takeMouseDelta(d);
    expect(d).toEqual({ dx: 2, dy: 6 });
    t.takeMouseDelta(d);
    expect(d).toEqual({ dx: 0, dy: 0 });
  });
});
