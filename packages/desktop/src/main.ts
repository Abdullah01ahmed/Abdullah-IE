/**
 * Electron main process: the game window, the settings/profile files, and the
 * embedded server launcher behind the `window.tra` bridge.
 */
import { BrowserWindow, Menu, app, ipcMain, session, shell, utilityProcess } from 'electron';
import path from 'node:path';
import { BRIDGE_CHANNELS, GAME_NAME, type HostServerOptions, type HostServerResult } from '@tra/shared';
import { JsonStore } from './json-store';
import { getLanAddresses } from './lan';
import { log } from './log';
import { ServerLauncher } from './server-launcher';

const APP_USER_MODEL_ID = 'iq.twinrivers.arena';
/** Folder name under %APPDATA% (Windows) / ~/.config (Linux) for settings, profile and Chromium data. */
const USER_DATA_DIR_NAME = 'Twin Rivers Arena';
const WINDOW_BACKGROUND = '#0b0f14';
/** Set by `npm run dev`: load the Vite dev server instead of the packaged renderer. */
const DEV_SERVER_URL = process.env.TRA_DEV_SERVER_URL;
const DEV_RELOAD_DELAY_MS = 1500;

// Chromium disables GPU acceleration for drivers on its blocklist. Only players
// who set TRA_FORCE_GPU=1 opt in to overriding that; by default we trust the list.
if (process.env.TRA_FORCE_GPU) app.commandLine.appendSwitch('ignore-gpu-blocklist');

// The package is called "@tra/desktop", which Electron would otherwise turn into
// an "%APPDATA%\@tra\desktop" folder; use the product name in dev and packaged alike.
app.setName(USER_DATA_DIR_NAME);
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIR_NAME));

if (!app.requestSingleInstanceLock()) {
  log.info('another instance is already running; exiting');
  app.quit();
} else {
  main();
}

function main(): void {
  Menu.setApplicationMenu(null);
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

  let win: BrowserWindow | null = null;
  const settings = new JsonStore(path.join(app.getPath('userData'), 'settings.json'));
  const profile = new JsonStore(path.join(app.getPath('userData'), 'profile.json'));
  const launcher = new ServerLauncher({
    fork: (modulePath, args) => utilityProcess.fork(modulePath, args, { stdio: 'pipe', serviceName: 'tra-server' }),
    serverPaths: serverBundleCandidates(),
    lanAddresses: getLanAddresses,
    onLog: (entry) => win?.webContents.send(BRIDGE_CHANNELS.serverLog, entry),
    onExit: (info) => win?.webContents.send(BRIDGE_CHANNELS.serverExit, info),
  });

  // ---- IPC (one handler per bridge channel) -------------------------------

  ipcMain.handle(BRIDGE_CHANNELS.settingsLoad, () => settings.load());
  ipcMain.handle(BRIDGE_CHANNELS.settingsSave, (_e, data: unknown) => settings.save(data));
  ipcMain.handle(BRIDGE_CHANNELS.profileLoad, () => profile.load());
  ipcMain.handle(BRIDGE_CHANNELS.profileSave, (_e, data: unknown) => profile.save(data));

  ipcMain.handle(BRIDGE_CHANNELS.serverStart, (_e, raw: unknown): Promise<HostServerResult> => {
    if (!raw || typeof raw !== 'object') {
      return Promise.resolve({ ok: false, error: 'INVALID_OPTIONS', message: 'Invalid host options.' });
    }
    return launcher.start(raw as HostServerOptions);
  });
  ipcMain.handle(BRIDGE_CHANNELS.serverStop, () => launcher.stop());
  ipcMain.handle(BRIDGE_CHANNELS.serverStatus, () => launcher.status());
  // The same channel that streams log lines also answers "what did I miss?".
  ipcMain.handle(BRIDGE_CHANNELS.serverLog, () => launcher.recentLog());

  ipcMain.handle(BRIDGE_CHANNELS.lanAddresses, () => getLanAddresses());

  ipcMain.handle(BRIDGE_CHANNELS.setFullscreen, (e, on: unknown) => {
    windowFor(e.sender.id)?.setFullScreen(on === true);
  });
  ipcMain.handle(BRIDGE_CHANNELS.toggleFullscreen, (e) => {
    const w = windowFor(e.sender.id);
    if (!w) return false;
    const next = !w.isFullScreen();
    w.setFullScreen(next);
    return next;
  });
  ipcMain.handle(BRIDGE_CHANNELS.isFullscreen, (e) => windowFor(e.sender.id)?.isFullScreen() ?? false);

  ipcMain.handle(BRIDGE_CHANNELS.quit, () => app.quit());
  ipcMain.handle(BRIDGE_CHANNELS.openExternal, (_e, url: unknown) => openExternalIfHttp(url));
  ipcMain.handle(BRIDGE_CHANNELS.userDataPath, () => app.getPath('userData'));

  function windowFor(webContentsId: number): BrowserWindow | null {
    if (win && win.webContents.id === webContentsId) return win;
    return BrowserWindow.getAllWindows().find((w) => w.webContents.id === webContentsId) ?? null;
  }

  // ---- window --------------------------------------------------------------

  function createWindow(): BrowserWindow {
    const w = new BrowserWindow({
      width: 1600,
      height: 900,
      minWidth: 1280,
      minHeight: 720,
      show: false,
      backgroundColor: WINDOW_BACKGROUND,
      title: GAME_NAME,
      icon: appIconPath(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });

    w.once('ready-to-show', () => w.show());
    // The renderer's <title> must not replace the window title.
    w.on('page-title-updated', (event) => event.preventDefault());
    w.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) {
        event.preventDefault();
        w.setFullScreen(!w.isFullScreen());
      }
    });
    w.on('closed', () => {
      if (win === w) win = null;
      void launcher.stop();
    });

    if (DEV_SERVER_URL) {
      log.info(`loading renderer from ${DEV_SERVER_URL}`);
      w.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        // -3 (ERR_ABORTED) means the load was superseded by another navigation, not that Vite is down.
        if (!isMainFrame || code === -3 || w.isDestroyed()) return;
        log.warn(`could not load ${url} (${code} ${description}); is the Vite dev server running? Retrying...`);
        setTimeout(() => {
          if (!w.isDestroyed()) void w.loadURL(DEV_SERVER_URL);
        }, DEV_RELOAD_DELAY_MS);
      });
      void w.loadURL(DEV_SERVER_URL);
      if (process.env.TRA_DEVTOOLS) w.webContents.openDevTools({ mode: 'detach' });
    } else {
      void w.loadFile(rendererEntry());
    }
    return w;
  }

  // ---- app lifecycle ---------------------------------------------------------

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Hardening for every web contents: no popups, no navigation away from the
  // app; http(s) links go to the system browser instead.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      void openExternalIfHttp(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (isOwnUrl(url)) return;
      event.preventDefault();
      void openExternalIfHttp(url);
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.on('render-process-gone', (_event, _contents, details) => {
    log.error(`renderer process gone: ${details.reason} (exit code ${details.exitCode})`);
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') log.warn(`child process gone: ${details.type} ${details.name ?? ''} ${details.reason} (exit code ${details.exitCode})`);
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting || !launcher.status().running) return;
    // Give the server its graceful shutdown, then quit for real.
    event.preventDefault();
    quitting = true;
    void launcher.stop().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    // The game only needs pointer lock and fullscreen; everything else is refused.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === 'pointerLock' || permission === 'fullscreen' || permission === 'keyboardLock');
    });
    win = createWindow();
    log.info(`${GAME_NAME} ${app.getVersion()} started; userData=${app.getPath('userData')} packaged=${app.isPackaged}`);
  });
}

// ---- paths -------------------------------------------------------------------

/** Where the server bundle may live: next to the app when packaged, the workspace builds in development. */
function serverBundleCandidates(): string[] {
  if (app.isPackaged) return [path.join(process.resourcesPath, 'server', 'server.cjs')];
  return [
    path.resolve(__dirname, '../../server/dist/server.cjs'), // npm run build:server
    path.resolve(__dirname, '../resources/server/server.cjs'), // npm run build:assets -w @tra/desktop
  ];
}

function rendererEntry(): string {
  return path.join(__dirname, '..', 'renderer', 'index.html');
}

function appIconPath(): string {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return app.isPackaged ? path.join(process.resourcesPath, file) : path.resolve(__dirname, '..', 'build', file);
}

// ---- navigation policy -------------------------------------------------------

function isOwnUrl(url: string): boolean {
  try {
    const target = new URL(url);
    if (DEV_SERVER_URL) return target.origin === new URL(DEV_SERVER_URL).origin;
    return target.protocol === 'file:';
  } catch {
    return false;
  }
}

/** Open http(s) URLs in the system browser; refuse every other scheme. */
async function openExternalIfHttp(url: unknown): Promise<void> {
  if (typeof url !== 'string') return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    log.warn(`refusing to open malformed URL: ${url}`);
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    log.warn(`refusing to open non-http URL: ${url}`);
    return;
  }
  await shell.openExternal(parsed.toString());
}
