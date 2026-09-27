# Client UI

React 19 + zustand. `App.tsx` routes `store.screen` to a screen component,
mounts the single game canvas for `loading` / `match` / `results`, installs the
three match key handlers (pause, scoreboard, chat) and mirrors the language on
`<html lang dir>`. Styling is plain CSS with custom properties in
`src/styles/` (tokens → base → components → screens → hud); logical properties
keep RTL mirroring automatic.

## Layout

| Path | Purpose |
| --- | --- |
| `screens/MainMenu.tsx` | wordmark, player name, Host / Join / Loadout / Settings / Quit, error dialog, language switch |
| `screens/HostScreen.tsx` | server name, port, password, `MatchSettingsForm`; browser notice; calls `session.host()` |
| `screens/JoinScreen.tsx` | address (validated by `logic/address.ts`), recents, name, password; connecting/cancel; `session.join()` |
| `screens/LobbyScreen.tsx` | team panels (5 slots each), ready/start/countdown, host-only bot + kick controls, settings, hosting info, chat |
| `screens/LoadingScreen.tsx` | map card, progress from `store.loading`, rotating tips |
| `screens/MatchScreen.tsx` | `hud/Hud.tsx` plus overlays (`overlays/PauseMenu`, `ScoreboardOverlay`, `ResumeOverlay`) |
| `screens/ResultsScreen.tsx` | outcome banner, team scores, MVP, scoreboard, return countdown |
| `screens/SettingsPanel.tsx` | Graphics / Audio / Controls / Interface tabs; embedded by `SettingsScreen` and the pause menu |
| `screens/LoadoutScreen.tsx` | primary/secondary weapon cards with stat bars from `logic/weaponStats.ts` |
| `components/` | primitives (`Button`, `Field`, `Toggle`, `Slider`, `Segmented`, `Select`, `Dialog`, …), `Wordmark`, `Backdrop`, `ScreenFrame`, `MatchSettingsForm`, `ScoreboardTable`, `GameCanvas`, icons |
| `hooks/` | `useMatchKeys` (Esc / Tab / chat from the bindings), `usePointerLock`, `useClock` |
| `logic/` | pure, unit-tested helpers: address validation, scoreboard sorting, binding capture, error mapping, formatting |

All state flows through `state/store.ts`; the UI talks to the network and game
only through `session/Session.ts` (`session.*` and `session.game.*`). In
development, tests and `?e2e` pages, `window.__tra = { store, session }`.

## Adding a string

1. Add the key and English text to `src/i18n/en.ts` (keys are grouped by
   screen, e.g. `'lobby.readyUp'`). Placeholders use `{name}`.
2. Add the same key to `src/i18n/ar.ts`. TypeScript fails the build if a key is
   missing or extra, and `test/ui/i18n.test.ts` checks parity and placeholders.
3. Use it: `const t = useT(); t('lobby.readyUp')` in components, or the plain
   `t()` from `src/i18n` outside React. For bilingual game data (map / weapon
   names) use `bi(lang, english, arabic)`.

Keep numbers in Western digits, avoid `letter-spacing` on Arabic text (the
`.caps` helper already resets it under `[dir=rtl]`), and give directional icons
the `icon-dir` class so they mirror.
