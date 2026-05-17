/**
 * Skill-source conflict detection.
 *
 * When a skill folder is registered that ALSO lives inside a host CLI's
 * native plugin/extension store, the same skills load twice — wasted tokens
 * and skill-name collisions. SkillForge detects this and prints a hint so the
 * user can disable one source. We NEVER mutate another tool's config: this is
 * detection + hint only.
 *
 * For Claude Code plugins, the detector reads ~/.claude/settings.json to check
 * whether the plugin is actually enabled. The home directory and the settings
 * reader are both injectable so tests never touch real host files.
 */

import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';

/** A host CLI whose native plugin/extension system can double-load skills. */
export type ConflictHost = 'claude' | 'gemini';

/**
 * Whether the conflicting host plugin/extension is currently enabled.
 * - 'enabled'  — key present in host settings with value true.
 * - 'disabled' — key present in host settings with value false.
 * - 'unknown'  — settings file missing, unreadable, malformed, or no state API.
 */
export type PluginEnabledState = 'enabled' | 'disabled' | 'unknown';

export interface SkillSourceConflict {
  /** The host CLI that natively serves skills from this path. */
  host: ConflictHost;
  /** Native unit kind: Claude Code has plugins, Gemini CLI has extensions. */
  kind: 'plugin' | 'extension';
  /** Human-readable plugin/extension name derived from the path. */
  name: string;
  /** The absolute folder path that triggered the conflict. */
  folderPath: string;
  /** Whether the conflicting plugin/extension is currently enabled in host settings. */
  enabledState: PluginEnabledState;
}

/** Normalise to an absolute path with consistent separators for prefix tests. */
function normalize(p: string): string {
  return resolve(p);
}

/**
 * Read the Claude Code plugin enabled state from ~/.claude/settings.json.
 * The key in `enabledPlugins` is `"<plugin>@<marketplace>"`.
 * Returns 'disabled' | 'enabled' | 'unknown'.
 */
async function readClaudePluginEnabled(
  settingsPath: string,
  pluginKey: string,
): Promise<PluginEnabledState> {
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('enabledPlugins' in parsed) ||
      typeof (parsed as Record<string, unknown>).enabledPlugins !== 'object' ||
      (parsed as Record<string, unknown>).enabledPlugins === null
    ) {
      return 'unknown';
    }
    const enabledPlugins = (parsed as Record<string, unknown>).enabledPlugins as Record<
      string,
      unknown
    >;
    if (!(pluginKey in enabledPlugins)) return 'unknown';
    return enabledPlugins[pluginKey] === false ? 'disabled' : 'enabled';
  } catch {
    return 'unknown';
  }
}

/**
 * Default implementation of the injectable plugin-state resolver for Claude Code.
 * Reads the real ~/.claude/settings.json on the host machine.
 */
async function defaultReadPluginEnabled(
  home: string,
  pluginKey: string,
): Promise<PluginEnabledState> {
  const settingsPath = resolve(home, '.claude', 'settings.json');
  return readClaudePluginEnabled(settingsPath, pluginKey);
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
 *   included when present for a clearer label). The enabled state is read from
 *   `~/.claude/settings.json` via the injectable `readPluginEnabled` resolver.
 *   When the plugin is DISABLED, returns null (no conflict).
 * - Gemini CLI — `~/.gemini/extensions/<extension>/...`
 *   The extension name is the first segment after `extensions/`. No reliable
 *   enabled-state file is available; always returns `enabledState: 'unknown'`.
 *
 * Codex and Cursor have no native skill system — they never conflict.
 *
 * @param folderPath        Absolute folder path being registered.
 * @param home              Home directory root, injectable for tests.
 * @param readPluginEnabled Injectable resolver for Claude plugin enabled state.
 * @returns A conflict descriptor, or null when there is no conflict.
 */
export async function detectSkillSourceConflict(
  folderPath: string,
  home: string = homedir(),
  readPluginEnabled: (home: string, pluginKey: string) => Promise<PluginEnabledState> = defaultReadPluginEnabled,
): Promise<SkillSourceConflict | null> {
  const claudeCacheRoot = resolve(home, '.claude', 'plugins', 'cache');
  const claudeSegments = segmentsUnder(folderPath, claudeCacheRoot);
  if (claudeSegments !== null && claudeSegments.length > 0) {
    // cache/<marketplace>/<plugin>/<version>/... — prefer "marketplace/plugin"
    // as the label; fall back to whatever single segment exists.
    const marketplace = claudeSegments[0]!;
    const plugin = claudeSegments[1];
    const name = plugin !== undefined ? `${marketplace}/${plugin}` : marketplace;
    const pluginKey = plugin !== undefined ? `${plugin}@${marketplace}` : marketplace;
    const enabledState = await readPluginEnabled(home, pluginKey);
    if (enabledState === 'disabled') return null;
    return {
      host: 'claude',
      kind: 'plugin',
      name,
      folderPath: normalize(folderPath),
      enabledState,
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
      enabledState: 'unknown',
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
 *
 * - enabledState 'enabled'  → direct "disable it" wording.
 * - enabledState 'unknown'  → conditional "IF enabled" wording.
 */
export function formatConflictHint(conflict: SkillSourceConflict): string {
  const prefix =
    `Warning: ${conflict.folderPath} is also served by the ` +
    `${hostLabel(conflict.host)} ${conflict.kind} "${conflict.name}".`;
  if (conflict.enabledState === 'unknown') {
    return (
      `${prefix} IF that ${conflict.kind} is enabled, skills load twice — ` +
      `check ${conflict.host === 'claude' ? '/plugin' : `/extensions disable ${conflict.name}`}`
    );
  }
  return (
    `${prefix} To avoid loading these skills twice, disable it: ${disableCommand(conflict)}`
  );
}
