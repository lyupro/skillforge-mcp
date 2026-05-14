import { z } from 'zod';
import { resolve } from 'node:path';
import type { ServerDeps } from '../server-deps.js';
import type { PersistedConfig } from '../config/index.js';
import { defaultConfig } from '../config/index.js';
import { loadResolvedConfig } from '../config.js';
import { ensureRegistryFresh } from './loader.js';

export const configureInputSchema = {
  action: z.enum([
    'add_folder',
    'remove_folder',
    'list_folders',
    'set_blacklist',
    'get_blacklist',
    'reset',
  ]),
  folder: z.string().optional(),
  blacklist: z.array(z.string()).optional(),
} as const;

export type ConfigureAction =
  | 'add_folder'
  | 'remove_folder'
  | 'list_folders'
  | 'set_blacklist'
  | 'get_blacklist'
  | 'reset';

export interface ConfigureResult {
  /** Currently active resolved folders (post-action). */
  folders: string[];
  /** Currently active manual blacklist (post-action). */
  blacklist: string[];
  /** Skills visible in the registry after the action took effect. */
  totalSkills: number;
}

/** Recompute resolved folders from env + persisted config, then splice deps.folders in place. */
async function reconcileFolders(deps: ServerDeps): Promise<PersistedConfig> {
  const persisted = await deps.configStore.load();
  const resolved = await loadResolvedConfig(process.env, deps.configStore);
  // Splice in-place so all references to deps.folders see the new list.
  deps.folders.splice(0, deps.folders.length, ...resolved.folders);
  deps.blacklistFilter.setManualBlacklist(persisted.blacklist);
  deps.metadataCache.invalidate();
  try {
    await deps.folderWatcher.setFolders(deps.folders);
  } catch (err) {
    console.error(`[skillforge:configure] watcher setFolders failed: ${String(err)}`);
  }
  await ensureRegistryFresh(deps);
  return persisted;
}

export async function handleConfigure(
  deps: ServerDeps,
  args: { action: ConfigureAction; folder?: string; blacklist?: string[] },
): Promise<ConfigureResult> {
  const { action } = args;

  try {
    if (action === 'list_folders') {
      const persisted = await deps.configStore.load();
      return {
        folders: [...deps.folders],
        blacklist: persisted.blacklist,
        totalSkills: deps.registry.size,
      };
    }

    if (action === 'get_blacklist') {
      const persisted = await deps.configStore.load();
      return {
        folders: [...deps.folders],
        blacklist: persisted.blacklist,
        totalSkills: deps.registry.size,
      };
    }

    if (action === 'add_folder') {
      if (args.folder === undefined) {
        throw new Error(`configure: action "add_folder" requires "folder"`);
      }
      if (args.folder.trim().length === 0) {
        throw new Error('configure: folder path must not be empty');
      }
      const absPath = resolve(args.folder);
      const persisted = await deps.configStore.load();
      const alreadyPresent = persisted.folders.some((f) => resolve(f.path) === absPath);
      if (!alreadyPresent) {
        persisted.folders.push({ path: absPath, priority: 100, enabled: true, tags: [] });
      }
      // Why: always save even on no-op — simpler than branching, atomic write is cheap.
      await deps.configStore.save(persisted);
      const finalPersisted = await reconcileFolders(deps);
      return {
        folders: [...deps.folders],
        blacklist: finalPersisted.blacklist,
        totalSkills: deps.registry.size,
      };
    }

    if (action === 'remove_folder') {
      if (args.folder === undefined) {
        throw new Error(`configure: action "remove_folder" requires "folder"`);
      }
      const absPath = resolve(args.folder);
      const persisted = await deps.configStore.load();
      persisted.folders = persisted.folders.filter((f) => resolve(f.path) !== absPath);
      await deps.configStore.save(persisted);
      const finalPersisted = await reconcileFolders(deps);
      return {
        folders: [...deps.folders],
        blacklist: finalPersisted.blacklist,
        totalSkills: deps.registry.size,
      };
    }

    if (action === 'set_blacklist') {
      if (args.blacklist === undefined) {
        throw new Error(`configure: action "set_blacklist" requires "blacklist"`);
      }
      const persisted = await deps.configStore.load();
      persisted.blacklist = args.blacklist;
      await deps.configStore.save(persisted);
      const finalPersisted = await reconcileFolders(deps);
      return {
        folders: [...deps.folders],
        blacklist: finalPersisted.blacklist,
        totalSkills: deps.registry.size,
      };
    }

    if (action === 'reset') {
      const fresh = defaultConfig();
      await deps.configStore.save(fresh);
      const finalPersisted = await reconcileFolders(deps);
      return {
        folders: [...deps.folders],
        blacklist: finalPersisted.blacklist,
        totalSkills: deps.registry.size,
      };
    }

    throw new Error(`configure: unknown action "${action as string}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Avoid double-prefixing if error already has the action prefix.
    if (msg.startsWith(`configure(${action}):`) || msg.startsWith('configure: ')) {
      throw err;
    }
    throw new Error(`configure(${action}): ${msg}`);
  }
}
