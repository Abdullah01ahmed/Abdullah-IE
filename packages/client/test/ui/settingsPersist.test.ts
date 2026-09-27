import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveSettings = vi.fn<(data: unknown) => Promise<void>>(async () => {});
const fakeBridge = {
  isElectron: false,
  version: '0.1.0-test',
  platform: 'browser',
  loadSettings: vi.fn(async () => null),
  saveSettings,
  loadProfile: vi.fn(async () => null),
  saveProfile: vi.fn(async () => {}),
  startServer: vi.fn(async () => ({ ok: false, error: 'NOT_AVAILABLE' })),
  stopServer: vi.fn(async () => {}),
  serverStatus: vi.fn(async () => ({ running: false, port: null })),
  onServerLog: () => () => {},
  onServerExit: () => () => {},
  getLanAddresses: vi.fn(async () => []),
  setFullscreen: vi.fn(async () => {}),
  toggleFullscreen: vi.fn(async () => false),
  isFullscreen: vi.fn(async () => false),
  quit: vi.fn(async () => {}),
  openExternal: vi.fn(async () => {}),
  getUserDataPath: vi.fn(async () => 'test'),
};

vi.mock('../../src/platform/bridge', () => ({
  getBridge: () => fakeBridge,
  isElectron: () => false,
}));

import { useStore } from '../../src/state/store';
import { DEFAULT_SETTINGS, type ClientSettings } from '../../src/state/settings';

describe('settings persistence through the bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveSettings.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces updateSettings into a single saveSettings call', () => {
    const store = useStore.getState();
    store.updateSettings((s) => ({ ...s, playerName: 'Haidar' }));
    store.updateSettings((s) => ({ ...s, graphics: { ...s.graphics, fov: 100 } }));
    expect(saveSettings).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const saved = saveSettings.mock.calls[0]![0] as ClientSettings;
    expect(saved.playerName).toBe('Haidar');
    expect(saved.graphics.fov).toBe(100);
    expect(useStore.getState().settingsRevision).toBeGreaterThan(0);
  });

  it('applies the language to the document immediately', () => {
    useStore.getState().updateSettings((s) => ({ ...s, language: 'ar' }));
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    useStore.getState().updateSettings((s) => ({ ...s, language: 'en' }));
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('hydrates saved settings tolerantly, including recentAddresses', () => {
    useStore.getState().hydrateSettings({
      playerName: 'Layla',
      recentAddresses: ['10.0.0.2:27600', 42, '10.0.0.2:27600', '  10.0.0.3  '],
      graphics: { fov: 999 },
    });
    const s = useStore.getState().settings;
    expect(s.playerName).toBe('Layla');
    expect(s.recentAddresses).toEqual(['10.0.0.2:27600', '10.0.0.3']);
    expect(s.graphics.fov).toBe(120);
    expect(s.lastHostPort).toBe(DEFAULT_SETTINGS.lastHostPort);
    expect(useStore.getState().settingsLoaded).toBe(true);
    // Hydration does not write back to disk.
    vi.advanceTimersByTime(500);
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
