import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../../src/state/settings';
import {
  MAX_BINDINGS_PER_ACTION,
  bindingFromKeyboard,
  bindingFromMouse,
  bindingFromWheel,
  bindingLabel,
  findDuplicateBindings,
  isCancelKey,
  removeBinding,
  resetBindings,
  setBinding,
} from '../../src/ui/logic/bindings';

describe('binding capture', () => {
  it('captures keyboard codes and treats Escape as cancel', () => {
    expect(bindingFromKeyboard({ code: 'KeyW' })).toBe('KeyW');
    expect(bindingFromKeyboard({ code: 'ShiftLeft' })).toBe('ShiftLeft');
    expect(bindingFromKeyboard({ code: 'Escape' })).toBeNull();
    expect(bindingFromKeyboard({ code: '' })).toBeNull();
    expect(isCancelKey('Escape')).toBe(true);
    expect(isCancelKey('KeyQ')).toBe(false);
  });

  it('captures mouse buttons 0-4 and wheel direction', () => {
    expect(bindingFromMouse(0)).toBe('Mouse0');
    expect(bindingFromMouse(4)).toBe('Mouse4');
    expect(bindingFromMouse(7)).toBeNull();
    expect(bindingFromWheel(-100)).toBe('WheelUp');
    expect(bindingFromWheel(53)).toBe('WheelDown');
    expect(bindingFromWheel(0)).toBeNull();
  });
});

describe('binding editing', () => {
  it('replaces a slot or appends, capped per action', () => {
    let b = resetBindings();
    b = setBinding(b, 'forward', 0, 'KeyI');
    expect(b.forward).toEqual(['KeyI', 'ArrowUp']);
    b = setBinding(b, 'forward', 5, 'Numpad8');
    expect(b.forward).toEqual(['KeyI', 'ArrowUp', 'Numpad8']);
    b = setBinding(b, 'forward', 9, 'KeyU');
    expect(b.forward).toHaveLength(MAX_BINDINGS_PER_ACTION);
    // Original defaults are untouched.
    expect(DEFAULT_BINDINGS.forward).toEqual(['KeyW', 'ArrowUp']);
  });

  it('deduplicates the same code within an action', () => {
    const b = setBinding(resetBindings(), 'jump', 1, 'Space');
    expect(b.jump).toEqual(['Space']);
  });

  it('removes a slot', () => {
    const b = removeBinding(resetBindings(), 'crouch', 0);
    expect(b.crouch).toEqual(['KeyC']);
  });

  it('finds codes bound to more than one action', () => {
    expect(findDuplicateBindings(resetBindings()).size).toBe(0);
    const b = setBinding(resetBindings(), 'reload', 0, 'KeyW');
    const dups = findDuplicateBindings(b);
    expect([...dups.keys()]).toEqual(['KeyW']);
    expect(dups.get('KeyW')).toEqual(['forward', 'reload']);
  });
});

describe('binding labels', () => {
  it('uses translation keys for named keys and derived text otherwise', () => {
    expect(bindingLabel('Space')).toEqual({ key: 'key.Space' });
    expect(bindingLabel('Mouse2')).toEqual({ key: 'key.Mouse2' });
    expect(bindingLabel('KeyW')).toEqual({ text: 'W' });
    expect(bindingLabel('Digit3')).toEqual({ text: '3' });
    expect(bindingLabel('Numpad8')).toEqual({ text: 'Num 8' });
    expect(bindingLabel('F5')).toEqual({ text: 'F5' });
    expect(bindingLabel('BracketLeft')).toEqual({ text: 'Bracket Left' });
  });
});
