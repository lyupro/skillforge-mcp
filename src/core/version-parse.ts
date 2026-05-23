/**
 * Version parsing for plugin-cache layouts.
 *
 * Host plugin caches lay skills out as `<root>/<bundle>/<semver>/...`, so the
 * same skill name can appear under two installed versions of one bundle. The
 * resolver uses these helpers to prefer the highest semver instead of whichever
 * version the filesystem happened to enumerate first.
 */

/** A parsed semver triple plus the raw segment it came from. */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

const SEMVER_SEGMENT = /^v?(\d+)\.(\d+)\.(\d+)/;

/**
 * Find the first path segment that looks like a semver (`1.2.3`, `v2.4.4`,
 * `2.7.3-beta`) and return it parsed. Returns null when no segment matches.
 * Splits on both POSIX and Windows separators so cached paths parse on either OS.
 */
export function parseVersionFromPath(p: string): ParsedVersion | null {
  const segments = p.split(/[\\/]/).filter((s) => s.length > 0);
  for (const seg of segments) {
    const m = SEMVER_SEGMENT.exec(seg);
    if (m !== null) {
      return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: seg };
    }
  }
  return null;
}

/**
 * The bundle name a skill path belongs to: the segment immediately before the
 * first semver segment (`<root>/<bundle>/<semver>/...`). Returns null when there
 * is no version segment or nothing precedes it. Used to key version policies.
 */
export function parseBundleFromPath(p: string): string | null {
  const segments = p.split(/[\\/]/).filter((s) => s.length > 0);
  for (let i = 0; i < segments.length; i++) {
    if (SEMVER_SEGMENT.test(segments[i]!)) {
      return i > 0 ? segments[i - 1]! : null;
    }
  }
  return null;
}

/**
 * Compare two parsed versions. Returns >0 when `a` is newer, <0 when `b` is
 * newer, 0 when equal on major.minor.patch.
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Whether a parsed version exactly matches a `major.minor.patch` pin string. */
export function matchesPin(v: ParsedVersion, pin: string): boolean {
  const m = SEMVER_SEGMENT.exec(pin.trim());
  if (m === null) return false;
  return v.major === Number(m[1]) && v.minor === Number(m[2]) && v.patch === Number(m[3]);
}
