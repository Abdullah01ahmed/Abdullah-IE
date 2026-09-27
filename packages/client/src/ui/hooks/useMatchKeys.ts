/**
 * The three UI-level key actions during a match: pause (toggle), scoreboard
 * (hold) and chat (open). Everything else is read by the game's own input
 * system, so this hook never touches other keys.
 */
import { useEffect } from 'react';
import { useStore } from '../../state/store';
import { session } from '../../session/Session';

export function togglePause(): void {
  const store = useStore.getState();
  const next = !store.paused;
  store.setPaused(next);
  session.game.setPaused(next);
  if (next) {
    store.setChatOpen(false);
    store.setScoreboardOpen(false);
  } else {
    // Resuming from a keyboard event may not count as a user gesture for
    // pointer lock; if it fails the "click to resume" overlay takes over.
    session.game.requestPointerLock();
  }
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useMatchKeys(): void {
  const screen = useStore((s) => s.screen);
  useEffect(() => {
    if (screen !== 'match') return;

    const onKeyDown = (e: KeyboardEvent) => {
      const store = useStore.getState();
      const b = store.settings.controls.bindings;
      const typing = isTextTarget(e.target);

      if (b.pause.includes(e.code)) {
        e.preventDefault();
        if (e.repeat) return;
        if (store.chatOpen) {
          store.setChatOpen(false);
          return;
        }
        togglePause();
        return;
      }
      if (typing || store.paused) return;

      if (b.scoreboard.includes(e.code)) {
        // Tab must never move browser focus while in the match.
        e.preventDefault();
        if (!e.repeat && !store.scoreboardOpen) store.setScoreboardOpen(true);
        return;
      }
      if (b.chat.includes(e.code) && !store.chatOpen) {
        e.preventDefault();
        store.setChatOpen(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const store = useStore.getState();
      if (store.settings.controls.bindings.scoreboard.includes(e.code)) {
        e.preventDefault();
        if (store.scoreboardOpen) store.setScoreboardOpen(false);
      }
    };

    // Releasing Tab while the window is unfocused would leave the board stuck open.
    const onBlur = () => {
      const store = useStore.getState();
      if (store.scoreboardOpen) store.setScoreboardOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [screen]);
}
