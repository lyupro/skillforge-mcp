import { z } from 'zod';
import type { ServerDeps } from '../server-deps.js';
import type { SkillContent } from '../core/types.js';
import { ensureRegistryFresh } from './loader.js';

export const getInputSchema = {
  name: z.string(),
} as const;

export async function handleGet(deps: ServerDeps, args: { name: string }): Promise<SkillContent> {
  await ensureRegistryFresh(deps);

  if (!deps.registry.has(args.name)) {
    throw new Error(`Skill not found: ${args.name}`);
  }

  const cached = deps.contentCache.get(args.name);
  if (cached !== undefined) return cached;

  // Cache miss — re-parse from disk using the metadata's location.
  const meta = deps.registry.get(args.name)!;
  const content = await deps.parser.parseFile(meta.sourcePath, meta.folder);
  deps.contentCache.set(args.name, content);
  return content;
}
