import { z } from 'zod';
import { resolve } from 'node:path';
import type { ServerDeps } from '../server-deps.js';
import type { SkillSummary } from '../core/types.js';
import { ensureRegistryFresh } from './loader.js';

export const listInputSchema = {
  folder: z.string().optional(),
  search: z.string().optional(),
  source: z.enum(['claude', 'codex', 'persona', 'custom']).optional(),
  folderTag: z.string().optional(),
} as const;

export async function handleList(
  deps: ServerDeps,
  args: { folder?: string; search?: string; source?: string; folderTag?: string },
): Promise<{ skills: SkillSummary[] }> {
  await ensureRegistryFresh(deps);

  // Build the set of folder paths that match the requested tag (when set).
  let taggedFolderPaths: Set<string> | null = null;
  if (args.folderTag !== undefined) {
    const persisted = await deps.configStore.load();
    taggedFolderPaths = new Set(
      persisted.folders
        .filter((f) => f.tags.includes(args.folderTag!))
        .map((f) => resolve(f.path)),
    );
  }

  const all = deps.registry.getAll();

  const filtered = all.filter((meta) => {
    if (args.folder !== undefined && meta.folder !== args.folder) return false;
    if (args.source !== undefined && meta.format !== args.source) return false;
    if (args.search !== undefined) {
      const haystack = `${meta.name} ${meta.description ?? ''}`.toLowerCase();
      if (!haystack.includes(args.search.toLowerCase())) return false;
    }
    if (taggedFolderPaths !== null && !taggedFolderPaths.has(resolve(meta.folder))) return false;
    return true;
  });

  const skills: SkillSummary[] = filtered.map((meta) => ({
    name: meta.name,
    description: meta.description,
    sourcePath: meta.sourcePath,
    folder: meta.folder,
    tags: meta.tags,
    format: meta.format,
    formatId: meta.formatId,
    nameSource: meta.nameSource,
  }));

  return { skills };
}
