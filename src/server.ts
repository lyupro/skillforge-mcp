/**
 * SkillForge MCP — server module.
 *
 * Exports the server wiring: buildServer() + buildDeps() (also used by the
 * integration tests for in-process exercise) and startServer(), the single
 * server-start sequence. This file is a pure module — it is never run
 * directly; the canonical entry point is dist/cli/dispatcher.js (`serve`).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadResolvedConfig, buildPatternScanner } from './config.js';
import { ConfigStore, defaultConfigPath } from './config/index.js';
import { FolderWatcher, ConfigWatcher } from './watcher/index.js';
import { reconcileFolders } from './reconcile.js';
import { startRuntime, registerShutdown } from './runtime.js';
import {
  SkillRegistry,
  SkillResolver,
  SkillMetadataCache,
  SkillContentCache,
} from './core/index.js';
import { FrontmatterParser, FileScanner } from './parser/index.js';
import { PromptStrategy } from './handlers/index.js';
import { ScriptStrategy } from './handlers/script-strategy.js';
import { HybridStrategy } from './handlers/hybrid-strategy.js';
import { StrategyFactory } from './factory/index.js';
import { BlacklistFilter } from './security/index.js';
import { SandboxRunner } from './security/sandbox-runner.js';
import { DecoratorChain, stderrLogger } from './decorators/index.js';
import type { ServerDeps } from './server-deps.js';
import {
  listInputSchema,
  getInputSchema,
  invokeInputSchema,
  configureInputSchema,
  reloadInputSchema,
  handleList,
  handleGet,
  handleInvoke,
  handleConfigure,
  handleReload,
} from './tools/index.js';

export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'skillforge-mcp', version: '0.1.0' });

  server.registerTool(
    'skills__list',
    {
      title: 'List skills',
      description:
        'List available skills, optionally filtered by folder / search / source / folderTag. ' +
        'folderTag restricts results to skills whose folder has that tag in config.json folders[].tags. ' +
        'Note: env-override folders (SKILLFORGE_FOLDERS) carry no tags — folderTag returns nothing for them.',
      inputSchema: listInputSchema,
    },
    async (args) => {
      try {
        const result = await handleList(deps, args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    'skills__get',
    {
      title: 'Get skill',
      description: 'Retrieve the full content (body + metadata) of a named skill.',
      inputSchema: getInputSchema,
    },
    async (args) => {
      try {
        const result = await handleGet(deps, args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    'skills__invoke',
    {
      title: 'Invoke skill',
      description: 'Invoke a skill by name, forwarding optional input to the strategy.',
      inputSchema: invokeInputSchema,
    },
    async (args) => {
      try {
        const result = await handleInvoke(deps, args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    'skills__configure',
    {
      title: 'Configure SkillForge',
      description:
        'Manage configured skill folders, blacklist, and reset to defaults. Mutates persisted config under defaultConfigPath().',
      inputSchema: configureInputSchema,
    },
    async (args) => {
      try {
        const result = await handleConfigure(deps, args as Parameters<typeof handleConfigure>[1]);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    'skills__reload',
    {
      title: 'Reload skills',
      description:
        'Force a full rescan of all configured folders, returning the diff (added/removed) and any per-file errors. Pass an optional folder name to validate it is currently configured (the rescan itself remains global).',
      inputSchema: reloadInputSchema,
    },
    async (args) => {
      try {
        const result = await handleReload(deps, args as Parameters<typeof handleReload>[1]);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  return server;
}

export async function buildDeps(): Promise<ServerDeps> {
  const configStore = new ConfigStore({ filePath: defaultConfigPath() });
  const resolved = await loadResolvedConfig(process.env, configStore);
  const scanner = buildPatternScanner(resolved.persisted);
  const blacklistFilter = new BlacklistFilter({
    manualBlacklist: resolved.persisted.blacklist,
    patternScanner: scanner,
  });
  const metadataCache = new SkillMetadataCache({ ttlMs: resolved.ttlMs });
  const folderWatcher = new FolderWatcher({
    folders: resolved.folders,
    debounceMs: resolved.persisted.watcher.debounceMs,
    onBatch: () => metadataCache.invalidate(),
  });

  // The config CLI runs as a separate process and rewrites config.json on disk.
  // This watcher reconciles a running server with those out-of-process edits.
  // `deps` is assigned at the end of buildDeps; the closure runs only after start().
  let deps: ServerDeps;
  const configWatcher = new ConfigWatcher({
    configPath: defaultConfigPath(),
    onChange: async () => {
      try {
        await reconcileFolders(deps);
      } catch (err) {
        console.error(
          `[skillforge:config-watcher] reconcile failed, skipping event: ${String(err)}`,
        );
      }
    },
  });

  const logger = stderrLogger;
  const sandboxRunner = new SandboxRunner({ logger });
  // allowScripts flag captured from initial config load. A ref object is used
  // so tools/configure can update it by calling configStore.load() indirectly.
  // For the current scope this snapshot approach is sufficient — a restart or reload
  // will pick up the latest value from disk via the tools/reload path.
  const securityRef = { allowScripts: resolved.persisted.security.allowScripts };
  const scriptStrategy = new ScriptStrategy({
    sandboxRunner,
    isGloballyAllowed: () => securityRef.allowScripts === true,
    logger,
  });
  const hybridStrategy = new HybridStrategy({ scriptStrategy });

  const factory = new StrategyFactory([
    hybridStrategy,
    scriptStrategy,
    new PromptStrategy(),
  ]);

  const invocation = resolved.persisted.invocation;
  const decoratorChain = new DecoratorChain({
    logger,
    defaultTimeoutMs: invocation.defaultTimeoutMs,
    cacheTtlMs: invocation.cacheTtlMs,
    cacheMaxEntries: invocation.cacheMaxEntries,
  });

  deps = {
    folders: resolved.folders,
    configStore,
    registry: new SkillRegistry(),
    resolver: new SkillResolver(),
    metadataCache,
    contentCache: new SkillContentCache({ ttlMs: resolved.ttlMs }),
    parser: new FrontmatterParser(),
    scanner: new FileScanner(),
    factory,
    blacklistFilter,
    folderWatcher,
    configWatcher,
    logger,
    sandboxRunner,
    decoratorChain,
  };
  return deps;
}

/**
 * Start the MCP stdio server: build deps, register tools, connect the stdio
 * transport, then start the runtime watchers and shutdown handlers. This is
 * the single server-start sequence — the dispatcher's `serve` command calls
 * it, and nothing else does.
 */
export async function startServer(): Promise<void> {
  const deps = await buildDeps();
  const server = buildServer(deps);
  await server.connect(new StdioServerTransport());
  await startRuntime(deps);
  registerShutdown(deps);
}
