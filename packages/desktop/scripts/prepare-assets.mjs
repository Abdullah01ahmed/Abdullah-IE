#!/usr/bin/env node
/**
 * Stages the other packages' build output where electron-builder (and
 * `electron .` in a packaged-style run) expect it:
 *
 *   packages/client/dist/**            -> packages/desktop/renderer/
 *   packages/server/dist/server.cjs    -> packages/desktop/resources/server/server.cjs
 *   packages/server/dist/server.cjs.map (if present) alongside it
 *
 * Both destinations are cleaned first so stale files never ship. Missing
 * inputs fail loudly with the command that produces them.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.resolve(DESKTOP_DIR, '..');

const CLIENT_DIST = path.join(PACKAGES_DIR, 'client', 'dist');
const SERVER_BUNDLE = path.join(PACKAGES_DIR, 'server', 'dist', 'server.cjs');
const RENDERER_OUT = path.join(DESKTOP_DIR, 'renderer');
const SERVER_OUT = path.join(DESKTOP_DIR, 'resources', 'server');

function require(condition, message) {
  if (condition) return;
  console.error(`prepare-assets: ${message}`);
  process.exit(1);
}

const rel = (p) => path.relative(PACKAGES_DIR, p).split(path.sep).join('/');

require(
  existsSync(path.join(CLIENT_DIST, 'index.html')),
  `client build not found at packages/${rel(CLIENT_DIST)}/index.html — run "npm run build -w @tra/client" (or "npm run build:client" at the repo root) first.`,
);
require(
  existsSync(SERVER_BUNDLE),
  `server bundle not found at packages/${rel(SERVER_BUNDLE)} — run "npm run build -w @tra/server" (or "npm run build:server" at the repo root) first.`,
);

rmSync(RENDERER_OUT, { recursive: true, force: true });
cpSync(CLIENT_DIST, RENDERER_OUT, { recursive: true });
console.log(`prepare-assets: copied packages/${rel(CLIENT_DIST)} -> packages/${rel(RENDERER_OUT)}`);

rmSync(SERVER_OUT, { recursive: true, force: true });
mkdirSync(SERVER_OUT, { recursive: true });
cpSync(SERVER_BUNDLE, path.join(SERVER_OUT, 'server.cjs'));
const sourceMap = `${SERVER_BUNDLE}.map`;
if (existsSync(sourceMap)) cpSync(sourceMap, path.join(SERVER_OUT, 'server.cjs.map'));
console.log(`prepare-assets: copied packages/${rel(SERVER_BUNDLE)}${existsSync(sourceMap) ? ' (+ .map)' : ''} -> packages/${rel(SERVER_OUT)}/`);
