#!/usr/bin/env node
/**
 * SkillForge `update` subcommand (self-update CLI).
 *
 * Updating a global install used to be a hand-typed
 * `npm install -g @lyupro/skillforge-mcp@latest` (plus `sudo` on a VPS) with
 * no way to even check whether a newer version exists. This subcommand reads
 * the running package's name + version from its own package.json, asks the
 * npm registry for the published `dist-tags.latest`, and either reports the
 * gap (`--check` / `--json`) or applies it via `npm install -g <name>@latest`.
 *
 * Two invariants kept on purpose:
 *   - Package name is read from package.json, never a literal — the registry
 *     id is volatile and a buried fallback would silently hit the wrong name.
 *   - A failed install is fail-loud: the exact command (with a sudo hint) is
 *     printed and the process exits non-zero. Nothing is retried silently.
 *
 * Package manager: v1 assumes npm (the documented install path). pnpm/yarn
 * global users run `--dry-run` and copy the printed command. Auto-detecting
 * the global package manager is a future enhancement.
 *
 * Usage:
 *   skillforge update [--check] [--dry-run] [--registry <url>] [--json]
 *   skillforge upgrade [...]        Hidden alias of update.
 */

import { compareVersions, parseVersionFromPath } from '../core/version-parse.js';
import { readPackageMeta } from './dispatcher.js';
import { extractLogFlags } from './log-flags.js';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export interface UpdateDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Resolve { name, version } of the running package. Tests inject a fake. */
  readMeta?: () => Promise<{ name: string; version: string }>;
  /** Fetch the published latest version for a package from a registry base URL. */
  fetchLatest?: (packageName: string, registryBase: string) => Promise<string>;
  /** Run the upgrade command; resolves with its exit code. Tests inject a fake. */
  runUpgrade?: (cmd: string, args: string[]) => Promise<number>;
}

const USAGE = `skillforge update — update the SkillForge CLI to the latest published version.

Usage:
  skillforge update [flags]
  skillforge upgrade [flags]       Alias of update.

Flags:
  --check            Only check; print whether an update is available. No install.
  --dry-run          Print the install command without running it.
  --registry <url>   Registry base URL (default ${DEFAULT_REGISTRY}).
  --json             Machine-readable { current, latest, updateAvailable }. No install.
  --help, -h         Show this message.

Notes:
  Updates are applied with npm: \`npm install -g <name>@latest\`. pnpm/yarn-global
  users should run --dry-run and copy the printed command. On a permission error
  the exact command is printed with a sudo hint and the process exits non-zero —
  nothing is retried silently.
`;

/** Default registry fetch: GET <base>/<name> → dist-tags.latest via global fetch (Node >=20). */
async function defaultFetchLatest(packageName: string, registryBase: string): Promise<string> {
  const base = registryBase.replace(/\/+$/, '');
  // npm registry addresses scoped packages as `@scope%2Fname` — encode only the slash.
  const encoded = packageName.replace('/', '%2F');
  const res = await fetch(`${base}/${encoded}`);
  if (!res.ok) {
    throw new Error(`registry responded ${res.status} ${res.statusText} for ${packageName}`);
  }
  const data = (await res.json()) as { 'dist-tags'?: { latest?: unknown } };
  const latest = data['dist-tags']?.latest;
  if (typeof latest !== 'string' || latest.length === 0) {
    throw new Error(`registry returned no dist-tags.latest for ${packageName}`);
  }
  return latest;
}

/** Default upgrade runner: spawn `npm install -g <name>@latest` inheriting stdio. */
async function defaultRunUpgrade(cmd: string, args: string[]): Promise<number> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    // shell on win32: the global npm bin is `npm.cmd`, not directly spawnable.
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });
}

interface UpdateFlags {
  check: boolean;
  dryRun: boolean;
  asJson: boolean;
  registry: string;
  help: boolean;
}

/** Parse update flags. Returns null on a malformed flag (caller emits usage, exits 2). */
function parseFlags(argv: string[], stderr: (t: string) => void): UpdateFlags | null {
  const flags: UpdateFlags = {
    check: false,
    dryRun: false,
    asJson: false,
    registry: DEFAULT_REGISTRY,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--check':
        flags.check = true;
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--json':
        flags.asJson = true;
        break;
      case '--registry': {
        const val = argv[i + 1];
        if (val === undefined || val.startsWith('-')) {
          stderr('skillforge update: --registry requires a URL\n');
          return null;
        }
        flags.registry = val;
        i++;
        break;
      }
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        stderr(`skillforge update: unknown flag: ${arg}\n`);
        return null;
    }
  }
  return flags;
}

/** Fail-loud message for a failed install — exact command + sudo hint. */
function failLoud(printable: string, reason: string): string {
  return (
    `${'✗'} update failed: ${reason}\n` +
    `Run it manually:\n` +
    `  ${printable}\n` +
    `If this failed with EACCES / permission denied, your global npm prefix needs elevated rights:\n` +
    `  sudo ${printable}\n`
  );
}

/**
 * `update` subcommand entry. Returns an exit code:
 *   - 0 on success (up-to-date, check, dry-run, applied OK, or --json)
 *   - 2 on a malformed flag
 *   - non-zero on a failed registry check or a failed install (fail-loud)
 */
export async function main(rawArgv: string[], deps: UpdateDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const readMeta = deps.readMeta ?? readPackageMeta;
  const fetchLatest = deps.fetchLatest ?? defaultFetchLatest;
  const runUpgrade = deps.runUpgrade ?? defaultRunUpgrade;

  const { rest } = extractLogFlags(rawArgv);
  const flags = parseFlags(rest, stderr);
  if (flags === null) {
    stderr(USAGE);
    return 2;
  }
  if (flags.help) {
    stdout(USAGE);
    return 0;
  }

  let name: string;
  let current: string;
  let latest: string;
  let updateAvailable: boolean;
  try {
    const meta = await readMeta();
    name = meta.name;
    current = meta.version;
    latest = await fetchLatest(name, flags.registry);
    const parsedCurrent = parseVersionFromPath(current);
    const parsedLatest = parseVersionFromPath(latest);
    if (parsedCurrent === null) {
      throw new Error(`cannot parse current version "${current}"`);
    }
    if (parsedLatest === null) {
      throw new Error(`registry returned an unparseable latest version "${latest}"`);
    }
    updateAvailable = compareVersions(parsedLatest, parsedCurrent) > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge update: failed to check for updates: ${msg}\n`);
    return 1;
  }

  if (flags.asJson) {
    stdout(`${JSON.stringify({ current, latest, updateAvailable })}\n`);
    return 0;
  }

  if (!updateAvailable) {
    stdout(`✓ skillforge is up to date (${current})\n`);
    return 0;
  }

  const printable = `npm install -g ${name}@latest`;

  if (flags.check) {
    stdout(`update available: ${current} → ${latest}\nRun \`skillforge update\` to install.\n`);
    return 0;
  }

  if (flags.dryRun) {
    stdout(`update available: ${current} → ${latest}\nWould run: ${printable}\n`);
    return 0;
  }

  stdout(`Updating ${current} → ${latest} …\n`);
  let code: number;
  try {
    code = await runUpgrade('npm', ['install', '-g', `${name}@latest`]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(failLoud(printable, msg));
    return 1;
  }
  if (code !== 0) {
    stderr(failLoud(printable, `npm exited with code ${code}`));
    return code;
  }
  stdout(`✓ updated to ${latest} (${printable})\n`);
  return 0;
}
