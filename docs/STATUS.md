# Status — Milestone 1

Checklist of the Milestone 1 specification. `[x]` means implemented **and**
verified by the person ticking it (command or test named in the *Verified by*
column); `[ ]` means not yet verified. Items are grouped by area; the
integration pass finalises the areas outside *Desktop* and *Documentation*.

## Shared simulation (`packages/shared`)

| | Item | Verified by |
| --- | --- | --- |
| [ ] | Protocol types and JSON encode/decode (`protocol.ts`), versioned | `vitest --project shared` |
| [ ] | 60 Hz fixed tick, one `InputCmd` per tick, `simulateStep` pure and deterministic | |
| [ ] | Capsule-vs-box movement: walk/sprint/crouch/slide/jump, step-up, mantle, coyote time, ADS speed | |
| [ ] | Weapon state machine: fire timing, magazine/reserve, tactical + empty reload, switch timer, seeded spread/recoil | |
| [ ] | Hitscan vs world boxes and player hitboxes (body box + head sphere), falloff, headshot multiplier | |
| [ ] | Two weapons: Dijla-7 (AR), Shatt-9 (SMG) | |
| [ ] | Map schema + builder helpers; Shanasheel map data; map validation tests (spawn reachability, protected spawns) | |
| [ ] | Navigation grid for bots (`buildNavGrid`, A*), drop links | |
| [ ] | Bot difficulty presets: easy / normal / hard / extreme (behaviour only, never health/damage) | |

## Server (`packages/server`)

| | Item | Verified by |
| --- | --- | --- |
| [ ] | WebSocket server, `hello`/`welcome` handshake, reject codes (`SERVER_FULL`, `TEAM_FULL`, `BAD_PASSWORD`, `VERSION_MISMATCH`, `NAME_TAKEN`, …) | `vitest --project server` |
| [ ] | Two teams × exactly five slots; never more than ten participants | |
| [ ] | Room/lobby: teams, ready, host controls, settings, kick, countdown | |
| [ ] | Bots: `none` / `fixed` / `fill` modes, per-bot difficulty, "humans replace bots" | |
| [ ] | Match loop: input validation (fixed dt, catch-up bound), snapshots at 20 Hz, scoreboard at 1 Hz | |
| [ ] | Lag compensation: 1 s pose history, rewind bounded to 200 ms | |
| [ ] | Team Deathmatch: score limit, time limit, respawn delay, friendly fire, results, return to lobby | |
| [ ] | Join-in-progress, graceful disconnect, reconnection with the same name within 30 s | |
| [ ] | CLI / env configuration; dedicated mode; `TRA_SERVER_READY` / `TRA_SERVER_ERROR` handshake; exit code 2 on fatal error | |
| [ ] | Single-file bundle `packages/server/dist/server.cjs` | |

## Client (`packages/client`)

| | Item | Verified by |
| --- | --- | --- |
| [ ] | Babylon.js world: WebGPU with WebGL 2 fallback, procedural PBR materials, Shanasheel rendering, props, lighting | `vitest --project client`, manual |
| [ ] | Local player prediction + reconciliation with smoothing | |
| [ ] | Remote player interpolation (100 ms) | |
| [ ] | View model, recoil, muzzle flash, tracers, impacts, procedural positional audio | |
| [ ] | Input: rebindable keys/mouse/wheel, pointer lock, toggle/hold options, sensitivity | |
| [ ] | Screens: main menu, host, join, lobby, loading, HUD, pause, scoreboard, results, settings, loadout | |
| [ ] | English + Arabic dictionaries, RTL layout, Noto Kufi / Naskh Arabic fonts | |
| [ ] | Settings and profile persisted through the desktop bridge (browser fallback: `localStorage`) | |
| [ ] | Graphics presets and quality options | |

## Desktop (`packages/desktop`)

| | Item | Verified by |
| --- | --- | --- |
| [x] | Electron main process: single-instance lock, 1600×900 window (min 1280×720), `#0b0f14` background, no menu, sandboxed + context-isolated preload, background throttling off | `npm run typecheck -w @tra/desktop`; `npm run build:main` → `dist/main.cjs`; code review (not launched here: no display) |
| [x] | Loads `TRA_DEV_SERVER_URL` in development (retries until Vite is up) or the packaged `renderer/index.html` | as above |
| [x] | F11 toggles fullscreen; `window.open` denied; navigation off-app blocked; only http(s) links open in the system browser | as above |
| [x] | IPC handler for every `BRIDGE_CHANNELS` entry; preload exposes `window.tra` implementing `DesktopBridge` exactly, subscriptions return unsubscribe functions | `tsc` against the shared `DesktopBridge` type; `npm run build:preload` → `dist/preload.cjs` (requires only `electron`) |
| [x] | `settings.json` / `profile.json` in `%APPDATA%\Twin Rivers Arena\`, atomic temp-file + rename writes, serialised saves, corrupt file → `.corrupt` backup + `null` | ad-hoc Node run of `JsonStore` (burst saves, corrupt input, unserialisable input) |
| [x] | Embedded server via `utilityProcess.fork` with piped stdio: options → CLI flags, `TRA_SERVER_READY` / `TRA_SERVER_ERROR` parsing, `PORT_IN_USE` guidance, 10 s start timeout, log ring buffer (200 lines) streamed + replayed to late subscribers, exit notification, graceful stop then kill after 2 s, stop on window close / quit | ad-hoc Node run of `ServerLauncher` against the real `server.cjs` (ready, PORT_IN_USE, bad config, restart, graceful exit 0, force-kill of a SIGTERM-ignoring child); `utilityProcess` path itself not exercised (no display) |
| [x] | LAN address discovery (IPv4, non-internal, private ranges first) | ad-hoc Node run |
| [x] | Application icon generated with plain Node: `build/icon.png` (512), `build/icon-256.png`, `build/icon.ico` (256/128/64/48/32/16 PNG entries), deterministic output | `node scripts/make-icon.mjs` twice → identical hashes; `node scripts/verify-icon.mjs` (signature, IHDR, CRCs, inflate/unfilter, ICO directory) |
| [x] | `scripts/prepare-assets.mjs` stages `client/dist` → `renderer/` and `server.cjs` (+map) → `resources/server/`, fails clearly when a build is missing | `npm run build:assets -w @tra/desktop` |
| [x] | electron-builder config: appId `iq.twinrivers.arena`, asar, extraResources server, NSIS x64 (assisted, per-user, custom dir, shortcuts, keep app data), `installer.nsh` firewall rule add/remove, `signAndEditExecutable: false` for Linux/macOS builds | `npm run dist:dir -w @tra/desktop` (Windows unpacked build assembled on Linux) |
| [ ] | NSIS installer `Twin-Rivers-Arena-Setup-<version>.exe` built and installed/uninstalled on Windows | `npm run dist:win` on Windows (or Linux with Wine) |
| [ ] | Packaged app launched: window, host flow (utilityProcess), join flow, fullscreen, quit stops the server | E2E packaged-app smoke / manual on Windows |

## Documentation

| | Item | Verified by |
| --- | --- | --- |
| [x] | `README.md`: overview, features, requirements, quick start, hosting (in-game + dedicated), joining, controls, user-data locations, troubleshooting, layout, licensing pointer | review |
| [x] | `docs/HOSTING.md`: LAN, IP discovery, firewall, port forwarding, passwords, dedicated server, systemd / Task Scheduler, error-code troubleshooting | review |
| [x] | `docs/LICENSES.md`: original art/audio, OFL fonts, runtime licences, regeneration recipe | review |
| [x] | `docs/ARCHITECTURE.md` | pre-existing |
| [ ] | Root `LICENSE` file (referenced by `package.json`) | |

## Tests and tooling

| | Item | Verified by |
| --- | --- | --- |
| [ ] | `npm run typecheck` green for every package | |
| [ ] | `npm test` (shared, server, client projects) green | |
| [ ] | `npm run e2e`: real server + two clients by IP; packaged-app smoke | |
| [ ] | `npm run dist:win` produces the installer | |

## Remaining work

- Run the Windows unpacked build and the installer on an actual Windows
  machine: confirm the `utilityProcess` host flow end to end, the firewall rule
  (elevated install), shortcuts, uninstall, and that `%APPDATA%\Twin Rivers Arena\`
  is used.
- Set `win.signAndEditExecutable: true` (or pass
  `--config.win.signAndEditExecutable=true`) when building on Windows or on a
  Linux host with Wine so the executable carries the icon and version resources.
- Add the root `LICENSE` file and settle the project licence.
- Screenshots for the README once the renderer is final.
- Everything unticked above is owned by the integration pass: run the full
  test suites, the E2E flow and the installer build, then tick the items here.
