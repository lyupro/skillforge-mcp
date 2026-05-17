#!/usr/bin/env node
/**
 * SkillForge `skills` subcommand.
 *
 * Terminal-side skill inspection and registry reload. Without this, skills
 * could only be viewed from inside an LLM session via the `skills__list` or
 * `skills__get` MCP tools. This subcommand exposes the same tool handlers to
 * the shell — no separate registry logic.
 *
 * Note: the CLI reads config.json and skill files directly from disk. It
 * reflects disk truth, NOT the state of any running MCP server session.
 *
 * Usage:
 *   skillforge skills list [flags]       List skills from the registry
 *   skillforge skills get <name> [flags] Print full content of one skill
 *   skillforge skills reload             Force a registry rebuild from disk
 *
 * list flags:
 *   --search <s>          Case-insensitive substring filter over name + description.
 *   --source <format>     Filter by skill format: claude | codex | persona | custom.
 *   --folder <path|alias> Restrict to one configured folder (alias or path).
 *   --folder-tag <tag>    Restrict to folders with this tag in config.
 *   --folder-fmt <fmt>    FOLDER column format: alias (default) or path.
 *   --json                Emit raw JSON instead of a table.
 *
 * get flags:
 *   --json                Emit raw JSON instead of human-readable output.
 *
 * This module keeps only the entry point + action dispatch; the handlers,
 * table formatting, and shared parsing helpers live in sibling modules.
 */

import type { ServerDeps } from '../server-deps.js';
import {
  handleSkillsList,
  handleSkillsGet,
  handleSkillsReload,
} from './skills-handlers.js';

export interface SkillsDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Override the ServerDeps factory — tests inject a fake deps object here. */
  buildDeps?: () => Promise<ServerDeps>;
}

const USAGE = `skillforge skills — view and reload skills from the terminal.

Note: the CLI reads disk, not a live server session. Results reflect the
current state of config.json and skill files on disk.

Usage:
  skillforge skills <action> [args]

Actions:
  list [flags]        Print a table of skills from the registry.
                        Flags: --search <s>, --source <format>,
                               --folder <path|alias>, --folder-tag <tag>,
                               --folder-fmt alias|path (default alias), --json
  get <name> [flags]  Print the full content of one skill.
                        Flags: --json
  reload              Force a registry rebuild + config reconcile from disk.
                        Prints: N folders, M skills, and any per-file errors.

Examples:
  skillforge skills list
  skillforge skills list --search review --json
  skillforge skills list --folder work --folder-fmt path
  skillforge skills list --source claude
  skillforge skills get code-review
  skillforge skills get code-review --json
  skillforge skills reload
`;

/**
 * `skills` subcommand entry. Returns an exit code:
 *   - 0 on success
 *   - 1 on a runtime failure (e.g. skill not found)
 *   - 2 on a missing/unknown sub-action or malformed flag
 */
export async function main(rawArgv: string[], deps: SkillsDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));

  const action = rawArgv[0];
  const rest = rawArgv.slice(1);

  if (action === undefined || (action !== 'list' && action !== 'get' && action !== 'reload')) {
    if (action !== undefined) {
      stderr(`skillforge skills: unknown action: ${action}\n\n`);
    }
    stderr(USAGE);
    return 2;
  }

  let serverDeps: ServerDeps;
  try {
    const factory = deps.buildDeps ?? (async () => {
      const { buildDeps } = await import('../server.js');
      return buildDeps();
    });
    serverDeps = await factory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge skills: failed to initialise registry: ${msg}\n`);
    return 1;
  }

  try {
    switch (action) {
      case 'list':
        return await handleSkillsList(serverDeps, rest, stdout, stderr);
      case 'get':
        return await handleSkillsGet(serverDeps, rest, stdout, stderr);
      case 'reload':
        return await handleSkillsReload(serverDeps, rest, stdout, stderr);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge skills: ${msg}\n`);
    return 1;
  }
}
