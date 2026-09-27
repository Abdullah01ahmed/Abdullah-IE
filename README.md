# Twin Rivers: Arena

An original 5v5 first-person arena shooter for Windows. Two fictional teams —
**Tigris** and **Euphrates** — fight fast, compact Team Deathmatch rounds in
**Shanasheel**, an Old Baghdad alley map of brick courtyards, latticed balconies
and rooftops. The feel is modern arena shooter: responsive movement (sprint,
slide, mantle), snappy gunplay, matches that are over in ten minutes.

Under the hood it is an Electron desktop app with a Babylon.js renderer and a
React interface, talking over WebSockets to a server-authoritative Node.js game
server that you can run inside the game ("Host") or on its own ("dedicated
server"). Players connect directly by IP over LAN or the internet.

## Features (Milestone 1)

- **5v5, two teams, ten slots.** Each team has exactly five slots that are
  filled by humans or bots; the server never admits an eleventh participant.
- **First-person movement** — walk, sprint, crouch, slide, jump, coyote time,
  step-up and ledge mantling, ADS speed scaling. Capsule collision against a
  box world.
- **Two original weapons** — the *Dijla-7* assault rifle and the *Shatt-9*
  SMG, with per-weapon recoil patterns, spread, damage falloff, headshot
  multipliers, tactical and empty reloads.
- **Server-authoritative netcode** — 60 Hz fixed tick, 20 Hz snapshots, client
  prediction with reconciliation, 100 ms interpolation of remote players and
  bounded (200 ms) lag compensation for hit detection.
- **Direct-IP hosting and joining** — host from the main menu (the server runs
  inside the app), join by `IP[:port]`, optional room password, or run the
  same server bundle as a dedicated server from the command line.
- **Bots** with four difficulty presets (easy / normal / hard / extreme) that
  move by issuing the same inputs a human does; fill modes `none`, `fixed`
  and `fill to 5v5`, and optional "humans replace bots" on join.
- **Team Deathmatch** with configurable score limit, time limit, respawn delay
  and friendly fire; lobby → loading → match → results → lobby cycle.
- **English and Arabic interface** (RTL layout, Noto Kufi / Naskh Arabic).
- **Windows installer** (NSIS x64, per-user, custom install directory,
  shortcuts, uninstaller, firewall rule).

## Screenshots

_Coming with the first playable build — main menu, the Shanasheel map at golden
hour, the HUD, the lobby with bots._

## Requirements

**To play:** Windows 10 or 11 (x64), a GPU with WebGPU or WebGL 2 support,
and an open TCP port if you want to host for players outside your LAN.

**To develop or build:**

- Node.js 20 or newer (22 recommended) and npm 10+
- Git
- Windows for `npm run dist:win` out of the box. On Linux/macOS the unpacked
  build (`dist:dir`) needs nothing extra; the NSIS installer additionally needs
  Wine (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#10-build-environment-notes-building-the-windows-installer-on-linuxmacos)).

## Quick start

```bash
git clone https://github.com/Abdullah01ahmed/Abdullah-IE.git
cd Abdullah-IE
npm install
```

### Development

Three processes, three terminals:

```bash
npm run dev:server     # authoritative server on 0.0.0.0:27600 (tsx; add flags after --)
npm run dev:client     # Vite dev server on http://127.0.0.1:5173
npm run dev:desktop    # Electron shell loading the Vite page (hosting works here)
```

The client also runs in a plain browser tab at <http://127.0.0.1:5173> — join
`127.0.0.1` there; only hosting from inside the game needs Electron.
Set `TRA_DEVTOOLS=1` to open DevTools with the desktop dev shell.

### Build and package

```bash
npm run build          # client (Vite) + server bundle (esbuild) + desktop main/preload + assets
npm run dist:dir       # unpacked app: packages/desktop/release/win-unpacked/Twin Rivers Arena.exe
npm run dist:win       # installer:    packages/desktop/release/Twin-Rivers-Arena-Setup-<version>.exe
```

### Tests

```bash
npm run typecheck      # strict TypeScript in every package
npm test               # vitest: shared simulation, server rules, client logic
npm run e2e            # Playwright: real server + two clients + packaged-app smoke
```

## Hosting a match

### From inside the game

1. Main menu → **Host**.
2. Pick a server name, the port (default **27600**), an optional password, the
   bot fill mode / difficulty and the match rules.
3. Start. The game launches the server as a background process of the app and
   joins it; you are the lobby host and control teams, bots and settings.
4. Give other players your address. The host screen lists your LAN addresses
   (for example `192.168.1.20`); players on the internet need your **public**
   IP and a forwarded TCP port — see [docs/HOSTING.md](docs/HOSTING.md).
5. Leaving the lobby or closing the game stops the server.

### Dedicated server

The same server runs stand-alone on any machine with Node.js 20+:

```bash
npm run build:server   # once, produces packages/server/dist/server.cjs
node packages/server/dist/server.cjs --port 27600 --dedicated --bots fill --bot-difficulty hard
```

A dedicated server has no lobby host: it fills empty slots with bots and starts
matches on its own rules. All flags (every one also works as a `TRA_*`
environment variable, e.g. `TRA_PORT=27601`):

| Flag | Meaning |
| --- | --- |
| `--host <addr>` | Interface to bind (default `0.0.0.0`) |
| `--port <n>` | TCP port (default `27600`) |
| `--password <text>` | Require this password to join |
| `--name <text>` | Server name shown in the lobby |
| `--map <id>` | Map id (default `shanasheel`) |
| `--mode <id>` | Game mode (`tdm`) |
| `--dedicated` | No lobby host; matches auto-start |
| `--bots none\|fixed\|fill` | Bot filling mode (default `fill`) |
| `--bots-tigris <n>` / `--bots-euphrates <n>` | Bots per team in `fixed` mode (0–5) |
| `--bot-difficulty easy\|normal\|hard\|extreme` | Bot preset (default `normal`) |
| `--score-limit <n>` | Kills to win (5–500, default 75) |
| `--time-limit <sec>` | Match length (60–3600, default 600) |
| `--respawn-delay <sec>` | Respawn delay (0–15, default 3) |
| `--friendly-fire [bool]` | Team damage (default off) |
| `--replace-bots [bool]` | Joining humans take over bot slots (default on) |
| `--log-level debug\|info\|warn\|error\|silent` | Log verbosity |

The server prints `TRA_SERVER_READY port=<port>` once it is listening.
Keeping it running as a service (systemd, Task Scheduler) is covered in
[docs/HOSTING.md](docs/HOSTING.md).

## Joining by IP

Main menu → **Join** → enter the address the host gave you:

- `192.168.1.20` — LAN, default port
- `203.0.113.7:27601` — internet, custom port
- `myhost.example.net:27600` — hostnames work too

Enter your player name, the password if the room has one, and connect. You can
join a match that is already in progress; if you drop out mid-match you can
reconnect with the same name within 30 seconds and get your slot back.

## Controls

Defaults; everything is rebindable in **Settings → Controls** (up to three
keys per action, mouse buttons and wheel included).

| Action | Default |
| --- | --- |
| Move | `W` `A` `S` `D` (or arrow keys) |
| Jump / mantle | `Space` |
| Crouch / slide | `Left Ctrl` or `C` (sprint, then crouch to slide) |
| Sprint | `Left Shift` |
| Fire | `Left mouse` |
| Aim down sights | `Right mouse` |
| Reload | `R` |
| Switch weapon | `Q` or mouse wheel |
| Primary / secondary weapon | `1` / `2` |
| Melee | `V` or `Middle mouse` |
| Lethal / tactical equipment | `G` / `F` |
| Interact | `E` |
| Scoreboard (hold) | `Tab` |
| Team chat | `T` or `Enter` |
| Menu / pause | `Esc` |
| Toggle fullscreen | `F11` |

Mouse sensitivity, ADS multiplier, invert-Y and toggle/hold for aim, crouch and
sprint are in the same settings tab.

## Settings and user data

The desktop app keeps its files in the Electron user-data folder:

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\Twin Rivers Arena\` |
| Linux (dev) | `~/.config/Twin Rivers Arena/` |

- `settings.json` — graphics, audio, controls, language, last used addresses
- `profile.json` — player name and loadout
- `*.corrupt` — a file that could not be parsed is moved aside under this
  name and defaults are used; delete `settings.json` to reset everything.

Writes are atomic (temp file + rename), so a crash never leaves a half-written
file. In a browser tab during development the same data lives in
`localStorage`.

## Troubleshooting

**"Port 27600 is already in use."** Another program (or a previous, still
running server) holds the port. Pick a different port on the host screen, or
find the culprit with `netstat -ano | findstr 27600` and close it.

**Windows Firewall asks about "Twin Rivers Arena".** Allow it on *private*
networks (and *public* if you host from a hotspot). The installer registers an
inbound rule for the game executable when it runs elevated; a dedicated server
started with `node` needs its own rule for `node.exe` or for TCP 27600. Details
in [docs/HOSTING.md](docs/HOSTING.md).

**Friends on the internet cannot connect, LAN works.** The TCP port must be
forwarded on the host's router to the hosting PC, and the host must share the
*public* IP. Step-by-step in [docs/HOSTING.md](docs/HOSTING.md).

**"Your game version does not match the server."** Both ends must run the same
build. Update the game (or the dedicated server bundle) so the versions match.

**Low frame rate, black canvas or "WebGPU unavailable" in the log.** The
renderer prefers WebGPU and falls back to WebGL 2 automatically. If WebGPU
misbehaves on your driver, turn it off in **Settings → Graphics** (takes
effect on the next match load) and lower the preset. Chromium disables GPU
acceleration entirely for drivers on its blocklist; update the graphics driver
first, or start the game with the environment variable `TRA_FORCE_GPU=1` to
override the blocklist at your own risk.

**The window is tiny / the UI is cut off.** The window needs at least
1280×720; press `F11` for fullscreen.

## Project layout

```
packages/
├── shared/    @tra/shared   protocol, constants, deterministic simulation, weapons, maps, nav grid
├── server/    @tra/server   authoritative game server (embedded and dedicated), esbuild bundle
├── client/    @tra/client   Babylon.js game + React UI, Vite
└── desktop/   @tra/desktop  Electron main/preload, embedded-server launcher, icon + NSIS installer
e2e/                         Playwright end-to-end tests
docs/                        ARCHITECTURE.md, HOSTING.md, STATUS.md, LICENSES.md
```

The shared package is consumed as TypeScript source by every other package,
so client and server run literally the same simulation code. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and milestone plan
and [docs/STATUS.md](docs/STATUS.md) for what is done.

## Licensing

All art and audio are procedural and original. Fonts are Noto Kufi Arabic and
Noto Naskh Arabic under the SIL Open Font License 1.1. Runtime libraries are
MIT / Apache-2.0. See [docs/LICENSES.md](docs/LICENSES.md) for the full list
and how to regenerate it.
