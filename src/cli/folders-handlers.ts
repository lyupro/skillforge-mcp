/**
 * Action handlers for the `folders` subcommand.
 *
 * Each handler takes a `ConfigStore`, the post-action args, and stdout/stderr
 * sinks; it returns a process exit code. Split out of `folders.ts` so the
 * entry module stays under the 400-line file-size gate.
 */

import { resolve } from 'node:path';
import type { ConfigStore } from '../config/config-store.js';
import { defaultConfig } from '../config/config-schema.js';
import type { FolderEntry } from '../config/config-schema.js';
import {
  detectSkillSourceConflict,
  formatConflictHint,
} from '../detect/skill-source-conflict.js';
import { formatFoldersTable } from './folders-format.js';
import { findFolderEntry, isValidAlias, parseAddFlags } from './folders-shared.js';

export async function handleList(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  let asJson = false;
  let tagFilter: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--json') {
      asJson = true;
    } else if (arg === '--tag') {
      const value = rest[i + 1];
      if (value === undefined) {
        stderr(`skillforge folders list: --tag requires a value\n`);
        return 2;
      }
      tagFilter = value;
      i += 1;
    } else {
      stderr(`skillforge folders list: unknown flag: ${arg}\n`);
      return 2;
    }
  }

  const config = await store.load();
  const folders =
    tagFilter !== undefined
      ? config.folders.filter((f) => f.tags.includes(tagFilter!))
      : config.folders;

  if (asJson) {
    stdout(`${JSON.stringify({ folders }, null, 2)}\n`);
  } else {
    stdout(formatFoldersTable(folders));
  }
  return 0;
}

export async function handleAdd(
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
  if (flags.alias !== undefined && !isValidAlias(flags.alias)) {
    stderr(
      `skillforge folders add: invalid --alias "${flags.alias}" — use kebab-case (e.g. my-folder)\n`,
    );
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
  if (flags.alias !== undefined) {
    const aliasTaken = config.folders.some((f) => f.alias === flags.alias);
    if (aliasTaken) {
      stderr(`skillforge folders add: alias already in use: ${flags.alias}\n`);
      return 2;
    }
  }
  const entry: FolderEntry = {
    path: absPath,
    priority: flags.priority ?? 100,
    enabled: !flags.disabled,
    tags: flags.tags ?? [],
    ...(flags.alias !== undefined ? { alias: flags.alias } : {}),
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

export async function handleRemove(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const token = rest[0];
  if (token === undefined || token.startsWith('--')) {
    stderr(`skillforge folders remove: missing <path>\n`);
    return 2;
  }
  const config = await store.load();
  const entry = findFolderEntry(config.folders, token);
  if (entry === null) {
    stderr(`skillforge folders remove: no registered folder matches: ${token}\n`);
    return 1;
  }
  config.folders = config.folders.filter((f) => f !== entry);
  await store.save(config);
  stdout(`Removed folder: ${entry.path}\n`);
  return 0;
}

export async function handleAlias(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const token = rest[0];
  const name = rest[1];
  if (token === undefined || token.startsWith('--') || name === undefined) {
    stderr(`skillforge folders alias: usage: folders alias <path> <name>\n`);
    return 2;
  }
  if (!isValidAlias(name)) {
    stderr(
      `skillforge folders alias: invalid alias "${name}" — use kebab-case (e.g. my-folder)\n`,
    );
    return 2;
  }
  const config = await store.load();
  const entry = findFolderEntry(config.folders, token);
  if (entry === null) {
    stderr(`skillforge folders alias: no registered folder matches: ${token}\n`);
    return 1;
  }
  const aliasTaken = config.folders.some((f) => f !== entry && f.alias === name);
  if (aliasTaken) {
    stderr(`skillforge folders alias: alias already in use: ${name}\n`);
    return 2;
  }
  entry.alias = name;
  await store.save(config);
  stdout(`Set alias "${name}" for folder: ${entry.path}\n`);
  return 0;
}

export async function handleEnable(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const token = rest[0];
  if (token === undefined || token.startsWith('--')) {
    stderr(`skillforge folders enable: missing <path|alias>\n`);
    return 2;
  }
  const config = await store.load();
  const entry = findFolderEntry(config.folders, token);
  if (entry === null) {
    stderr(`skillforge folders enable: no registered folder matches: ${token}\n`);
    return 1;
  }
  entry.enabled = true;
  await store.save(config);
  stdout(`Enabled folder: ${entry.path}\n`);
  return 0;
}

export async function handleDisable(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const token = rest[0];
  if (token === undefined || token.startsWith('--')) {
    stderr(`skillforge folders disable: missing <path|alias>\n`);
    return 2;
  }
  const config = await store.load();
  const entry = findFolderEntry(config.folders, token);
  if (entry === null) {
    stderr(`skillforge folders disable: no registered folder matches: ${token}\n`);
    return 1;
  }
  entry.enabled = false;
  await store.save(config);
  stdout(`Disabled folder: ${entry.path}\n`);
  return 0;
}

export async function handleReset(
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
