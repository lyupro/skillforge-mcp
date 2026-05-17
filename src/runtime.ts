import type { ServerDeps } from './server-deps.js';

/**
 * Starts the long-lived background watchers for a running MCP server.
 *
 * Both startup paths — `server.ts` `main()` and `cli/dispatcher.ts`
 * `defaultStartServe()` — call this so the watcher wiring lives in one place.
 * The MCP transport itself is connected by the caller before this runs.
 */
export async function startRuntime(deps: ServerDeps): Promise<void> {
  await deps.folderWatcher.start();
  await deps.configWatcher.start();
}

/** Stops all background watchers. Safe to call once on SIGTERM/SIGINT. */
export async function stopRuntime(deps: ServerDeps): Promise<void> {
  await deps.folderWatcher.stop();
  await deps.configWatcher.stop();
}

/** Registers SIGTERM/SIGINT handlers that tear the runtime down gracefully. */
export function registerShutdown(deps: ServerDeps): void {
  const shutdown = async (): Promise<void> => {
    await stopRuntime(deps);
  };
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}
