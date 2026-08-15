import { resolve as resolvePath } from 'node:path';
import { z } from 'zod';
import type { ServerDeps } from '../server-deps.js';
import { persistIndex, rebuildRegistry, scanFolder } from './loader.js';

export const reloadInputSchema = {
  folder: z.string().optional(),
} as const;

export interface ReloadResult {
  /** Total skills in the registry after reload. */
  loaded: number;
  /** Skill names present after reload but not before. */
  added: string[];
  /** Skill names present before reload but not after. */
  removed: string[];
  /** Per-file errors collected during the rebuild. */
  errors: Array<{ path: string; message: string }>;
  /** Present only for a one-folder reload. */
  scope?: { folder: string; scanned: number };
}

async function reloadFolder(
  deps: ServerDeps,
  folder: string,
): Promise<{ skills: string[]; errors: ReloadResult['errors']; scanned: number }> {
  const affected = new Set<string>();
  for (const winner of deps.registry.getAll()) {
    if (deps.registry.getCandidates(winner.name).some((candidate) => candidate.folder === folder)) {
      affected.add(winner.name);
    }
  }

  const result = await scanFolder(deps, folder);
  for (const candidate of result.candidates) affected.add(candidate.name);
  deps.registry.replaceRoot(folder, result.candidates);

  // Mirror the promotion a full scan performs: scanFolder parks each candidate's
  // content under the temporary "name\0sourcePath" key, and only the winner is
  // republished under the bare name. Invalidating just the affected names keeps
  // untouched folders cached.
  for (const name of affected) {
    deps.contentCache.invalidate(name);
    const winner = deps.registry.get(name);
    if (winner !== undefined) {
      const content = deps.contentCache.get(name + '\x00' + winner.sourcePath);
      if (content !== undefined) deps.contentCache.set(name, content);
    }
  }
  for (const candidate of result.candidates) {
    deps.contentCache.invalidate(candidate.name + '\x00' + candidate.sourcePath);
  }

  deps.metadataCache.markFresh();
  await persistIndex(deps);

  return {
    skills: deps.registry.getAll().map((skill) => skill.name).sort(),
    errors: result.errors,
    scanned: result.candidates.length,
  };
}

export async function handleReload(
  deps: ServerDeps,
  args: { folder?: string },
): Promise<ReloadResult> {
  try {
    let folder: string | undefined;
    if (args.folder !== undefined) {
      folder = resolvePath(args.folder);
      if (!deps.folders.includes(folder)) {
        throw new Error(`reload: folder "${args.folder}" is not currently configured`);
      }
    }

    const before = new Set(deps.registry.getAll().map((skill) => skill.name));
    deps.metadataCache.invalidate();

    const errorSink: Array<{ path: string; message: string }> = [];
    let stats: { skills: string[]; errors: ReloadResult['errors'] };
    let scanned: number | undefined;
    if (folder === undefined) {
      stats = await rebuildRegistry(deps, { errorSink });
    } else {
      const partialStats = await reloadFolder(deps, folder);
      stats = partialStats;
      scanned = partialStats.scanned;
    }
    const added = stats.skills.filter((name) => !before.has(name));
    const removed = [...before].filter((name) => !stats.skills.includes(name)).sort();

    const result: ReloadResult = {
      loaded: stats.skills.length,
      added,
      removed,
      errors: stats.errors,
    };
    if (folder !== undefined && scanned !== undefined) result.scope = { folder, scanned };
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('reload: ')) throw err;
    throw new Error(`reload: ${msg}`);
  }
}
