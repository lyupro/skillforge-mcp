#!/usr/bin/env node
/**
 * SkillForge `version-policy` subcommand.
 *
 * Terminal-side management of per-bundle version policies. Plugin caches lay
 * skills out as `<root>/<bundle>/<semver>/...`, so the same bundle can have
 * several installed versions. By default the highest semver wins; a policy
 * pins a bundle to an exact `major.minor.patch` (e.g. freeze against newer
 * installs) or restores the default `latest` behavior.
 *
 * Without this, the policy map could only be edited by hand-editing JSON.
 * This subcommand exposes the same `ConfigStore` operations (load → mutate →
 * save) to the shell — no separate config logic. Policies persist at the
 * TOP-LEVEL `config.versionPolicy`.
 *
 * Usage:
 *   skillforge version-policy list [--json]                     List policies
 *   skillforge version-policy set <bundle> <latest|x.y.z>       Set/overwrite a policy
 *   skillforge version-policy remove <bundle> [<bundle> ...]    Remove policies
 *   skillforge version-policy clear [--yes]                     Clear all policies
 *
 * This module keeps only the entry point + action dispatch; the handlers,
 * table formatting, and shared parsing helpers live in sibling modules.
 */

import { ConfigStore, defaultConfigPath } from '../config/config-store.js';
import {
  handleClear,
  handleList,
  handleRemove,
  handleSet,
} from './version-policy-handlers.js';
import { extractLogFlags } from './log-flags.js';

export interface VersionPolicyDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Override the config file path — tests inject a temp path here. */
  configPath?: string;
}

const USAGE = `skillforge version-policy — pin bundle versions from the terminal.

Usage:
  skillforge version-policy <action> [args]

Actions:
  list [--json]                       Print per-bundle version policies (BUNDLE | POLICY).
  set <bundle> <latest|x.y.z>         Set or overwrite a bundle's policy.
                                        latest (default) lets the highest semver win;
                                        a strict major.minor.patch pins to that version.
  remove <bundle> [<bundle> ...]      Remove one or more bundle policies.
  clear [--yes]                       Clear all policies. Needs --yes.

Examples:
  skillforge version-policy list --json
  skillforge version-policy set engineering-advanced-skills 2.4.4
  skillforge version-policy set engineering-advanced-skills latest
  skillforge version-policy remove engineering-advanced-skills
  skillforge version-policy clear --yes
`;

/**
 * `version-policy` subcommand entry. Returns an exit code:
 *   - 0 on success
 *   - 1 on a runtime/validation failure
 *   - 2 on a missing/unknown action, a missing arg, a malformed flag, or an
 *     invalid policy value
 */
export async function main(rawArgv: string[], deps: VersionPolicyDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const store = new ConfigStore({ filePath: deps.configPath ?? defaultConfigPath() });

  // `version-policy` does not build server deps — but `--verbose` / `--quiet`
  // are accepted globally and silently stripped so users can pass them uniformly.
  const { rest: afterLog } = extractLogFlags(rawArgv);
  const action = afterLog[0];
  const rest = afterLog.slice(1);

  try {
    switch (action) {
      case 'list':
        return await handleList(store, rest, stdout, stderr);
      case 'set':
        return await handleSet(store, rest, stdout, stderr);
      case 'remove':
        return await handleRemove(store, rest, stdout, stderr);
      case 'clear':
        return await handleClear(store, rest, stdout, stderr);
      default: {
        if (action !== undefined) {
          stderr(`skillforge version-policy: unknown action: ${action}\n\n`);
        }
        stderr(USAGE);
        return 2;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge version-policy: ${msg}\n`);
    return 1;
  }
}
