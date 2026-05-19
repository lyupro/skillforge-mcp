/**
 * Action handlers for the `skills` subcommand.
 *
 * Each handler receives a ServerDeps (or a factory that builds one), the
 * post-action args, and stdout/stderr sinks; it returns a process exit code.
 * Split out of `skills.ts` so the entry module stays under the 400-line gate.
 *
 * Note: the CLI builds deps cold from config.json on disk. It reflects disk
 * truth, NOT the state of any running MCP server session.
 */

import { resolve } from 'node:path';
import type { ServerDeps } from '../server-deps.js';
import type { SkillContent } from '../core/types.js';
import { handleList as toolHandleList } from '../tools/list.js';
import { handleGet as toolHandleGet } from '../tools/get.js';
import { rebuildRegistry } from '../tools/loader.js';
import { reconcileFolders } from '../reconcile.js';
import { parseListFlags, resolveFolderArg, buildFolderAliasMap } from './skills-shared.js';
import {
  formatSkillsTable,
  formatSkillGet,
  formatReloadStats,
  formatReindexStats,
} from './skills-format.js';

export async function handleSkillsList(
  deps: ServerDeps,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const flags = parseListFlags(rest);
  if (flags === null) {
    stderr(`skillforge skills list: invalid or unknown flag\n`);
    return 2;
  }

  // Resolve --folder alias/path to the configured folder path.
  let resolvedFolder: string | undefined;
  if (flags.folder !== undefined) {
    const config = await deps.configStore.load();
    const path = resolveFolderArg(flags.folder, config.folders);
    if (path === null) {
      // Fallback: treat as a raw path.
      resolvedFolder = resolve(flags.folder);
    } else {
      resolvedFolder = path;
    }
  }

  try {
    const result = await toolHandleList(deps, {
      folder: resolvedFolder,
      search: flags.search,
      source: flags.source,
      folderTag: flags.folderTag,
    });

    if (flags.asJson) {
      stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    // Build alias map for FOLDER column display.
    const config = await deps.configStore.load();
    const aliasMap = buildFolderAliasMap(config.folders, flags.folderFmt);
    const folderLabel = (p: string): string => aliasMap.get(resolve(p)) ?? p;

    stdout(formatSkillsTable(result.skills, folderLabel));
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge skills list: ${msg}\n`);
    return 1;
  }
}

export async function handleSkillsGet(
  deps: ServerDeps,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const nameArg = rest[0];
  if (nameArg === undefined || nameArg.startsWith('--')) {
    stderr(`skillforge skills get: missing <name>\n`);
    return 2;
  }

  // A single token may carry several comma-separated names — one process, one
  // registry load, then a per-name lookup. Single name keeps the object form.
  const names = nameArg
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (names.length === 0) {
    stderr(`skillforge skills get: missing <name>\n`);
    return 2;
  }

  let asJson = false;
  for (let i = 1; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--json') {
      asJson = true;
    } else {
      stderr(`skillforge skills get: unknown flag: ${arg}\n`);
      return 2;
    }
  }

  // Single name — preserve the historical object form (backward compat).
  if (names.length === 1) {
    try {
      const skill = await toolHandleGet(deps, { name: names[0]! });
      if (asJson) {
        stdout(`${JSON.stringify(skill, null, 2)}\n`);
      } else {
        stdout(formatSkillGet(skill));
      }
      return 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stderr(`skillforge skills get: ${msg}\n`);
      return 1;
    }
  }

  // Batch — collect successes and per-name errors; one bad name never aborts.
  const skills: SkillContent[] = [];
  const errors: Array<{ name: string; message: string }> = [];
  for (const name of names) {
    try {
      skills.push(await toolHandleGet(deps, { name }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ name, message: msg });
    }
  }

  if (asJson) {
    stdout(`${JSON.stringify({ skills, errors }, null, 2)}\n`);
  } else {
    for (const skill of skills) {
      stdout(formatSkillGet(skill));
      stdout('\n');
    }
    for (const e of errors) {
      stderr(`skillforge skills get: ${e.name}: ${e.message}\n`);
    }
  }
  return errors.length > 0 ? 1 : 0;
}

export async function handleSkillsReindex(
  deps: ServerDeps,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  for (const arg of rest) {
    stderr(`skillforge skills reindex: unknown flag: ${arg}\n`);
    return 2;
  }

  try {
    const startedAt = Date.now();
    // Force a full rebuild regardless of fingerprint; rebuildRegistry writes
    // a fresh on-disk index as part of the rebuild.
    deps.metadataCache.invalidate();
    await deps.indexStore.invalidate();
    const stats = await rebuildRegistry(deps);
    const buildMs = Date.now() - startedAt;
    stdout(formatReindexStats(stats, deps.indexStore.getPath(), buildMs));
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge skills reindex: ${msg}\n`);
    return 1;
  }
}

export async function handleSkillsReload(
  deps: ServerDeps,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  for (const arg of rest) {
    stderr(`skillforge skills reload: unknown flag: ${arg}\n`);
    return 2;
  }

  try {
    await reconcileFolders(deps);
    const errors: Array<{ path: string; message: string }> = [];
    const stats = await rebuildRegistry(deps, { errorSink: errors });
    stdout(formatReloadStats(stats, deps.folders.length));
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge skills reload: ${msg}\n`);
    return 1;
  }
}
