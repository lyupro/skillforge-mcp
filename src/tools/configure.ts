import { z } from 'zod';
import { resolve } from 'node:path';
import type { ServerDeps } from '../server-deps.js';
import { defaultConfig } from '../config/index.js';
import { loadResolvedConfig } from '../config.js';
import { reconcileFolders } from '../reconcile.js';
import {
  detectSkillSourceConflict,
  formatConflictHint,
} from '../detect/skill-source-conflict.js';

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
  alias: z.string().optional(),
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
  /**
   * Set by `add_folder` only, when the added folder is also served by a host
   * CLI's native plugin/extension system (skills would load twice). It is an
   * informational hint — the folder is still registered. Absent otherwise.
   */
  conflictHint?: string;
}

export async function handleConfigure(
  deps: ServerDeps,
  args: { action: ConfigureAction; folder?: string; alias?: string; blacklist?: string[] },
): Promise<ConfigureResult> {
  const { action } = args;

  try {
    if (action === 'list_folders') {
      const resolved = await loadResolvedConfig(process.env, deps.configStore);
      return {
        folders: resolved.folders,
        blacklist: resolved.persisted.blacklist,
        totalSkills: deps.registry.size,
      };
    }

    if (action === 'get_blacklist') {
      const resolved = await loadResolvedConfig(process.env, deps.configStore);
      return {
        folders: resolved.folders,
        blacklist: resolved.persisted.blacklist,
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
        if (args.alias !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.alias)) {
          throw new Error(
            `configure: invalid alias "${args.alias}" — use kebab-case (e.g. my-folder)`,
          );
        }
        if (args.alias !== undefined && persisted.folders.some((f) => f.alias === args.alias)) {
          throw new Error(`configure: alias already in use: ${args.alias}`);
        }
        persisted.folders.push({
          path: absPath,
          priority: 100,
          enabled: true,
          tags: [],
          ...(args.alias !== undefined ? { alias: args.alias } : {}),
        });
      }
      // Why: always save even on no-op — simpler than branching, atomic write is cheap.
      await deps.configStore.save(persisted);
      const finalPersisted = await reconcileFolders(deps);
      const conflict = await detectSkillSourceConflict(absPath);
      return {
        folders: [...deps.folders],
        blacklist: finalPersisted.blacklist,
        totalSkills: deps.registry.size,
        ...(conflict !== null ? { conflictHint: formatConflictHint(conflict) } : {}),
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
