# Twin Rivers: Arena — Architecture & Implementation Plan

Twin Rivers: Arena is an original 5v5 first-person arena shooter for Windows. Two
fictional teams — **Tigris** and **Euphrates** — fight fast, compact matches across
maps inspired by Iraqi cities and historical places. The game is an Electron
desktop application with a Babylon.js renderer, a React interface, and a separate
server-authoritative Node.js multiplayer server that is reachable by direct IP
(LAN or internet) and can also run as a dedicated server.

This document is the concise architecture and the milestone plan. Feature status
lives in [`STATUS.md`](./STATUS.md); hosting instructions live in
[`HOSTING.md`](./HOSTING.md).

## 1. Repository layout

```
twin-rivers-arena/
├── package.json                npm workspaces root, vitest projects, top-level scripts
├── packages/
│   ├── shared/                 @tra/shared — protocol, constants, deterministic simulation,
│   │                           weapon data, map schema + map data, bot navigation grid
│   ├── server/                 @tra/server — authoritative game server (embedded host + dedicated)
│   ├── client/                 @tra/client — Babylon.js game + React UI (Vite)
│   └── desktop/                @tra/desktop — Electron main/preload, server launcher,
│                               electron-builder (NSIS) Windows installer
├── e2e/                        end-to-end tests (Playwright driving Electron / Chromium)
└── docs/                       architecture, hosting, status, licensing
```

`@tra/shared` is consumed as TypeScript source by every other package (Vite,
esbuild, tsx and vitest all transpile it), so there is no build-order problem and
client and server literally run the same simulation code.

## 2. Technology

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) everywhere | one language for sim, server, client, tooling |
| Renderer | Babylon.js 9 — WebGPU when available, WebGL2 fallback | PBR, shadows, post-processing, instancing out of the box |
| UI | React 19 + zustand | screens, HUD, settings; store is readable from non-React game code |
| Desktop | Electron 44 | Chromium + Node in one runnable; `utilityProcess` hosts the embedded server |
| Server | Node 20+, `ws` WebSockets | authoritative loop; single-file esbuild bundle for embedding and dedicated hosting |
| Installer | electron-builder → NSIS x64 | standard Windows `Setup.exe` with install-dir choice, shortcuts, uninstaller |
| Tests | vitest (unit/integration), Playwright (E2E) | sim determinism, server rules, two-client join, packaged-app smoke |

Transport is WebSocket over TCP. It is available to the Electron renderer without
native modules, works through every NAT that forwards a TCP port, and is ample for
10 players at 60 Hz input / 20 Hz snapshots. The message layer is JSON in
Milestone 1; the protocol is versioned so a binary encoding can replace it later
without changing game code.

## 3. Runtime topology

```
┌────────────────────────── Electron app ──────────────────────────┐
│  main process (Node)                                             │
│   • window, settings/profile files in app.getPath('userData')    │
│   • "Host match" → utilityProcess.fork(resources/server.cjs)     │
│   • LAN address discovery, firewall/port guidance                 │
│  preload (contextBridge → window.tra)                            │
│  renderer (Chromium)                                             │
│   • React UI + HUD          • Babylon.js GameWorld               │
│   • Session (net ↔ store ↔ game)  • WebSocket client             │
└──────────────────────────────┬───────────────────────────────────┘
                               │ ws://host:27600  (LAN / internet / localhost)
┌──────────────────────────────┴───────────────────────────────────┐
│  @tra/server (embedded or dedicated)                              │
│   Room (lobby, teams, bots, settings, phases)                     │
│   Match loop @60 Hz: inputs → shared sim → weapons/lag-comp →     │
│   mode rules → 20 Hz per-client snapshots                         │
└───────────────────────────────────────────────────────────────────┘
```

A player who clicks **Host** runs an ordinary server process on their machine and
joins it as the first client (they become the lobby host). Other players join by
IP:port. A **dedicated server** is the same bundle started from the command line
with `--dedicated`; it has no host player and applies its own start rules.

## 4. Shared simulation (`packages/shared`)

* **Fixed tick**: 60 Hz. One `InputCmd` per tick. Inputs carry a sequence number
  and the client's estimate of server time (for lag compensation).
* **Movement**: capsule vs. axis-aligned boxes (the whole world is boxes), separate
  axis sweeps, step-up for stairs, mantling for ledges up to ~1.25 m, sprint,
  crouch, slide, jump, ADS speed scaling. Pure function: `simulateStep(state, input, world, dt)`.
* **Weapons**: per-weapon fire timing, magazine/reserve, reload and switch timers,
  spread and recoil driven by a seeded PRNG so client and server draw the same
  pattern. `stepWeapons()` returns `fire` events that the client uses for effects
  and the server uses to trace shots.
* **Hit detection**: hitscan ray vs. world boxes and vs. player hitboxes (body box
  + head sphere), with distance falloff and headshot multiplier.
* **Navigation**: `buildNavGrid(map)` samples walkable cells on every floor level
  (ground, rooftops, interiors), links neighbours by step height, and adds
  one-way drop links. Bots path with A* and move by producing the same `InputCmd`s
  humans do — they cannot do anything a human cannot.
* **Map schema**: `MapDef` = collision blocks with materials, decorative props,
  team/neutral spawns, lights, palette/atmosphere, kill-Z. Maps are authored in
  TypeScript with small builder helpers so they are reviewable and testable (spawn
  reachability, protected spawn sightlines, no floating nodes).

## 5. Networking model

* **Client prediction**: the local player runs `simulateStep` immediately for each
  input and stores pending inputs.
* **Reconciliation**: each snapshot carries `ack` (last processed input seq) and
  the authoritative self state; the client rewinds to it and replays pending
  inputs, smoothing small corrections instead of snapping.
* **Interpolation**: remote players render 100 ms in the past from a snapshot buffer.
* **Lag compensation**: the server keeps a 1 s ring of every player's hitbox pose;
  a shot is traced against the world as the shooter saw it at
  `input.time - INTERP_DELAY`, bounded to 200 ms of rewind.
* **Authority**: movement is validated (fixed dt, speed caps, bounded catch-up),
  and health, ammo, damage, kills, scores and match results exist only on the server.
* **Lifecycle**: join-in-progress, graceful disconnect (players are removed or,
  with bot replacement enabled, their slot is refilled), reconnection with the
  same name/token during a match, and typed reject/error codes
  (`SERVER_FULL`, `TEAM_FULL`, `BAD_PASSWORD`, `VERSION_MISMATCH`, `NAME_TAKEN`).

## 6. Teams and match structure

Two teams × exactly five slots; a slot is a human or a bot; the server never
admits an 11th participant. Bot filling is configurable (`none`, `fixed`,
`fill to 5v5`) with a global difficulty and per-bot overrides; when
"replace bots with humans" is on, a joining human takes a bot's slot on the
smaller team. Modes are pluggable (`GameMode` interface); Milestone 1 ships
Team Deathmatch with configurable score limit, time limit, respawn delay and
friendly fire. Phases: `lobby → loading → playing → results → lobby`.

## 7. Client structure (`packages/client`)

```
src/
├── net/Connection.ts       typed WebSocket client, ping/clock sync, error mapping
├── state/store.ts          zustand store: screen, connection, room, HUD, scoreboard, settings
├── session/Session.ts      orchestrates connection ↔ store ↔ GameWorld; host/join flows
├── game/                   Babylon.js: GameWorld, MapRenderer (procedural PBR materials),
│                           LocalPlayer (prediction), RemotePlayers (interpolation),
│                           Weapons (view model, recoil, muzzle flash, shells, tracers),
│                           Effects, Audio (procedural, positional), quality presets
├── ui/                     React screens + HUD (menu, host, join, lobby, loading,
│                           HUD, pause, scoreboard, results, settings, loadout)
├── i18n/                   English + Arabic dictionaries, RTL layout switch
└── platform/               Electron bridge (window.tra) with browser fallback
```

## 8. Milestones

**Milestone 1 — playable multiplayer foundation (this delivery)**
Electron app; first-person movement and shooting; Old Baghdad "Shanasheel" map;
two weapons; direct-IP host/join with optional password; two teams with a
five-slot limit each; bots (four difficulty presets already parameterised); Team
Deathmatch; first Windows NSIS installer; automated tests for the simulation,
team limits, two-client join, and a packaged-app smoke test.

**Milestone 2 — complete core systems**
Full bot behaviours per difficulty (cover, flanking, coordination), custom
loadout slots, attachments and perks, Domination / Hardpoint / Kill Confirmed,
progression + saved profiles, binary protocol, reconnection polish.

**Milestone 3 — content and presentation**
Toward eight maps and twenty weapons, skins and gear, animation/audio/lighting
upgrades, complete English and Arabic interfaces.

**Milestone 4 — optimisation and release**
Profiling (CPU/GPU/memory/network), fixes, installer/update/uninstall testing,
release build and setup file.

## 9. Verification strategy

* `npm run typecheck` — every package, strict TypeScript.
* `npm test` — shared sim determinism and collision, map validation (spawn
  reachability, no unreachable nav islands, spawn protection), server rules
  (team caps, 10-slot cap, password, version, bot fill/replace, TDM scoring and
  match end, join-in-progress, disconnect), client store/i18n logic.
* `npm run e2e` — starts a real server, connects two independent clients by IP,
  and drives the packaged Electron app through menu → host → lobby → match.
* `npm run dist:win` — produces `release/Twin Rivers Arena Setup <version>.exe`
  and `release/win-unpacked/` (runnable x64 app).
