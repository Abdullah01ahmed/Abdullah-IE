# Licences and attribution

## The game itself

Twin Rivers: Arena is an original work. Its code, map data, weapon designs,
team names and all text are written for this project.

- **Art** — every texture, material, prop, character silhouette, sky, icon and
  UI graphic is generated procedurally by code in this repository at build or
  run time (`packages/client/src/game/texgen.ts`, `Materials.ts`, `Props.ts`,
  `packages/desktop/scripts/make-icon.mjs`, …). No third-party images, models
  or brand assets are used.
- **Audio** — all sound effects, the announcer cues and interface sounds are
  synthesised at run time with the Web Audio API (`packages/client/src/game/Audio.ts`).
  No recorded samples or third-party sound libraries are used.
- **Names** — *Tigris*, *Euphrates*, *Shanasheel*, *Dijla-7* and *Shatt-9*
  reference Iraqi geography and architecture; the teams, the map and the
  weapons are fictional and do not depict real organisations or firearms.

The licence for the project's own code and content is set by the repository's
`LICENSE` file (see `license` in the root `package.json`). Until such a file is
present, all rights are reserved by the contributors.

## Fonts

| Font | Licence | Shipped via |
| --- | --- | --- |
| Noto Kufi Arabic | [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) | `@fontsource/noto-kufi-arabic` |
| Noto Naskh Arabic | [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) | `@fontsource/noto-naskh-arabic` |

Copyright the Noto Project Authors (<https://github.com/notofonts>). The OFL
allows bundling the fonts with the application; the fonts themselves are not
sold and their reserved font names are not used for modified versions. The
`@fontsource` packaging is MIT-licensed. Latin text uses the system font stack.

## Runtime and libraries shipped with the game

| Component | Licence | Notes |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | MIT | Desktop shell (Chromium and Node.js are bundled; Chromium's third-party notices ship as `LICENSES.chromium.html` next to the executable) |
| [Babylon.js](https://github.com/BabylonJS/Babylon.js) (`@babylonjs/core`) | Apache-2.0 | Renderer |
| [React](https://github.com/facebook/react), `react-dom` | MIT | Interface |
| [zustand](https://github.com/pmndrs/zustand) | MIT | UI state |
| [ws](https://github.com/websockets/ws) | MIT | WebSocket server (bundled into `server.cjs`) |
| [Vite](https://github.com/vitejs/vite) | MIT | Client bundler (build time) |
| [esbuild](https://github.com/evanw/esbuild) | MIT | Server / main-process bundler (build time) |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Build time |
| [electron-builder](https://github.com/electron-userland/electron-builder) | MIT | Installer tooling (build time); the installer itself is built with [NSIS](https://nsis.sourceforge.io/License) (zlib/libpng licence) |
| [vitest](https://github.com/vitest-dev/vitest), [Playwright](https://github.com/microsoft/playwright), [jsdom](https://github.com/jsdom/jsdom) | MIT | Tests only, not shipped |

Only the first five rows end up on a player's machine: Electron, Babylon.js,
React (+ react-dom, scheduler), zustand and the fonts are in the renderer
bundle; `ws` is inside the server bundle. Everything else is development
tooling.

## Regenerating the full dependency list

The tables above are curated. To list every package in the dependency tree
with its declared licence (for a release audit), run from the repository root
after `npm install`:

```bash
node -e '
const fs = require("fs"), path = require("path");
const seen = new Map();
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(dir, entry.name);
    if (entry.name.startsWith("@")) { walk(p); continue; }
    const pkgFile = path.join(p, "package.json");
    if (fs.existsSync(pkgFile)) {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
      const lic = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? (pkg.licenses || []).map(l => l.type).join(" OR ") || "UNKNOWN";
      seen.set(pkg.name + "@" + pkg.version, lic);
    }
    const nested = path.join(p, "node_modules");
    if (fs.existsSync(nested)) walk(nested);
  }
})("node_modules");
for (const [k, v] of [...seen].sort()) console.log(v.padEnd(28), k);
'
```

or, if network access is available, `npx license-checker-rseidelsohn --summary`
(and `--production` to restrict it to shipped packages). Review any entry that
prints `UNKNOWN`, and re-run the audit whenever `package-lock.json` changes.
