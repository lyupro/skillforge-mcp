/**
 * Shared helpers for the `folders` subcommand modules.
 *
 * Holds pure parsing/lookup logic split out of `folders.ts` so the entry
 * module stays small and the handler modules can reuse it.
 */

import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import type { FolderEntry } from '../config/config-schema.js';

/**
 * Allowed shape for a folder alias: lowercase letters/digits in segments
 * joined by a single `-`, `_`, or `/`. The `/` lets aliases mirror a
 * source handle (`lyupro/llm-skills`); the grammar's single-separator rule
 * rejects leading/trailing/doubled separators (`--`, `__`, `//`, `-_`, …).
 */
export const ALIAS_PATTERN = /^[a-z0-9]+([-_/][a-z0-9]+)*$/;

/** One-line description of the allowed alias shape, reused across error messages. */
export const ALIAS_HINT =
  'lowercase letters/digits separated by a single - _ or / ' +
  '(e.g. lyupro/llm-skills); no leading, trailing, or doubled separators';

/**
 * Canonicalize a user-supplied alias before validation/storage: trim and
 * lowercase. Uppercase input is auto-corrected rather than rejected; `_`
 * and `/` are preserved (they are valid separators, not normalized to `-`).
 */
export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Whether `name` matches the allowed alias grammar. Assumes already normalized. */
export function isValidAlias(name: string): boolean {
  return ALIAS_PATTERN.test(name);
}

/** Check whether a path exists and is a directory. Overridable for tests. */
export async function defaultIsDirectory(p: string): Promise<boolean> {
  try {
    const info = await stat(p);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Locate a registered folder by `token`, matching an alias first and falling
 * back to a resolved-path comparison. Shared so `remove`/`alias` address the
 * same entry the same way.
 */
export function findFolderEntry(folders: FolderEntry[], token: string): FolderEntry | null {
  // Aliases are stored normalized (lowercase), so match case-insensitively.
  const aliasToken = token.toLowerCase();
  const byAlias = folders.find((f) => f.alias !== undefined && f.alias === aliasToken);
  if (byAlias !== undefined) return byAlias;
  const absToken = resolve(token);
  const byPath = folders.find((f) => resolve(f.path) === absToken);
  return byPath ?? null;
}

/** Parsed result of the flags accepted by `add`. */
export interface ParsedAddFlags {
  priority?: number;
  tags?: string[];
  disabled: boolean;
  alias?: string;
}

/** Parse the flags accepted by `add`. Returns null on a malformed flag. */
export function parseAddFlags(args: string[]): ParsedAddFlags | null {
  let priority: number | undefined;
  let tags: string[] | undefined;
  let disabled = false;
  let alias: string | undefined;

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
    } else if (arg === '--alias') {
      const value = args[i + 1];
      if (value === undefined) return null;
      alias = value;
      i += 1;
    } else {
      return null;
    }
  }
  return { priority, tags, disabled, alias };
}
