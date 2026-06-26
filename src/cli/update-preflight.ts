/**
 * Pre-flight detection for `skillforge update`.
 *
 * Two install failure modes are caught BEFORE npm runs, instead of after a
 * confusing npm stack trace: a root-owned global prefix (the install will hit
 * EACCES and needs sudo) and an npm `min-release-age` cooldown that would block
 * or silently downgrade a just-published latest.
 *
 * Both are only ever surfaced, never auto-resolved. Auto-`sudo` is silent
 * privilege escalation; auto-`--min-release-age=0` silently defeats a
 * supply-chain cooldown the operator set on purpose. The decision stays the
 * user's — these helpers just detect and the caller prints guidance.
 *
 * Every helper is pure or trivially fakeable so `update.ts` can be tested
 * without a real npm, filesystem, or registry.
 */

import { access, constants } from 'node:fs/promises';

const DAY_MS = 86_400_000;

/** `npm root -g` → the global node_modules dir, or null when npm can't be queried. */
export async function defaultGlobalRoot(): Promise<string | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const { stdout } = await run('npm', ['root', '-g'], {
      shell: process.platform === 'win32',
    });
    const dir = stdout.trim();
    return dir.length > 0 ? dir : null;
  } catch {
    return null;
  }
}

/** Whether `dir` is writable by the current user. False on any access error. */
export async function defaultIsWritable(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Current POSIX uid, or null on platforms without `process.getuid` (Windows). */
export function defaultGetUid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

/**
 * `npm config get min-release-age` → configured cooldown in days, or null when
 * unset / zero / unparseable. npm prints `undefined` (or empty) when unset.
 */
export async function defaultMinReleaseAge(): Promise<number | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const { stdout } = await run('npm', ['config', 'get', 'min-release-age'], {
      shell: process.platform === 'win32',
    });
    return parseMinReleaseAge(stdout);
  } catch {
    return null;
  }
}

/** Parse the raw `npm config get min-release-age` output into days, or null. */
export function parseMinReleaseAge(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Whether a global install will be denied for the current user: POSIX, not
 * root, and the global prefix is not writable. Windows (uid === null) returns
 * false — there is no sudo there and EACCES on the user-owned prefix is rare;
 * the reactive fail-loud path covers the exception.
 */
export function needsSudo(opts: {
  platform: NodeJS.Platform;
  uid: number | null;
  writable: boolean;
}): boolean {
  if (opts.platform === 'win32') return false;
  if (opts.uid === null || opts.uid === 0) return false;
  return !opts.writable;
}

/** Days between a publish timestamp and `nowMs`; null when missing/unparseable. */
export function ageInDays(publishedAt: string | null, nowMs: number): number | null {
  if (publishedAt === null) return null;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return null;
  return (nowMs - t) / DAY_MS;
}

/** Whether a configured cooldown would block installing a version of the given age. */
export function cooldownBlocks(minAgeDays: number | null, ageDays: number | null): boolean {
  if (minAgeDays === null || minAgeDays <= 0) return false;
  if (ageDays === null) return false;
  return ageDays < minAgeDays;
}
