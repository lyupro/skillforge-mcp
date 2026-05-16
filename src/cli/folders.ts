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
 *   skillforge folders remove <path>               Remove a folder entry
 *   skillforge folders reset --yes                 Reset folders to default
 *
 * add flags:
 *   --priority <n>     Folder priority (default 100; higher wins on name collisions).
 *   --tags <a,b,c>     Comma-separated tags.
 *   --disabled         Register the folder disabled.
 */

import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { ConfigStore, defaultConfigPath } from '../config/config-store.js';
import { defaultConfig } from '../config/config-schema.js';
import type { FolderEntry } from '../config/config-schema.js';
import {
  detectSkillSourceConflict,
  formatConflictHint,
} from '../detect/skill-source-conflict.js';

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
  list [--json]              Print registered folders (path, priority, enabled, tags).
  add <path> [flags]         Register a folder. Path must exist and be a directory.
                               Flags: --priority <n>, --tags <a,b,c>, --disabled
  remove <path>              Remove the entry for <path>.
  reset --yes                Reset folders to the default (empty) list.
                               Without --yes, prints what would happen and exits.

Examples:
  skillforge folders list --json
  skillforge folders add ~/.lyupro/skills --priority 50 --tags work,review
  skillforge folders remove ~/.lyupro/skills
  skillforge folders reset --yes
`;

async function defaultIsDirectory(p: string): Promise<boolean> {
  try {
    const info = await stat(p);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/** Parse the flags accepted by `add`. Returns null on a malformed flag. */
function parseAddFlags(
  args: string[],
): { priority?: number; tags?: string[]; disabled: boolean } | null {
  let priority: number | undefined;
  let tags: string[] | undefined;
  let disabled = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--disabled') {
      disabled = true;
    } else if (arg === '--priority') {
      const value = args[i + 1];
      if (value === undefined) return null;
      const n = Number(value);
      if (!Number.isInteger(n)) return null;
      priority = n;
      i += 1;
    } else if (arg === '--tags') {
      const value = args[i + 1];
      if (value === undefined) return null;
      tags = value
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      i += 1;
    } else {
      return null;
    }
  }
  return { priority, tags, disabled };
}

function formatFoldersTable(folders: FolderEntry[]): string {
  if (folders.length === 0) {
    return 'No folders registered.\n';
  }
  const rows = folders.map((f) => ({
    priority: String(f.priority),
    enabled: f.enabled ? 'yes' : 'no',
    tags: f.tags.length > 0 ? f.tags.join(',') : '-',
    path: f.path,
  }));
  const headers = { priority: 'PRIORITY', enabled: 'ENABLED', tags: 'TAGS', path: 'PATH' };
  const width = {
    priority: Math.max(headers.priority.length, ...rows.map((r) => r.priority.length)),
    enabled: Math.max(headers.enabled.length, ...rows.map((r) => r.enabled.length)),
    tags: Math.max(headers.tags.length, ...rows.map((r) => r.tags.length)),
  };
  const pad = (text: string, len: number): string => text.padEnd(len);
  const lines = [
    `${pad(headers.priority, width.priority)}  ${pad(headers.enabled, width.enabled)}  ${pad(headers.tags, width.tags)}  ${headers.path}`,
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.priority, width.priority)}  ${pad(r.enabled, width.enabled)}  ${pad(r.tags, width.tags)}  ${r.path}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function handleList(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  let asJson = false;
  for (const arg of rest) {
    if (arg === '--json') {
      asJson = true;
    } else {
      stderr(`skillforge folders list: unknown flag: ${arg}\n`);
      return 2;
    }
  }
  const config = await store.load();
  if (asJson) {
    stdout(`${JSON.stringify({ folders: config.folders }, null, 2)}\n`);
  } else {
    stdout(formatFoldersTable(config.folders));
  }
  return 0;
}

async function handleAdd(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
  isDirectory: (p: string) => Promise<boolean>,
): Promise<number> {
  const rawPath = rest[0];
  if (rawPath === undefined || rawPath.startsWith('--')) {
    stderr(`skillforge folders add: missing <path>\n`);
    return 2;
  }
  const flags = parseAddFlags(rest.slice(1));
  if (flags === null) {
    stderr(`skillforge folders add: invalid or malformed flag\n`);
    return 2;
  }

  const absPath = resolve(rawPath);
  if (!(await isDirectory(absPath))) {
    stderr(`skillforge folders add: path does not exist or is not a directory: ${absPath}\n`);
    return 1;
  }

  const config = await store.load();
  const alreadyPresent = config.folders.some((f) => resolve(f.path) === absPath);
  if (alreadyPresent) {
    stdout(`Folder already registered: ${absPath}\n`);
    return 0;
  }
  const entry: FolderEntry = {
    path: absPath,
    priority: flags.priority ?? 100,
    enabled: !flags.disabled,
    tags: flags.tags ?? [],
  };
  config.folders.push(entry);
  await store.save(config);
  stdout(`Registered folder: ${absPath}\n`);
  // Informational only: a conflict does not block the add or change the exit code.
  const conflict = detectSkillSourceConflict(absPath);
  if (conflict !== null) {
    stdout(`${formatConflictHint(conflict)}\n`);
  }
  return 0;
}

async function handleRemove(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const rawPath = rest[0];
  if (rawPath === undefined || rawPath.startsWith('--')) {
    stderr(`skillforge folders remove: missing <path>\n`);
    return 2;
  }
  const absPath = resolve(rawPath);
  const config = await store.load();
  const before = config.folders.length;
  config.folders = config.folders.filter((f) => resolve(f.path) !== absPath);
  if (config.folders.length === before) {
    stderr(`skillforge folders remove: no registered folder matches: ${absPath}\n`);
    return 1;
  }
  await store.save(config);
  stdout(`Removed folder: ${absPath}\n`);
  return 0;
}

async function handleReset(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const confirmed = rest.includes('--yes');
  for (const arg of rest) {
    if (arg !== '--yes') {
      stderr(`skillforge folders reset: unknown flag: ${arg}\n`);
      return 2;
    }
  }
  if (!confirmed) {
    const config = await store.load();
    stdout(
      `Would reset ${config.folders.length} folder(s) to the default (empty) list.\n` +
        `Re-run with --yes to apply. No changes were made.\n`,
    );
    return 0;
  }
  const config = await store.load();
  config.folders = defaultConfig().folders;
  await store.save(config);
  stdout(`Reset folders to the default (empty) list.\n`);
  return 0;
}

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

  const action = rawArgv[0];
  const rest = rawArgv.slice(1);

  try {
    switch (action) {
      case 'list':
        return await handleList(store, rest, stdout, stderr);
      case 'add':
        return await handleAdd(store, rest, stdout, stderr, isDirectory);
      case 'remove':
        return await handleRemove(store, rest, stdout, stderr);
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
