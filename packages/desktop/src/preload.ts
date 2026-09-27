/**
 * Preload: exposes the DesktopBridge contract as `window.tra`.
 *
 * Runs sandboxed (`sandbox: true`), so only `electron`, `events`, `timers` and
 * `url` can be required; everything else (the shared channel names, the
 * package version) is bundled in by esbuild at build time.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BRIDGE_CHANNELS as CH,
  type DesktopBridge,
  type HostServerOptions,
  type HostServerResult,
  type ServerStatus,
} from '@tra/shared';
import type { ServerLogEntry } from './ipc';
import pkg from '../package.json';

/** `npm start` sets npm_package_version; a packaged app falls back to the version baked in at build time. */
const VERSION = process.env.npm_package_version || pkg.version;

/**
 * Subscribe to live server log lines. Lines the server printed before the
 * subscription existed (its start-up output) are fetched from the main
 * process's ring buffer and delivered first, in order, without duplicates.
 */
function onServerLog(cb: (line: string) => void): () => void {
  let active = true;
  let historyLoaded = false;
  let lastSeq = -1;
  const pending: ServerLogEntry[] = [];

  const deliver = (entry: ServerLogEntry): void => {
    if (!active || entry.seq <= lastSeq) return;
    lastSeq = entry.seq;
    cb(entry.line);
  };
  const listener = (_event: IpcRendererEvent, entry: ServerLogEntry): void => {
    if (historyLoaded) deliver(entry);
    else pending.push(entry);
  };
  ipcRenderer.on(CH.serverLog, listener);

  const flushPending = (): void => {
    historyLoaded = true;
    pending.forEach(deliver);
    pending.length = 0;
  };
  ipcRenderer
    .invoke(CH.serverLog)
    .then((history: ServerLogEntry[]) => {
      if (Array.isArray(history)) history.forEach(deliver);
    })
    .catch(() => undefined)
    .finally(flushPending);

  return () => {
    active = false;
    ipcRenderer.removeListener(CH.serverLog, listener);
  };
}

function onServerExit(cb: (info: { code: number | null }) => void): () => void {
  const listener = (_event: IpcRendererEvent, info: { code: number | null }): void => cb({ code: info?.code ?? null });
  ipcRenderer.on(CH.serverExit, listener);
  return () => ipcRenderer.removeListener(CH.serverExit, listener);
}

const bridge: DesktopBridge = {
  isElectron: true,
  version: VERSION,
  platform: process.platform,

  loadSettings: () => ipcRenderer.invoke(CH.settingsLoad) as Promise<unknown | null>,
  saveSettings: (data: unknown) => ipcRenderer.invoke(CH.settingsSave, data) as Promise<void>,
  loadProfile: () => ipcRenderer.invoke(CH.profileLoad) as Promise<unknown | null>,
  saveProfile: (data: unknown) => ipcRenderer.invoke(CH.profileSave, data) as Promise<void>,

  startServer: (opts: HostServerOptions) => ipcRenderer.invoke(CH.serverStart, opts) as Promise<HostServerResult>,
  stopServer: () => ipcRenderer.invoke(CH.serverStop) as Promise<void>,
  serverStatus: () => ipcRenderer.invoke(CH.serverStatus) as Promise<ServerStatus>,
  onServerLog,
  onServerExit,

  getLanAddresses: () => ipcRenderer.invoke(CH.lanAddresses) as Promise<string[]>,

  setFullscreen: (on: boolean) => ipcRenderer.invoke(CH.setFullscreen, on === true) as Promise<void>,
  toggleFullscreen: () => ipcRenderer.invoke(CH.toggleFullscreen) as Promise<boolean>,
  isFullscreen: () => ipcRenderer.invoke(CH.isFullscreen) as Promise<boolean>,
  quit: () => ipcRenderer.invoke(CH.quit) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke(CH.openExternal, url) as Promise<void>,
  getUserDataPath: () => ipcRenderer.invoke(CH.userDataPath) as Promise<string>,
};

contextBridge.exposeInMainWorld('tra', bridge);
