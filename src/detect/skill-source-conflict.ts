/**
 * Skill-source conflict detection.
 *
 * When a skill folder is registered that ALSO lives inside a host CLI's
 * native plugin/extension store, the same skills load twice — wasted tokens
 * and skill-name collisions. SkillForge detects this and prints a hint so the
 * user can disable one source. We NEVER mutate another tool's config: this is
 * detection + hint only.
 *
 * Detection is pure path logic — no host config file is read or written.
 * The home directory is injectable so tests can supply a fake root.
 */

import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

/** A host CLI whose native plugin/extension system can double-load skills. */
export type ConflictHost = 'claude' | 'gemini';

export interface SkillSourceConflict {
  /** The host CLI that natively serves skills from this path. */
  host: ConflictHost;
  /** Native unit kind: Claude Code has plugins, Gemini CLI has extensions. */
  kind: 'plugin' | 'extension';
  /** Human-readable plugin/extension name derived from the path. */
  name: string;
  /** The absolute folder path that triggered the conflict. */
  folderPath: string;
}

/** Normalise to an absolute path with consistent separators for prefix tests. */
function normalize(p: string): string {
  return resolve(p);
}

/**
 * Return the path segments of `child` that follow `root`, or null when
 * `child` is not inside `root`. Comparison is done on resolved absolute
 * paths; segment splitting uses the platform separator.
 */
function segmentsUnder(child: string, root: string): string[] | null {
  const absChild = normalize(child);
  const absRoot = normalize(root);
  const rootWithSep = absRoot.endsWith(sep) ? absRoot : absRoot + sep;
  if (!absChild.startsWith(rootWithSep)) return null;
  return absChild
    .slice(rootWithSep.length)
    .split(sep)
    .filter((s) => s.length > 0);
}

/**
 * Detect whether `folderPath` is served by a host CLI's native plugin or
 * extension system.
 *
 * - Claude Code — `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/...`
 *   The plugin name is the `<plugin>` segment (the marketplace prefix is
 *   included when present for a clearer label).
 * - Gemini CLI — `~/.gemini/extensions/<extension>/...`
 *   The extension name is the first segment after `extensions/`.
 *
 * Codex and Cursor have no native skill system — they never conflict.
 *
 * @param folderPath Absolute folder path being registered.
 * @param home       Home directory root, injectable for tests.
 * @returns A conflict descriptor, or null when there is no conflict.
 */
export function detectSkillSourceConflict(
  folderPath: string,
  home: string = homedir(),
): SkillSourceConflict | null {
  const claudeCacheRoot = resolve(home, '.claude', 'plugins', 'cache');
  const claudeSegments = segmentsUnder(folderPath, claudeCacheRoot);
  if (claudeSegments !== null && claudeSegments.length > 0) {
    // cache/<marketplace>/<plugin>/<version>/... — prefer "marketplace/plugin"
    // as the label; fall back to whatever single segment exists.
    const marketplace = claudeSegments[0]!;
    const plugin = claudeSegments[1];
    const name = plugin !== undefined ? `${marketplace}/${plugin}` : marketplace;
    return {
      host: 'claude',
      kind: 'plugin',
      name,
      folderPath: normalize(folderPath),
    };
  }

  const geminiExtRoot = resolve(home, '.gemini', 'extensions');
  const geminiSegments = segmentsUnder(folderPath, geminiExtRoot);
  if (geminiSegments !== null && geminiSegments.length > 0) {
    return {
      host: 'gemini',
      kind: 'extension',
      name: geminiSegments[0]!,
      folderPath: normalize(folderPath),
    };
  }

  return null;
}

/** Human-readable host label for the hint text. */
function hostLabel(host: ConflictHost): string {
  return host === 'claude' ? 'Claude Code' : 'Gemini CLI';
}

/** The host-specific command the user runs to disable the conflicting source. */
function disableCommand(conflict: SkillSourceConflict): string {
  if (conflict.host === 'claude') {
    return `run /plugin and disable the "${conflict.name}" plugin`;
  }
  return `/extensions disable ${conflict.name}`;
}

/**
 * Build the user-facing warning for a detected conflict. SkillForge prints
 * this as an informational hint — it does not disable anything itself.
 */
export function formatConflictHint(conflict: SkillSourceConflict): string {
  return (
    `Warning: ${conflict.folderPath} is also loaded by the ` +
    `${hostLabel(conflict.host)} ${conflict.kind} "${conflict.name}". ` +
    `To avoid loading these skills twice, disable it: ${disableCommand(conflict)}`
  );
}
