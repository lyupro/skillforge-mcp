#!/usr/bin/env node
/**
 * SkillForge `formats` subcommand.
 *
 * Terminal-side skill-format registry management. The skill-format registry
 * is the declarative core that decides which files are skills and how their
 * names are resolved. SkillForge ships 4 built-in formats (claude / codex /
 * persona / custom); this subcommand lets an operator add, edit, or suppress
 * formats from the shell without touching code or shipping a release.
 *
 * Usage:
 *   skillforge formats list [--json]                List all effective formats
 *   skillforge formats add <id> <match-flag> [...]  Register a new format
 *   skillforge formats remove <id>                  Remove an operator format
 *   skillforge formats enable <id>                  Enable a format
 *   skillforge formats disable <id>                 Disable a format (keeps it)
 *
 * add — exactly one of these match flags is required:
 *   --filename <name>             Match files with this exact basename.
 *   --filename-glob <glob>        Match files whose basename matches the glob.
 *   --frontmatter-field <field>   Match when the frontmatter field is non-empty.
 *
 * add — optional flags:
 *   --name-field <field>          Frontmatter field that holds the skill name
 *                                   (default `name`).
 *   --derive-name-from-dir        Allow directory-name derivation when the
 *                                   `name` field is empty/absent. Filename and
 *                                   filename-glob matches only.
 *   --priority <n>                Conflict-resolution priority (default 100).
 *   --disabled                    Register the format disabled.
 *
 * This module keeps only the entry point + action dispatch; the handlers,
 * table formatting, and shared parsing helpers live in sibling modules.
 */

import { ConfigStore, defaultConfigPath } from '../config/config-store.js';
import {
  handleAdd,
  handleDisable,
  handleEnable,
  handleList,
  handleRemove,
} from './formats-handlers.js';

export interface FormatsDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Override the config file path — tests inject a temp path here. */
  configPath?: string;
}

const USAGE = `skillforge formats — manage the skill format registry from the terminal.

Usage:
  skillforge formats <action> [args]

Actions:
  list [--json]              Print all effective formats (built-in + operator).
  add <id> <match-flag> [flags]
                             Register a new operator format.
                               Match flags (one required):
                                 --filename <name>
                                 --filename-glob <glob>
                                 --frontmatter-field <field>
                               Optional flags:
                                 --name-field <field> (default "name")
                                 --derive-name-from-dir
                                 --priority <n>
                                 --disabled
  remove <id>                Remove an operator format. Built-ins cannot be
                               removed — use "formats disable <id>" instead.
  enable <id>                Enable a format (built-in or operator).
  disable <id>               Disable a format without removing it.

Examples:
  skillforge formats list --json
  skillforge formats add gemini-gem --filename GEMINI.md --derive-name-from-dir
  skillforge formats add skill-suffix --filename-glob "*.skill.md" --priority 200
  skillforge formats disable custom
  skillforge formats enable custom
  skillforge formats remove gemini-gem
`;

/**
 * `formats` subcommand entry. Returns an exit code:
 *   - 0 on success
 *   - 1 on a runtime/validation failure (e.g. unknown id)
 *   - 2 on a missing/unknown sub-action or malformed flag
 */
export async function main(rawArgv: string[], deps: FormatsDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const store = new ConfigStore({ filePath: deps.configPath ?? defaultConfigPath() });

  const action = rawArgv[0];
  const rest = rawArgv.slice(1);

  try {
    switch (action) {
      case 'list':
        return await handleList(store, rest, stdout, stderr);
      case 'add':
        return await handleAdd(store, rest, stdout, stderr);
      case 'remove':
        return await handleRemove(store, rest, stdout, stderr);
      case 'enable':
        return await handleEnable(store, rest, stdout, stderr);
      case 'disable':
        return await handleDisable(store, rest, stdout, stderr);
      default: {
        if (action !== undefined) {
          stderr(`skillforge formats: unknown action: ${action}\n\n`);
        }
        stderr(USAGE);
        return 2;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge formats: ${msg}\n`);
    return 1;
  }
}
