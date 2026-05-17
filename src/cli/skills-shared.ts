/**
 * Shared helpers for the `skills` subcommand modules.
 *
 * Holds pure parsing/lookup logic split out of `skills.ts` so the entry
 * module stays small and the handler modules can reuse it.
 */

import { resolve } from 'node:path';
import type { FolderEntry } from '../config/config-schema.js';
import { findFolderEntry } from './folders-shared.js';

/** Parsed result of the flags accepted by `skills list`. */
export interface ParsedListFlags {
  search?: string;
  source?: string;
  folder?: string;
  folderTag?: string;
  folderFmt: 'alias' | 'path';
  asJson: boolean;
}

/**
 * Parse the flags accepted by `skills list`.
 * Returns null on a malformed or unknown flag.
 */
export function parseListFlags(args: string[]): ParsedListFlags | null {
  let search: string | undefined;
  let source: string | undefined;
  let folder: string | undefined;
  let folderTag: string | undefined;
  let folderFmt: 'alias' | 'path' = 'alias';
  let asJson = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--json') {
      asJson = true;
    } else if (arg === '--search') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      search = value;
      i += 1;
    } else if (arg === '--source') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      source = value;
      i += 1;
    } else if (arg === '--folder') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      folder = value;
      i += 1;
    } else if (arg === '--folder-tag') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      folderTag = value;
      i += 1;
    } else if (arg === '--folder-fmt') {
      const value = args[i + 1];
      if (value !== 'alias' && value !== 'path') return null;
      folderFmt = value;
      i += 1;
    } else {
      return null;
    }
  }

  return { search, source, folder, folderTag, folderFmt, asJson };
}

/**
 * Resolve a `--folder` token (alias or path) to the resolved folder path.
 * Returns null if the token does not match any registered folder.
 */
export function resolveFolderArg(
  token: string,
  folders: FolderEntry[],
): string | null {
  const entry = findFolderEntry(folders, token);
  if (entry === null) return null;
  return entry.path;
}

/**
 * Build a map of folder path → display label.
 * When an alias is set, the alias is used; otherwise the path itself.
 */
export function buildFolderAliasMap(
  folders: FolderEntry[],
  fmt: 'alias' | 'path',
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of folders) {
    const label =
      fmt === 'alias' && f.alias !== undefined && f.alias.length > 0
        ? f.alias
        : f.path;
    map.set(resolve(f.path), label);
  }
  return map;
}
