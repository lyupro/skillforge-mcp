/**
 * Server-entry resolution shared by every host installer.
 *
 * A host config entry is a { command, args } pair the host spawns to start
 * the SkillForge MCP server. Four entry shapes:
 *
 *  - 'bin'   — command=skillforge-mcp, args=['serve']. Avoids a wrapper and
 *              survives global package upgrades, but only when the command
 *              resolves on PATH and reports this package's exact version.
 *  - 'npx'   — command=npx, args=['-y', <pkg>, 'serve']. Resolves the package
 *              from the registry on every server spawn; needed only for a
 *              one-shot `npx … install` run with nothing installed on disk.
 *  - 'local' — command=node, args=[<binary>, 'serve']. Explicit binary path.
 *  - 'auto'  — (default) prefer the verified bin entry, then inspect the
 *              installer's own on-disk location and fall back to local / npx.
 */

import { fileURLToPath } from 'node:url';
import { posix, resolve, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { InstallOptions } from './types.js';

/** npm package name used by the npx entry shape. */
export const NPX_PKG = '@lyupro/skillforge-mcp';
export const BIN_COMMAND = 'skillforge-mcp';

interface PackageManifest {
  version?: unknown;
}

export interface BinProbeResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

export interface EntryResolution {
  entry: ServerEntry;
  fallbackReason?: string;
}

export interface EntryResolutionDeps {
  probeBin?: () => BinProbeResult;
  packageVersion?: string;
  moduleUrl?: string;
}

export interface CommandResolverDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  isFile?: (candidate: string) => boolean;
}

export interface BinProbeDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  resolveCommand?: (name: string) => string | undefined;
  spawn?: typeof spawnSync;
}

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

export function binEntry(): ServerEntry {
  return { command: BIN_COMMAND, args: ['serve'] };
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

function installedPackageVersion(): string {
  const manifest = createRequire(import.meta.url)('../../package.json') as PackageManifest;
  if (typeof manifest.version !== 'string') {
    throw new Error('package.json missing string "version" field');
  }
  return manifest.version;
}

/**
 * Probe budget. Releases before the CLI dispatcher shipped `skillforge-mcp` as
 * the server bin itself, which answered an unrecognised argument by waiting on
 * stdin forever. Probing such an install with an inherited stdin and no timeout
 * hangs the installer permanently — and an operator upgrading from those
 * releases is exactly who runs this. stdin is closed and the wait is bounded so
 * an old bin fails the probe instead of freezing the install.
 */
const PROBE_TIMEOUT_MS = 5_000;

function pathValue(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((entry) => entry.toLowerCase() === 'path');
  return key === undefined ? '' : (env[key] ?? '');
}

export function resolveCommandOnPath(
  name: string = BIN_COMMAND,
  deps: CommandResolverDeps = {},
): string | undefined {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const pathApi = platform === 'win32' ? win32 : posix;
  const separator = platform === 'win32' ? ';' : ':';
  const extensions = platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const isFile = deps.isFile ?? ((candidate: string) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  for (const directory of pathValue(env).split(separator).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, `${name}${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

export function probeBinVersion(deps: BinProbeDeps = {}): BinProbeResult {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const command = (deps.resolveCommand ?? ((name) => resolveCommandOnPath(name, {
    env,
    platform,
  })))(BIN_COMMAND);
  if (command === undefined) {
    return { ok: false, reason: `${BIN_COMMAND} was not found on PATH` };
  }
  const shell = platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  const result = (deps.spawn ?? spawnSync)(command, ['--version'], {
    encoding: 'utf8',
    env,
    shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: PROBE_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    return {
      ok: false,
      reason: `${command} could not be probed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `${BIN_COMMAND} --version exited with status ${String(result.status)}`,
    };
  }
  return { ok: true, version: String(result.stdout ?? '').trim() };
}

function verifiedBinFailure(deps: EntryResolutionDeps): string | undefined {
  const expected = deps.packageVersion ?? installedPackageVersion();
  const probe = (deps.probeBin ?? probeBinVersion)();
  if (!probe.ok) return probe.reason ?? `${BIN_COMMAND} could not be verified`;
  if (probe.version !== expected) {
    return `${BIN_COMMAND} --version reported ${JSON.stringify(probe.version ?? '')}; expected ${JSON.stringify(expected)}`;
  }
  return undefined;
}

export function resolveEntry(
  opts: InstallOptions,
  binaryFallback: string,
  deps: EntryResolutionDeps = {},
): EntryResolution {
  if (opts.entry === 'local') {
    return { entry: localEntry(opts.binaryPath ?? binaryFallback) };
  }
  if (opts.entry === 'npx') return { entry: npxEntry() };
  if (opts.entry === 'auto' && opts.binaryPath !== undefined) {
    return { entry: localEntry(opts.binaryPath) };
  }

  const failure = verifiedBinFailure(deps);
  if (failure === undefined) return { entry: binEntry() };
  if (opts.entry === 'bin') {
    throw new Error(`Cannot use --entry bin: ${failure}`);
  }
  return {
    entry: resolveAutoEntry(deps.moduleUrl),
    fallbackReason: `Using fallback entry because ${failure}`,
  };
}

/**
 * Build the server entry for the requested shape. An explicit `--binary-path`
 * forces a local entry on that path regardless of `npx` vs `auto`.
 */
export function buildEntry(
  opts: InstallOptions,
  binaryFallback: string,
  deps: EntryResolutionDeps = {},
): ServerEntry {
  return resolveEntry(opts, binaryFallback, deps).entry;
}
