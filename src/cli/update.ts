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
 * Invariants kept on purpose:
 *   - Package name is read from package.json, never a literal — the registry
 *     id is volatile and a buried fallback would silently hit the wrong name.
 *   - A failed install is fail-loud: the exact command (with a sudo hint) is
 *     printed and the process exits non-zero. Nothing is retried silently.
 *   - Pre-flight detection (see update-preflight.ts) surfaces a root-owned
 *     global prefix and an npm min-release-age cooldown BEFORE running npm, but
 *     never auto-sudos and never auto-bypasses the cooldown — both are the
 *     user's call (sudo command / `--min-release-age 0` are printed, not run).
 *
 * Package manager: v1 assumes npm (the documented install path). pnpm/yarn
 * global users run `--dry-run` and copy the printed command. Auto-detecting
 * the global package manager is a future enhancement.
 *
 * Usage:
 *   skillforge update [--check] [--dry-run] [--registry <url>] [--json] [--min-release-age <n>]
 *   skillforge upgrade [...]        Hidden alias of update.
 */

import { compareVersions, parseVersionFromPath } from '../core/version-parse.js';
import { readPackageMeta } from './dispatcher.js';
import { extractLogFlags } from './log-flags.js';
import {
  ageInDays,
  cooldownBlocks,
  defaultGetUid,
  defaultGlobalRoot,
  defaultIsWritable,
  defaultMinReleaseAge,
  needsSudo,
} from './update-preflight.js';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** The registry's view of a package's latest version plus when it was published. */
export interface LatestInfo {
  version: string;
  /** ISO publish timestamp from the registry `time` map, or null when absent. */
  publishedAt: string | null;
}

export interface UpdateDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Resolve { name, version } of the running package. Tests inject a fake. */
  readMeta?: () => Promise<{ name: string; version: string }>;
  /** Fetch the latest version + publish time for a package from a registry base URL. */
  fetchLatest?: (packageName: string, registryBase: string) => Promise<LatestInfo>;
  /** Run the upgrade command; resolves with its exit code. Tests inject a fake. */
  runUpgrade?: (cmd: string, args: string[]) => Promise<number>;
  /** `npm root -g` → global node_modules dir (null = unknown). Tests inject a fake. */
  globalRoot?: () => Promise<string | null>;
  /** Whether a directory is writable by the current user. */
  isWritable?: (dir: string) => Promise<boolean>;
  /** Current POSIX uid (null on Windows). */
  getUid?: () => number | null;
  /** Configured npm `min-release-age` cooldown in days (null = none). */
  minReleaseAge?: () => Promise<number | null>;
  /** Wall-clock now in ms — injectable for deterministic cooldown tests. */
  now?: () => number;
  /** Host platform — injectable so sudo detection is testable off-POSIX. */
  platform?: NodeJS.Platform;
}

const USAGE = `skillforge update — update the SkillForge CLI to the latest published version.

Usage:
  skillforge update [flags]
  skillforge upgrade [flags]       Alias of update.

Flags:
  --check                Only check; print whether an update is available. No install.
  --dry-run              Print the install command without running it.
  --registry <url>       Registry base URL (default ${DEFAULT_REGISTRY}).
  --json                 Machine-readable { current, latest, updateAvailable }. No install.
  --min-release-age <n>  Forward npm's min-release-age (days) to the install. Pass 0 to
                         install a just-published latest despite a configured cooldown.
  --help, -h             Show this message.

Notes:
  Updates are applied with npm: \`npm install -g <name>@latest\`.
  - Permissions: if the global prefix is root-owned (common on Linux), the exact
    sudo command is printed — it is never run for you. To avoid sudo entirely, use a
    user-owned prefix (npm config set prefix ~/.npm-global) or a version manager
    (nvm / fnm / volta).
  - Cooldown: if npm's min-release-age blocks a just-published latest, that is
    reported with the --min-release-age 0 opt-in; the cooldown is never bypassed
    silently. (--min-release-age cannot be combined with npm's --before.)
  - pnpm/yarn-global users should run --dry-run and copy the printed command.
`;

/**
 * Default registry fetch: GET <base>/<name> via global fetch (Node >=20).
 * Returns `dist-tags.latest` plus its publish timestamp from the `time` map
 * (used to detect whether a min-release-age cooldown would block the install).
 */
async function defaultFetchLatest(packageName: string, registryBase: string): Promise<LatestInfo> {
  const base = registryBase.replace(/\/+$/, '');
  // npm registry addresses scoped packages as `@scope%2Fname` — encode only the slash.
  const encoded = packageName.replace('/', '%2F');
  const res = await fetch(`${base}/${encoded}`);
  if (!res.ok) {
    throw new Error(`registry responded ${res.status} ${res.statusText} for ${packageName}`);
  }
  const data = (await res.json()) as {
    'dist-tags'?: { latest?: unknown };
    time?: Record<string, unknown>;
  };
  const latest = data['dist-tags']?.latest;
  if (typeof latest !== 'string' || latest.length === 0) {
    throw new Error(`registry returned no dist-tags.latest for ${packageName}`);
  }
  const published = data.time?.[latest];
  return { version: latest, publishedAt: typeof published === 'string' ? published : null };
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
  /** Explicit min-release-age (days) to forward to npm, or null when not passed. */
  minReleaseAge: number | null;
}

/** Parse a non-negative integer; null when not a valid count. */
function parseAge(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** Parse update flags. Returns null on a malformed flag (caller emits usage, exits 2). */
function parseFlags(argv: string[], stderr: (t: string) => void): UpdateFlags | null {
  const flags: UpdateFlags = {
    check: false,
    dryRun: false,
    asJson: false,
    registry: DEFAULT_REGISTRY,
    help: false,
    minReleaseAge: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Accept both `--min-release-age 7` and `--min-release-age=7` (npm's own form).
    if (arg === '--min-release-age' || arg.startsWith('--min-release-age=')) {
      const inline = arg.startsWith('--min-release-age=') ? arg.slice('--min-release-age='.length) : argv[++i];
      const parsed = inline === undefined ? null : parseAge(inline);
      if (parsed === null) {
        stderr('skillforge update: --min-release-age requires a non-negative integer (days)\n');
        return null;
      }
      flags.minReleaseAge = parsed;
      continue;
    }
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

/** Proactive message when the global prefix is root-owned — print sudo, never run it. */
function sudoNeeded(printable: string, root: string): string {
  return (
    `✗ cannot write to the global npm prefix: ${root}\n` +
    `Updating a global install there needs elevated rights. Run:\n` +
    `  sudo ${printable}\n` +
    `Or avoid sudo for good with a user-owned prefix or a version manager:\n` +
    `  npm config set prefix ~/.npm-global   # then add ~/.npm-global/bin to PATH\n` +
    `  # or use nvm / fnm / volta\n`
  );
}

/** Proactive message when a configured npm cooldown blocks the just-published latest. */
function cooldownBlocked(latest: string, ageDays: number, minAge: number, printable: string): string {
  const age = ageDays < 1 ? '<1' : String(Math.floor(ageDays));
  return (
    `✗ npm min-release-age (${minAge}d) blocks ${latest}: it was published ${age} day(s) ago.\n` +
    `This is a supply-chain cooldown — it is not bypassed automatically. To install it now:\n` +
    `  skillforge update --min-release-age 0\n` +
    `Or wait until the version is at least ${minAge} day(s) old, then re-run skillforge update.\n` +
    `(Equivalent npm command: ${printable} --min-release-age=0)\n`
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
  const globalRoot = deps.globalRoot ?? defaultGlobalRoot;
  const isWritable = deps.isWritable ?? defaultIsWritable;
  const getUid = deps.getUid ?? defaultGetUid;
  const minReleaseAge = deps.minReleaseAge ?? defaultMinReleaseAge;
  const now = deps.now ?? (() => Date.now());
  const platform = deps.platform ?? process.platform;

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
  let latest: LatestInfo;
  let updateAvailable: boolean;
  try {
    const meta = await readMeta();
    name = meta.name;
    current = meta.version;
    latest = await fetchLatest(name, flags.registry);
    const parsedCurrent = parseVersionFromPath(current);
    const parsedLatest = parseVersionFromPath(latest.version);
    if (parsedCurrent === null) {
      throw new Error(`cannot parse current version "${current}"`);
    }
    if (parsedLatest === null) {
      throw new Error(`registry returned an unparseable latest version "${latest.version}"`);
    }
    updateAvailable = compareVersions(parsedLatest, parsedCurrent) > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge update: failed to check for updates: ${msg}\n`);
    return 1;
  }

  const latestVersion = latest.version;

  if (flags.asJson) {
    stdout(`${JSON.stringify({ current, latest: latestVersion, updateAvailable })}\n`);
    return 0;
  }

  if (!updateAvailable) {
    stdout(`✓ skillforge is up to date (${current})\n`);
    return 0;
  }

  // npm args + their printable form, including an explicit --min-release-age passthrough.
  const npmArgs = ['install', '-g', `${name}@latest`];
  if (flags.minReleaseAge !== null) npmArgs.push(`--min-release-age=${flags.minReleaseAge}`);
  const printable = `npm ${npmArgs.join(' ')}`;

  if (flags.check) {
    stdout(`update available: ${current} → ${latestVersion}\nRun \`skillforge update\` to install.\n`);
    return 0;
  }

  if (flags.dryRun) {
    stdout(`update available: ${current} → ${latestVersion}\nWould run: ${printable}\n`);
    return 0;
  }

  // Pre-flight 1 — cooldown. Skipped when the user passed --min-release-age (their
  // explicit choice); otherwise refuse to silently install an older version.
  if (flags.minReleaseAge === null) {
    const configAge = await minReleaseAge();
    const age = ageInDays(latest.publishedAt, now());
    if (configAge !== null && age !== null && cooldownBlocks(configAge, age)) {
      stderr(cooldownBlocked(latestVersion, age, configAge, printable));
      return 1;
    }
  }

  // Pre-flight 2 — permissions. Detect a root-owned global prefix up front and print the
  // sudo command instead of letting npm fail with a stack trace. Never auto-sudo.
  const root = await globalRoot();
  if (root !== null) {
    const writable = await isWritable(root);
    if (needsSudo({ platform, uid: getUid(), writable })) {
      stderr(sudoNeeded(printable, root));
      return 1;
    }
  }

  stdout(`Updating ${current} → ${latestVersion} …\n`);
  let code: number;
  try {
    code = await runUpgrade('npm', npmArgs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(failLoud(printable, msg));
    return 1;
  }
  if (code !== 0) {
    stderr(failLoud(printable, `npm exited with code ${code}`));
    return code;
  }
  stdout(`✓ updated to ${latestVersion} (${printable})\n`);
  return 0;
}
