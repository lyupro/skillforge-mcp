import { z } from 'zod';
import type { ServerDeps } from '../server-deps.js';
import type { SkillSummary } from '../core/types.js';
import { ensureRegistryFresh } from './loader.js';

export const listInputSchema = {
  folder: z.string().optional(),
  search: z.string().optional(),
  source: z.enum(['claude', 'codex', 'persona', 'custom']).optional(),
} as const;

export async function handleList(
  deps: ServerDeps,
  args: { folder?: string; search?: string; source?: string },
): Promise<{ skills: SkillSummary[] }> {
  await ensureRegistryFresh(deps);

  const all = deps.registry.getAll();

  const filtered = all.filter((meta) => {
    if (args.folder !== undefined && meta.folder !== args.folder) return false;
    if (args.source !== undefined && meta.format !== args.source) return false;
    if (args.search !== undefined) {
      const haystack = `${meta.name} ${meta.description ?? ''}`.toLowerCase();
      if (!haystack.includes(args.search.toLowerCase())) return false;
    }
    return true;
  });

  const skills: SkillSummary[] = filtered.map((meta) => ({
    name: meta.name,
    description: meta.description,
    sourcePath: meta.sourcePath,
    folder: meta.folder,
    tags: meta.tags,
    format: meta.format,
  }));

  return { skills };
}
