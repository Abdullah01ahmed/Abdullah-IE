/**
 * Key-binding capture and editing (pure functions, unit-tested).
 *
 * Binding codes follow state/settings.ts: KeyboardEvent.code values,
 * 'Mouse0'..'Mouse4' and 'WheelUp' / 'WheelDown'.
 */
import { DEFAULT_BINDINGS, GAME_ACTIONS, type GameAction } from '../../state/settings';
import type { TKey } from '../../i18n';

export const MAX_BINDINGS_PER_ACTION = 3;

export type Bindings = Record<GameAction, string[]>;

/** Keys that are never capturable: Escape cancels the capture instead. */
const RESERVED_CODES = new Set(['Escape']);

/** Convert a keyboard event to a binding code, or null when it must be ignored/cancelled. */
export function bindingFromKeyboard(ev: { code: string }): string | null {
  if (!ev.code || RESERVED_CODES.has(ev.code)) return null;
  return ev.code;
}

export function bindingFromMouse(button: number): string | null {
  return button >= 0 && button <= 4 ? `Mouse${button}` : null;
}

export function bindingFromWheel(deltaY: number): string | null {
  if (deltaY === 0) return null;
  return deltaY < 0 ? 'WheelUp' : 'WheelDown';
}

export function isCancelKey(code: string): boolean {
  return RESERVED_CODES.has(code);
}

/**
 * Assign `code` to `action` at `slot` (append when slot >= length). Returns a
 * new bindings object; the same code is deduplicated within the action.
 */
export function setBinding(bindings: Bindings, action: GameAction, slot: number, code: string): Bindings {
  const current = bindings[action].filter((c, i) => c !== code || i === slot);
  const next = [...current];
  if (slot >= 0 && slot < next.length) next[slot] = code;
  else next.push(code);
  return { ...bindings, [action]: next.slice(0, MAX_BINDINGS_PER_ACTION) };
}

export function removeBinding(bindings: Bindings, action: GameAction, slot: number): Bindings {
  return { ...bindings, [action]: bindings[action].filter((_, i) => i !== slot) };
}

/** Codes bound to more than one action, with the actions they collide on. */
export function findDuplicateBindings(bindings: Bindings): Map<string, GameAction[]> {
  const owners = new Map<string, GameAction[]>();
  for (const action of GAME_ACTIONS) {
    for (const code of new Set(bindings[action])) {
      const list = owners.get(code) ?? [];
      list.push(action);
      owners.set(code, list);
    }
  }
  for (const [code, actions] of owners) if (actions.length < 2) owners.delete(code);
  return owners;
}

export function resetBindings(): Bindings {
  return Object.fromEntries(GAME_ACTIONS.map((a) => [a, [...DEFAULT_BINDINGS[a]]])) as Bindings;
}

/** Codes that have a translated label; everything else is derived from the code itself. */
const LABELLED: ReadonlySet<string> = new Set([
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Tab', 'Escape',
  'Enter', 'Backspace', 'CapsLock', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4', 'WheelUp', 'WheelDown',
]);

export type BindingLabel = { key: TKey } | { text: string };

/** Human label for a binding code: a translation key for named keys, plain text otherwise. */
export function bindingLabel(code: string): BindingLabel {
  if (LABELLED.has(code)) return { key: `key.${code}` as TKey };
  const letter = code.match(/^Key([A-Z])$/);
  if (letter) return { text: letter[1] };
  const digit = code.match(/^Digit(\d)$/);
  if (digit) return { text: digit[1] };
  const numpad = code.match(/^Numpad(.+)$/);
  if (numpad) return { text: `Num ${numpad[1]}` };
  const fkey = code.match(/^F(\d{1,2})$/);
  if (fkey) return { text: `F${fkey[1]}` };
  const mouse = code.match(/^Mouse(\d)$/);
  if (mouse) return { text: `Mouse ${Number(mouse[1]) + 1}` };
  // Split CamelCase codes such as 'BracketLeft' into 'Bracket Left'.
  return { text: code.replace(/([a-z])([A-Z])/g, '$1 $2') };
}
