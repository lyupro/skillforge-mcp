/**
 * Shared fakes for the configure-tool tests: an in-memory ConfigStore plus a
 * ServerDeps graph with no filesystem, watcher or subprocess behind it.
 *
 * Extracted so more than one test file can drive handleConfigure without
 * copying sixty lines of wiring -- copies drift, and a drifting fake makes
 * tests disagree about what the tool was given.
 */

import { vi } from 'vitest';
import { SkillRegistry } from '../core/skill-registry.js';
import { SkillResolver } from '../core/skill-resolver.js';
import { SkillMetadataCache } from '../core/skill-metadata-cache.js';
import { SkillContentCache } from '../core/skill-content-cache.js';
import { StrategyFactory } from '../factory/strategy-factory.js';
import { PromptStrategy } from '../handlers/prompt-strategy.js';
import { BlacklistFilter } from '../security/blacklist-filter.js';
import { SandboxRunner } from '../security/sandbox-runner.js';
import { DecoratorChain, stderrLogger } from '../decorators/index.js';
import { defaultConfig } from '../config/config-schema.js';
import type { ServerDeps } from '../server-deps.js';
import type { ConfigStore } from '../config/index.js';
import type { PersistedConfig } from '../config/index.js';
import type { SkillContent } from '../core/types.js';
import type { FolderWatcher } from '../watcher/index.js';

export function makeContent(name: string, folder: string): SkillContent {
  return {
    name,
    description: `Desc of ${name}`,
    sourcePath: `${folder}/${name}.md`,
    folder,
    tags: [],
    format: 'claude',
    allowScripts: false,
    allowNetwork: false,
    body: `Body of ${name}`,
    raw: `---\nname: ${name}\n---\nBody of ${name}`,
  };
}

/** Build a fake ConfigStore backed by an in-memory PersistedConfig. */
export function makeFakeStore(initial?: Partial<PersistedConfig>): {
  store: ConfigStore;
  saved: PersistedConfig[];
  current: () => PersistedConfig;
} {
  let config: PersistedConfig = { ...defaultConfig(), ...initial };
  const saved: PersistedConfig[] = [];
  const store: ConfigStore = {
    load: async () => ({ ...config }),
    save: async (c: PersistedConfig) => {
      config = { ...c };
      saved.push({ ...c });
    },
    getFilePath: () => '/fake/config.json',
  } as unknown as ConfigStore;
  return { store, saved, current: () => config };
}

export function makeFakeWatcher(): FolderWatcher {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setFolders: vi.fn(async () => {}),
    isRunning: () => false,
    getFolders: () => [],
  } as unknown as FolderWatcher;
}

export function makeFakeConfigWatcher(): ServerDeps['configWatcher'] {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    isRunning: () => false,
    getConfigPath: () => '/fake/config.json',
  } as unknown as ServerDeps['configWatcher'];
}

export function makeDeps(overrides: {
  store: ConfigStore;
  folders?: string[];
  scanResults?: Map<string, string[]>;
  parseResults?: Map<string, SkillContent>;
  folderWatcher?: FolderWatcher;
}): ServerDeps {
  const folders = overrides.folders ?? [];
  const scanResults = overrides.scanResults ?? new Map();
  const parseResults = overrides.parseResults ?? new Map();

  return {
    folders,
    configStore: overrides.store,
    registry: new SkillRegistry(),
    resolver: new SkillResolver(),
    metadataCache: new SkillMetadataCache({ ttlMs: 300_000 }),
    contentCache: new SkillContentCache({ ttlMs: 300_000 }),
    indexStore: {
      load: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      invalidate: vi.fn(async () => {}),
      getPath: () => '/fake/registry-index.json',
    } as unknown as ServerDeps['indexStore'],
    indexEnabled: false,
    scanner: {
      scan: vi.fn(async (folder: string) => scanResults.get(folder) ?? []),
    } as unknown as import('../parser/file-scanner.js').FileScanner,
    parser: {
      parseFile: vi.fn(async (filePath: string, _folder: string) => {
        if (parseResults.has(filePath)) return parseResults.get(filePath)!;
        throw new Error(`No parse result for ${filePath}`);
      }),
      tryParseFile: vi.fn(async (filePath: string, _folder: string) => {
        if (parseResults.has(filePath)) return parseResults.get(filePath)!;
        return null;
      }),
    } as unknown as import('../parser/frontmatter-parser.js').FrontmatterParser,
    factory: new StrategyFactory([new PromptStrategy()]),
    blacklistFilter: new BlacklistFilter(),
    folderWatcher: overrides.folderWatcher ?? makeFakeWatcher(),
    configWatcher: makeFakeConfigWatcher(),
    logger: stderrLogger,
    sandboxRunner: new SandboxRunner({}),
    decoratorChain: new DecoratorChain({ logger: stderrLogger, defaultTimeoutMs: 5_000, cacheTtlMs: 60_000, cacheMaxEntries: 10 }),
  };
}
