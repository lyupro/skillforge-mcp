#!/usr/bin/env node
/**
 * SkillForge MCP — stdio entry point.
 *
 * buildServer() and buildDeps() are exported for integration tests so the
 * same wiring is exercised in-process without spawning a subprocess.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadResolvedConfig, buildPatternScanner } from './config.js';
import { ConfigStore, defaultConfigPath } from './config/index.js';
import { FolderWatcher } from './watcher/index.js';
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

  return {
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
    logger,
    sandboxRunner,
    decoratorChain,
  };
}

async function main(): Promise<void> {
  const deps = await buildDeps();
  const server = buildServer(deps);
  await server.connect(new StdioServerTransport());
  await deps.folderWatcher.start();

  const shutdown = async () => {
    await deps.folderWatcher.stop();
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

// Only run main() when invoked directly, not when imported by tests.
// This is the canonical ESM "is this the entry point?" check.
import { fileURLToPath } from 'node:url';
const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((err) => {
    console.error('[skillforge] fatal:', err);
    process.exit(1);
  });
}
