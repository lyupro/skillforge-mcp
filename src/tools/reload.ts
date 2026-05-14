import { z } from 'zod';
import { resolve as resolvePath } from 'node:path';
import type { ServerDeps } from '../server-deps.js';
import { rebuildRegistry } from './loader.js';

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
}

export async function handleReload(
  deps: ServerDeps,
  args: { folder?: string },
): Promise<ReloadResult> {
  try {
    if (args.folder !== undefined) {
      const absolute = resolvePath(args.folder);
      // Why: reload always rebuilds the FULL registry (every configured folder), not just
      // the named one. Validating presence preserves the API contract for callers without
      // forcing a partial-scan code path. Partial reload deferred — would require splitting
      // the conflict-resolver logic, not worth the complexity in v0.x.
      if (!deps.folders.includes(absolute)) {
        throw new Error(`reload: folder "${args.folder}" is not currently configured`);
      }
    }

    const before = new Set(deps.registry.getAll().map((s) => s.name));

    deps.metadataCache.invalidate();

    const errorSink: Array<{ path: string; message: string }> = [];
    const stats = await rebuildRegistry(deps, { errorSink });

    const added = stats.skills.filter((n) => !before.has(n));
    const removed = [...before].filter((n) => !stats.skills.includes(n)).sort();

    return {
      loaded: stats.skills.length,
      added,
      removed,
      errors: stats.errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('reload: ')) throw err;
    throw new Error(`reload: ${msg}`);
  }
}
