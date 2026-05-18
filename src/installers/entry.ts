/**
 * Server-entry resolution shared by every host installer.
 *
 * A host config entry is a { command, args } pair the host spawns to start
 * the SkillForge MCP server. Three entry shapes:
 *
 *  - 'npx'   — command=npx, args=['-y', <pkg>, 'serve']. Resolves the package
 *              from the registry on every server spawn; needed only for a
 *              one-shot `npx … install` run with nothing installed on disk.
 *  - 'local' — command=node, args=[<binary>, 'serve']. Explicit binary path.
 *  - 'auto'  — (default) inspect the installer's own on-disk location: a
 *              stable install resolves to a node-entry on the absolute
 *              dispatcher path (no registry round-trip, offline-safe); an
 *              ephemeral `npx` run has no stable file to point at and falls
 *              back to an npx-entry.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { InstallOptions } from './types.js';

/** npm package name used by the npx entry shape. */
export const NPX_PKG = '@lyupro/skillforge-mcp';

/** A host MCP server config entry — the { command, args } pair to spawn. */
export interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** npx entry — registry round-trip on every server spawn. */
export function npxEntry(): ServerEntry {
  return { command: 'npx', args: ['-y', NPX_PKG, 'serve'] };
}

/** Local node entry pointing at an absolute binary path. */
export function localEntry(binary: string): ServerEntry {
  return { command: 'node', args: [binary, 'serve'] };
}

/**
 * True when `modulePath` lives inside an npx cache directory — i.e. the
 * installer is running from a one-shot `npx @lyupro/skillforge-mcp install`
 * rather than a stable global / local install. npx caches each package run
 * under a `_npx` path segment (`~/.npm/_npx/<hash>/node_modules/...`).
 */
export function isEphemeralPath(modulePath: string): boolean {
  return modulePath.split(/[\\/]/).includes('_npx');
}

/**
 * Resolve the absolute path to `dist/cli/dispatcher.js` from a module URL.
 * This file lives at <root>/(dist|src)/installers/entry.(js|ts); the
 * dispatcher target is always <root>/dist/cli/dispatcher.js, so resolving
 * three segments up to the package root then down works from both layouts.
 */
export function resolveDispatcherPath(moduleUrl: string): string {
  const here = fileURLToPath(moduleUrl);
  return resolve(here, '..', '..', '..', 'dist', 'cli', 'dispatcher.js');
}

/**
 * `--entry auto`: a stable install → a node-entry on the absolute dispatcher
 * path; an ephemeral `npx` run → an npx-entry (no stable file to point at).
 * `moduleUrl` is injectable so tests can exercise both branches.
 */
export function resolveAutoEntry(moduleUrl: string = import.meta.url): ServerEntry {
  const here = fileURLToPath(moduleUrl);
  if (isEphemeralPath(here)) return npxEntry();
  return localEntry(resolveDispatcherPath(moduleUrl));
}

/**
 * Build the server entry for the requested shape. An explicit `--binary-path`
 * forces a local entry on that path regardless of `npx` vs `auto`.
 */
export function buildEntry(opts: InstallOptions, binaryFallback: string): ServerEntry {
  if (opts.entry === 'local') return localEntry(opts.binaryPath ?? binaryFallback);
  if (opts.entry === 'npx') return npxEntry();
  // 'auto'
  if (opts.binaryPath !== undefined) return localEntry(opts.binaryPath);
  return resolveAutoEntry();
}
