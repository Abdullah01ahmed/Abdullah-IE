#!/usr/bin/env node
/**
 * Runs electron-builder for this package.
 *
 * `electron` is hoisted to the workspace root, where electron-builder does not
 * look, so it cannot discover the installed version itself and would refuse
 * the `^` range in package.json. This wrapper reads the installed version and
 * passes it as `electronVersion`, overriding the value pinned in
 * electron-builder.yml (kept there so a bare `npx electron-builder` still
 * works) and warning when the two drift apart.
 *
 * Usage: node scripts/dist.mjs <electron-builder arguments>
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const installed = require('electron/package.json').version;

const yml = readFileSync(path.join(DESKTOP_DIR, 'electron-builder.yml'), 'utf8');
const pinned = /^electronVersion:\s*['"]?([^'"\s#]+)/m.exec(yml)?.[1];
if (pinned && pinned !== installed) {
  console.warn(`dist: electron-builder.yml pins electronVersion ${pinned} but electron ${installed} is installed; building with ${installed}. Update the yml to match.`);
}

const builderPkgPath = require.resolve('electron-builder/package.json');
const builderPkg = JSON.parse(readFileSync(builderPkgPath, 'utf8'));
const bin = typeof builderPkg.bin === 'string' ? builderPkg.bin : builderPkg.bin['electron-builder'];
const cli = path.join(path.dirname(builderPkgPath), bin);

const args = [cli, ...process.argv.slice(2), `--config.electronVersion=${installed}`];
console.log(`dist: electron-builder ${args.slice(1).join(' ')}`);
const result = spawnSync(process.execPath, args, { cwd: DESKTOP_DIR, stdio: 'inherit' });
if (result.error) {
  console.error(`dist: could not start electron-builder: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
