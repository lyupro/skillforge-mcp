#!/usr/bin/env node
/**
 * SkillForge `security` subcommand.
 *
 * Terminal-side management of the security-audit knobs and the manual skill
 * blacklist. Without this, these settings could only be edited from inside an
 * LLM session via the `skills__configure` MCP tool (or by hand-editing JSON).
 * This subcommand exposes the same `ConfigStore` operations (load → mutate →
 * save) to the shell — no separate config logic.
 *
 * The command groups four areas under one `security` verb for UX. Note the
 * blacklist persists at the TOP-LEVEL `config.blacklist`; the audit-* areas
 * persist under `config.security`.
 *
 * Usage:
 *   skillforge security audit-exceptions list|add|remove|clear   Audit exemptions
 *   skillforge security audit-target [scripts|all]               What auto-audit scans
 *   skillforge security audit-patterns list                      Read-only seed patterns
 *   skillforge security blacklist list|add|remove|clear          Manual skill blacklist
 *
 * This module keeps only the entry point + area/action dispatch; the handlers,
 * table formatting, and shared parsing helpers live in sibling modules.
 */

import { ConfigStore, defaultConfigPath } from '../config/config-store.js';
import {
  handleAuditExceptionsAdd,
  handleAuditExceptionsClear,
  handleAuditExceptionsList,
  handleAuditExceptionsRemove,
  handleAuditPatternsList,
  handleAuditTarget,
} from './security-handlers.js';
import {
  handleBlacklistAdd,
  handleBlacklistClear,
  handleBlacklistList,
  handleBlacklistRemove,
} from './security-blacklist-handlers.js';
import { extractLogFlags } from './log-flags.js';

export interface SecurityDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Override the config file path — tests inject a temp path here. */
  configPath?: string;
}

const USAGE = `skillforge security — manage audit knobs and the skill blacklist from the terminal.

Usage:
  skillforge security <area> <action> [args]

Areas & actions:
  audit-exceptions list [--json]          Print skill names exempt from the auto-audit.
  audit-exceptions add <name> [...]       Add one or more audit exceptions (idempotent).
  audit-exceptions remove <name> [...]    Remove one or more audit exceptions.
  audit-exceptions clear [--yes]          Clear all audit exceptions. Needs --yes.

  audit-target [scripts|all]              Print the audit scan target, or set it.
                                            scripts (default) scans fenced code only;
                                            all scans the whole SKILL.md body.

  audit-patterns list [--json]            Print the code-seeded audit patterns
                                            (read-only — set in code, not config).

  blacklist list [--json]                 Print blacklist patterns with classified KIND
                                            (exact | name-glob | path-glob).
  blacklist add <pattern> [...]           Add one or more blacklist patterns (idempotent).
  blacklist remove <pattern> [...]        Remove one or more blacklist patterns.
  blacklist clear [--yes]                 Clear the blacklist. Needs --yes.

Examples:
  skillforge security audit-exceptions list --json
  skillforge security audit-exceptions add security-auditor lint-rule-pack
  skillforge security audit-target all
  skillforge security audit-patterns list
  skillforge security blacklist add research-orchestrator "wiki-*" "**/agenthub/**"
  skillforge security blacklist remove "wiki-*"
  skillforge security blacklist clear --yes
`;

type Handler = (
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
) => Promise<number>;

/** Action routing tables for the areas that take a list/add/remove/clear action. */
const AUDIT_EXCEPTIONS: Record<string, Handler> = {
  list: handleAuditExceptionsList,
  add: handleAuditExceptionsAdd,
  remove: handleAuditExceptionsRemove,
  clear: handleAuditExceptionsClear,
};

const BLACKLIST: Record<string, Handler> = {
  list: handleBlacklistList,
  add: handleBlacklistAdd,
  remove: handleBlacklistRemove,
  clear: handleBlacklistClear,
};

function routeAction(
  prefix: string,
  table: Record<string, Handler>,
  action: string | undefined,
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const handler = action !== undefined ? table[action] : undefined;
  if (handler === undefined) {
    if (action !== undefined) {
      stderr(`skillforge security ${prefix}: unknown action: ${action}\n\n`);
    }
    stderr(USAGE);
    return Promise.resolve(2);
  }
  return handler(store, rest, stdout, stderr);
}

/**
 * `security` subcommand entry. The first token is the AREA, the second the
 * action. Returns an exit code:
 *   - 0 on success
 *   - 1 on a runtime/validation failure
 *   - 2 on a missing/unknown area or action, or a malformed flag
 */
export async function main(rawArgv: string[], deps: SecurityDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const store = new ConfigStore({ filePath: deps.configPath ?? defaultConfigPath() });

  // `security` does not build server deps — but `--verbose` / `--quiet` are
  // accepted globally and silently stripped so users can pass them uniformly.
  const { rest: afterLog } = extractLogFlags(rawArgv);
  const area = afterLog[0];
  const action = afterLog[1];
  const rest = afterLog.slice(2);

  try {
    switch (area) {
      case 'audit-exceptions':
        return await routeAction('audit-exceptions', AUDIT_EXCEPTIONS, action, store, rest, stdout, stderr);
      case 'blacklist':
        return await routeAction('blacklist', BLACKLIST, action, store, rest, stdout, stderr);
      case 'audit-target':
        // No action token — the value (if any) is the first post-area arg.
        return await handleAuditTarget(store, afterLog.slice(1), stdout, stderr);
      case 'audit-patterns':
        if (action !== 'list') {
          if (action !== undefined) {
            stderr(`skillforge security audit-patterns: unknown action: ${action}\n\n`);
          }
          stderr(USAGE);
          return 2;
        }
        return await handleAuditPatternsList(store, rest, stdout, stderr);
      default: {
        if (area !== undefined) {
          stderr(`skillforge security: unknown area: ${area}\n\n`);
        }
        stderr(USAGE);
        return 2;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge security: ${msg}\n`);
    return 1;
  }
}
