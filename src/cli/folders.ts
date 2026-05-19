#!/usr/bin/env node
/**
 * SkillForge `folders` subcommand.
 *
 * Terminal-side skill-folder management. Without this, folders could only
 * be registered from inside an LLM session via the `skills__configure` MCP
 * tool. This subcommand exposes the same `ConfigStore` folder operations
 * (load → mutate → save) to the shell — no separate config logic.
 *
 * Usage:
 *   skillforge folders list [--json]               List registered folders
 *   skillforge folders add <path> [flags]          Register a folder
 *   skillforge folders remove <path|alias>         Remove a folder entry
 *   skillforge folders alias <path|alias> <name>   Set/change a folder alias
 *   skillforge folders reset --yes                 Reset folders to default
 *
 * add flags:
 *   --priority <n>     Folder priority (default 100; higher wins on name collisions).
 *   --tags <a,b,c>     Comma-separated tags.
 *   --disabled         Register the folder disabled.
 *   --alias <name>     Short kebab-case alias to address the folder later.
 *
 * This module keeps only the entry point + action dispatch; the handlers,
 * table formatting, and shared parsing helpers live in sibling modules.
 */

import { ConfigStore, defaultConfigPath } from '../config/config-store.js';
import { defaultIsDirectory } from './folders-shared.js';
import {
  handleAdd,
  handleAlias,
  handleDisable,
  handleEnable,
  handleList,
  handleRemove,
  handleReset,
} from './folders-handlers.js';
import { extractLogFlags } from './log-flags.js';

export interface FoldersDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Override the config file path — tests inject a temp path here. */
  configPath?: string;
  /** Check whether a path exists and is a directory. Overridable for tests. */
  isDirectory?: (p: string) => Promise<boolean>;
}

const USAGE = `skillforge folders — manage skill folders from the terminal.

Usage:
  skillforge folders <action> [args]

Actions:
  list [--json]              Print registered folders (priority, enabled, alias, tags, path).
  add <path> [flags]         Register a folder. Path must exist and be a directory.
                               Flags: --priority <n>, --tags <a,b,c>, --disabled,
                                      --alias <name> (short kebab-case handle)
  remove <path|alias>        Remove the entry for <path> or its alias.
  alias <path|alias> <name>  Set or change the alias of a registered folder.
                               <name> must be kebab-case and unique.
  enable <path|alias>        Enable a previously disabled folder.
  disable <path|alias>       Disable a folder without removing it.
  reset --yes                Reset folders to the default (empty) list.
                               Without --yes, prints what would happen and exits.

Examples:
  skillforge folders list --json
  skillforge folders add ~/.lyupro/skills --priority 50 --tags work,review --alias work
  skillforge folders remove work
  skillforge folders alias ~/.lyupro/skills work
  skillforge folders disable work
  skillforge folders enable work
  skillforge folders reset --yes
`;

/**
 * `folders` subcommand entry. Returns an exit code:
 *   - 0 on success
 *   - 1 on a runtime/validation failure (e.g. bad path)
 *   - 2 on a missing/unknown sub-action or malformed flag
 */
export async function main(rawArgv: string[], deps: FoldersDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const isDirectory = deps.isDirectory ?? defaultIsDirectory;
  const store = new ConfigStore({ filePath: deps.configPath ?? defaultConfigPath() });

  // `folders` does not build server deps — but `--verbose` / `--quiet` are
  // accepted globally and silently stripped so users can pass them uniformly.
  const { rest: afterLog } = extractLogFlags(rawArgv);
  const action = afterLog[0];
  const rest = afterLog.slice(1);

  try {
    switch (action) {
      case 'list':
        return await handleList(store, rest, stdout, stderr);
      case 'add':
        return await handleAdd(store, rest, stdout, stderr, isDirectory);
      case 'remove':
        return await handleRemove(store, rest, stdout, stderr);
      case 'alias':
        return await handleAlias(store, rest, stdout, stderr);
      case 'enable':
        return await handleEnable(store, rest, stdout, stderr);
      case 'disable':
        return await handleDisable(store, rest, stdout, stderr);
      case 'reset':
        return await handleReset(store, rest, stdout, stderr);
      default: {
        if (action !== undefined) {
          stderr(`skillforge folders: unknown action: ${action}\n\n`);
        }
        stderr(USAGE);
        return 2;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge folders: ${msg}\n`);
    return 1;
  }
}
