/**
 * Screen routing smoke tests: every screen renders from a mocked store state
 * without crashing, and a few key interactions (error dialog, RTL switch,
 * match key handling) behave. React is driven with createRoot + act.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOADOUT, DEFAULT_MATCH_SETTINGS, type MatchResults, type RoomState, type ScoreboardState } from '@tra/shared';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The UI only ever talks to the session facade; replace it so no network or
// engine code runs under jsdom. vi.mock is hoisted, so the fakes are too.
const { fakeGame, fakeSession } = vi.hoisted(() => {
  const fakeGame = {
    attach: vi.fn(async () => {}),
    resize: vi.fn(),
    requestPointerLock: vi.fn(),
    setPaused: vi.fn(),
  };
  const fakeSession = {
    game: fakeGame,
    isHosting: false,
    host: vi.fn(async () => {}),
    join: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    cancelConnect: vi.fn(),
    setTeam: vi.fn(),
    setReady: vi.fn(),
    updateSettings: vi.fn(),
    addBot: vi.fn(),
    removeBot: vi.fn(),
    setBotDifficulty: vi.fn(),
    kick: vi.fn(),
    startMatch: vi.fn(),
    cancelStart: vi.fn(),
    setLoadout: vi.fn(),
    sendChat: vi.fn(),
    continueToLobby: vi.fn(),
  };
  return { fakeGame, fakeSession };
});
vi.mock('../../src/session/Session', () => ({ session: fakeSession }));

import { App } from '../../src/ui/App';
import { DEFAULT_HUD, useStore, type AppState } from '../../src/state/store';

const room: RoomState = {
  serverName: "Ali's match",
  phase: 'lobby',
  hostId: 1,
  dedicated: false,
  passwordProtected: true,
  settings: structuredClone(DEFAULT_MATCH_SETTINGS),
  matchNumber: 1,
  countdown: 4,
  players: [
    { id: 1, name: 'Ali', team: 'tigris', ready: true, ping: 12, isBot: false, loadout: DEFAULT_LOADOUT, connected: true, kills: 0, deaths: 0, score: 0 },
    { id: 2, name: 'Samir', team: 'tigris', ready: false, ping: 0, isBot: true, botDifficulty: 'hard', loadout: DEFAULT_LOADOUT, connected: true, kills: 0, deaths: 0, score: 0 },
    { id: 3, name: 'Layla', team: 'euphrates', ready: false, ping: 140, isBot: false, loadout: DEFAULT_LOADOUT, connected: false, kills: 0, deaths: 0, score: 0 },
  ],
};

const board: ScoreboardState = {
  teams: { tigris: 30, euphrates: 22 },
  players: [
    { id: 1, name: 'Ali', team: 'tigris', kills: 12, deaths: 4, score: 1200, ping: 12, isBot: false },
    { id: 2, name: 'Samir', team: 'tigris', kills: 8, deaths: 9, score: 800, ping: 0, isBot: true },
    { id: 3, name: 'Layla', team: 'euphrates', kills: 15, deaths: 3, score: 1500, ping: 140, isBot: false },
  ],
  timeLeftSec: 55,
  scoreLimit: 75,
  mode: 'tdm',
};

const results: MatchResults = {
  winner: 'tigris',
  reason: 'score',
  scoreboard: board,
  mvpId: 3,
  nextMapId: 'shanasheel',
  returnToLobbySec: 15,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
  return container;
}

async function setState(patch: Partial<AppState>): Promise<void> {
  await act(async () => {
    useStore.setState(patch);
  });
}

function baseState(): Partial<AppState> {
  return {
    screen: 'menu',
    previousScreen: 'menu',
    connection: { status: 'idle', address: '', error: null, ping: 0, quality: 'good' },
    selfId: null,
    room: null,
    match: null,
    scoreboard: null,
    results: null,
    hud: { ...DEFAULT_HUD },
    paused: false,
    scoreboardOpen: false,
    chatOpen: false,
    chat: [],
  };
}

beforeEach(async () => {
  await setState(baseState());
  await act(async () => {
    useStore.getState().updateSettings((s) => ({ ...s, language: 'en', playerName: 'Ali' }));
  });
  for (const fn of Object.values(fakeSession)) if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear();
  for (const fn of Object.values(fakeGame)) fn.mockClear();
});

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe('screen routing', () => {
  it('renders the main menu with the wordmark and no Quit in the browser', async () => {
    const c = await render();
    expect(c.querySelector('[data-testid="screen-menu"]')).not.toBeNull();
    expect(c.querySelector('.wordmark')).not.toBeNull();
    expect(c.querySelector('[data-testid="menu-quit"]')).toBeNull();
    expect(c.querySelector('[data-testid="game-canvas"]')).toBeNull();
  });

  it('navigates from the menu to host / join / settings / loadout', async () => {
    const c = await render();
    for (const [btn, screen] of [['menu-host', 'screen-host'], ['menu-join', 'screen-join'], ['menu-settings', 'screen-settings'], ['menu-loadout', 'screen-loadout']] as const) {
      await setState({ screen: 'menu' });
      await act(async () => {
        c.querySelector<HTMLButtonElement>(`[data-testid="${btn}"]`)!.click();
      });
      expect(c.querySelector(`[data-testid="${screen}"]`), screen).not.toBeNull();
    }
  });

  it('renders the lobby with ten slots, host controls and the countdown', async () => {
    await setState({ screen: 'lobby', room, selfId: 1, connection: { status: 'connected', address: '127.0.0.1:27600', error: null, ping: 12, quality: 'good' } });
    const c = await render();
    expect(c.querySelector('[data-testid="screen-lobby"]')).not.toBeNull();
    expect(c.querySelectorAll('.slot')).toHaveLength(10);
    expect(c.querySelector('[data-testid="lobby-countdown"]')?.textContent).toContain('4');
    expect(c.querySelector('[data-testid="lobby-start"]')).not.toBeNull();
    // Host sees "Add bot" on empty slots and can change a bot's difficulty.
    expect(c.querySelectorAll('.slot--empty button').length).toBeGreaterThan(0);
    expect(c.querySelector('.slot select')).not.toBeNull();
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="join-euphrates"]')!.click();
    });
    expect(fakeSession.setTeam).toHaveBeenCalledWith('euphrates');
  });

  it('renders the loading screen bound to store.loading', async () => {
    await setState({ screen: 'loading', room, loading: { progress: 0.42, label: 'Textures' } });
    const c = await render();
    expect(c.querySelector('[data-testid="screen-loading"]')).not.toBeNull();
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(c.querySelector('[data-testid="game-canvas"]')).not.toBeNull();
    expect(fakeGame.attach).toHaveBeenCalledTimes(1);
  });

  it('renders the match HUD, kill feed and death overlay', async () => {
    await setState({
      screen: 'match',
      room,
      selfId: 1,
      scoreboard: board,
      connection: { status: 'connected', address: '127.0.0.1:27600', error: null, ping: 33, quality: 'good' },
      hud: {
        ...DEFAULT_HUD,
        health: 22,
        alive: false,
        respawnIn: 2.4,
        selfTeam: 'tigris',
        killedBy: { id: 3, name: 'Layla', weapon: 'shatt9' },
        killFeed: [{ id: 1, killerId: 3, killerName: 'Layla', killerTeam: 'euphrates', victimId: 1, victimName: 'Ali', victimTeam: 'tigris', weapon: 'shatt9', headshot: true, time: performance.now() }],
      },
    });
    const c = await render();
    expect(c.querySelector('[data-testid="hud"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="hud-strip"]')?.textContent).toContain('30');
    expect(c.querySelectorAll('.hud__kill')).toHaveLength(1);
    expect(c.querySelector('[data-testid="hud-death"]')?.textContent).toContain('Layla');
    expect(c.querySelector('[data-testid="hud-death"]')?.textContent).toContain('3');
    // Pointer is not locked under jsdom: the resume prompt is visible.
    expect(c.querySelector('[data-testid="resume-overlay"]')).not.toBeNull();
  });

  it('handles Esc (pause), Tab (hold scoreboard) and T (chat) during a match', async () => {
    await setState({ screen: 'match', room, selfId: 1, scoreboard: board, hud: { ...DEFAULT_HUD, selfTeam: 'tigris' } });
    const c = await render();
    const key = (type: 'keydown' | 'keyup', code: string) =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
      });

    await key('keydown', 'Tab');
    expect(useStore.getState().scoreboardOpen).toBe(true);
    expect(c.querySelector('[data-testid="scoreboard-overlay"]')).not.toBeNull();
    await key('keyup', 'Tab');
    expect(useStore.getState().scoreboardOpen).toBe(false);

    await key('keydown', 'KeyT');
    expect(useStore.getState().chatOpen).toBe(true);
    expect(c.querySelector('[data-testid="hud-chat-input"]')).not.toBeNull();
    await key('keydown', 'Escape');
    expect(useStore.getState().chatOpen).toBe(false);
    expect(useStore.getState().paused).toBe(false);

    await key('keydown', 'Escape');
    expect(useStore.getState().paused).toBe(true);
    expect(fakeGame.setPaused).toHaveBeenLastCalledWith(true);
    expect(c.querySelector('[data-testid="pause-menu"]')).not.toBeNull();
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="pause-resume"]')!.click();
    });
    expect(useStore.getState().paused).toBe(false);
    expect(fakeGame.setPaused).toHaveBeenLastCalledWith(false);
    expect(fakeGame.requestPointerLock).toHaveBeenCalled();
  });

  it('renders results with Victory for the local team, the MVP and a countdown', async () => {
    await setState({ screen: 'results', room, selfId: 1, results, scoreboard: board, hud: { ...DEFAULT_HUD, selfTeam: 'tigris' } });
    const c = await render();
    expect(c.querySelector('[data-testid="results-outcome"]')?.textContent).toBe('Victory');
    expect(c.querySelector('[data-testid="results-mvp"]')?.textContent).toContain('Layla');
    expect(c.querySelector('[data-testid="results-countdown"]')?.textContent).toContain('15');
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="results-continue"]')!.click();
    });
    expect(fakeSession.continueToLobby).toHaveBeenCalled();
  });

  it('shows Defeat when the other team wins', async () => {
    await setState({ screen: 'results', room, selfId: 3, results, hud: { ...DEFAULT_HUD, selfTeam: 'euphrates' } });
    const c = await render();
    expect(c.querySelector('[data-testid="results-outcome"]')?.textContent).toBe('Defeat');
  });

  it('renders settings tabs and the bindings table', async () => {
    await setState({ screen: 'settings' });
    const c = await render();
    const tabs = c.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(4);
    await act(async () => tabs[2]!.click());
    expect(c.querySelectorAll('.bindings tr').length).toBeGreaterThanOrEqual(20);
  });

  it('saves a loadout through the session and never allows duplicates', async () => {
    await setState({ screen: 'loadout' });
    const c = await render();
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="weapon-primary-shatt9"]')!.click();
    });
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="loadout-save"]')!.click();
    });
    expect(fakeSession.setLoadout).toHaveBeenCalledWith({ primary: 'shatt9', secondary: 'dijla7' });
  });
});

describe('errors and language', () => {
  it('shows a localised connection error on the menu and dismisses it', async () => {
    await setState({ connection: { status: 'error', address: '10.0.0.9:27600', error: { code: 'BAD_PASSWORD', message: 'x' }, ping: 0, quality: 'good' } });
    const c = await render();
    expect(c.querySelector('[data-testid="error-message"]')?.textContent).toBe('Incorrect room password.');
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click();
    });
    expect(useStore.getState().connection.error).toBeNull();
    expect(useStore.getState().connection.status).toBe('idle');
    expect(c.querySelector('[role="dialog"]')).toBeNull();
  });

  it('interpolates the address into connection failures', async () => {
    await setState({ connection: { status: 'error', address: '10.0.0.9:27600', error: { code: 'CONNECT_FAILED', message: '' }, ping: 0, quality: 'good' } });
    const c = await render();
    expect(c.querySelector('[data-testid="error-message"]')?.textContent).toContain('10.0.0.9:27600');
  });

  it('switching to Arabic re-renders the UI and flips the document direction', async () => {
    const c = await render();
    await act(async () => {
      useStore.getState().updateSettings((s) => ({ ...s, language: 'ar' }));
    });
    expect(document.documentElement.dir).toBe('rtl');
    expect(c.querySelector('[data-testid="menu-host"]')?.textContent).toContain('استضافة');
    await act(async () => {
      useStore.getState().updateSettings((s) => ({ ...s, language: 'en' }));
    });
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('validates the join address inline', async () => {
    await setState({ screen: 'join' });
    const c = await render();
    const input = c.querySelector<HTMLInputElement>('[data-testid="join-address"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '10.0.0.1:99999');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="join-connect"]')!.click();
    });
    expect(c.querySelector('.field__error')?.textContent).toBe('The port must be between 1 and 65535.');
    expect(fakeSession.join).not.toHaveBeenCalled();
  });
});
