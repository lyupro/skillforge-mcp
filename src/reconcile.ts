import type { ServerDeps } from './server-deps.js';
import type { PersistedConfig } from './config/index.js';
import { loadResolvedConfig } from './config.js';
import { ensureRegistryFresh } from './tools/loader.js';

/** Recompute resolved folders from env + persisted config, then splice deps.folders in place. */
export async function reconcileFolders(deps: ServerDeps): Promise<PersistedConfig> {
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
