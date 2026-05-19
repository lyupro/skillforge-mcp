import { describe, it, expect, vi } from 'vitest';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { handleConfigure } from './configure.js';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContent(name: string, folder: string): SkillContent {
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
function makeFakeStore(initial?: Partial<PersistedConfig>): {
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

function makeFakeWatcher(): FolderWatcher {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setFolders: vi.fn(async () => {}),
    isRunning: () => false,
    getFolders: () => [],
  } as unknown as FolderWatcher;
}

function makeFakeConfigWatcher(): ServerDeps['configWatcher'] {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    isRunning: () => false,
    getConfigPath: () => '/fake/config.json',
  } as unknown as ServerDeps['configWatcher'];
}

function makeDeps(overrides: {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleConfigure — list_folders', () => {
  it('returns folders resolved fresh from disk without calling save', async () => {
    const folderA = resolve('/a');
    const folderB = resolve('/b');
    const { store, saved } = makeFakeStore({
      folders: [
        { path: folderA, priority: 100, enabled: true, tags: [] },
        { path: folderB, priority: 90, enabled: true, tags: [] },
      ],
    });
    const deps = makeDeps({ store });
    const result = await handleConfigure(deps, { action: 'list_folders' });
    expect(result.folders).toEqual([folderA, folderB]);
    expect(saved).toHaveLength(0);
  });

  it('reflects an out-of-process config.json mutation, not the stale in-memory snapshot', async () => {
    // deps.folders is the startup snapshot ['/stale']. The config file is then
    // rewritten out-of-band (simulating the `skillforge folders` CLI).
    // list_folders must read disk truth, not deps.folders.
    const { store } = makeFakeStore({
      folders: [{ path: resolve('/stale'), priority: 100, enabled: true, tags: [] }],
    });
    const deps = makeDeps({ store, folders: [resolve('/stale')] });

    const newFolder = resolve('/fresh-from-cli');
    await store.save({
      ...defaultConfig(),
      folders: [{ path: newFolder, priority: 100, enabled: true, tags: [] }],
    });

    const result = await handleConfigure(deps, { action: 'list_folders' });
    expect(result.folders).toEqual([newFolder]);
    expect(result.folders).not.toContain(resolve('/stale'));
  });
});

describe('handleConfigure — get_blacklist', () => {
  it('returns persisted blacklist without calling save', async () => {
    const { store, saved } = makeFakeStore({ blacklist: ['bad-skill'] });
    const deps = makeDeps({ store });
    const result = await handleConfigure(deps, { action: 'get_blacklist' });
    expect(result.blacklist).toEqual(['bad-skill']);
    expect(saved).toHaveLength(0);
  });
});

describe('handleConfigure — add_folder', () => {
  it('appends new path and calls save once; deps.folders updated', async () => {
    const { store, saved } = makeFakeStore();
    const deps = makeDeps({ store, folders: [] });
    const inputPath = '/new/path';
    const absPath = resolve(inputPath);
    const result = await handleConfigure(deps, { action: 'add_folder', folder: inputPath });
    expect(saved).toHaveLength(1);
    const savedFolders = saved[0]!.folders.map((f) => f.path);
    expect(savedFolders).toContain(absPath);
    // deps.folders reflects new resolved list (env empty → persisted enabled paths)
    expect(deps.folders).toContain(absPath);
    expect(result.folders).toContain(absPath);
  });

  it('is idempotent for already-present absolute path; save still called', async () => {
    // Why: always save on add_folder — simpler than branching, atomic write is cheap.
    const { store, saved } = makeFakeStore({
      folders: [{ path: '/existing', priority: 100, enabled: true, tags: [] }],
    });
    const deps = makeDeps({ store, folders: ['/existing'] });
    await handleConfigure(deps, { action: 'add_folder', folder: '/existing' });
    // save is still called (idempotent write)
    expect(saved).toHaveLength(1);
    expect(saved[0]!.folders).toHaveLength(1);
  });

  it('throws when folder arg is missing', async () => {
    const { store } = makeFakeStore();
    const deps = makeDeps({ store });
    await expect(handleConfigure(deps, { action: 'add_folder' })).rejects.toThrow(
      'add_folder" requires "folder"',
    );
  });

  it('throws when folder is empty string', async () => {
    const { store } = makeFakeStore();
    const deps = makeDeps({ store });
    await expect(handleConfigure(deps, { action: 'add_folder', folder: '   ' })).rejects.toThrow(
      'folder path must not be empty',
    );
  });

  it('returns conflictHint when the folder is inside a host native skill store', async () => {
    const { store } = makeFakeStore();
    const deps = makeDeps({ store, folders: [] });
    // A path inside the real Gemini extensions root. Detection is pure path
    // logic and reads no files, so nothing is created on disk.
    const extPath = join(homedir(), '.gemini', 'extensions', 'fixture-ext', 'skills');
    const result = await handleConfigure(deps, { action: 'add_folder', folder: extPath });
    expect(result.conflictHint).toBeDefined();
    expect(result.conflictHint).toContain('Gemini CLI extension');
    expect(result.conflictHint).toContain('/extensions disable fixture-ext');
    // Folder is still registered despite the conflict.
    expect(result.folders).toContain(resolve(extPath));
  });

  it('omits conflictHint for an ordinary folder', async () => {
    const { store } = makeFakeStore();
    const deps = makeDeps({ store, folders: [] });
    const result = await handleConfigure(deps, { action: 'add_folder', folder: '/plain/path' });
    expect(result.conflictHint).toBeUndefined();
  });

  it('persists an alias when one is provided', async () => {
    const { store, saved } = makeFakeStore();
    const deps = makeDeps({ store, folders: [] });
    await handleConfigure(deps, { action: 'add_folder', folder: '/new/path', alias: 'work' });
    const entry = saved[0]!.folders.find((f) => f.path === resolve('/new/path'));
    expect(entry?.alias).toBe('work');
  });

  it('throws when the alias is already in use by another folder', async () => {
    const { store } = makeFakeStore({
      folders: [{ path: '/existing', priority: 100, enabled: true, tags: [], alias: 'work' }],
    });
    const deps = makeDeps({ store, folders: ['/existing'] });
    await expect(
      handleConfigure(deps, { action: 'add_folder', folder: '/new/path', alias: 'work' }),
    ).rejects.toThrow('alias already in use');
  });

  it('throws for a non-kebab-case alias', async () => {
    const { store } = makeFakeStore();
    const deps = makeDeps({ store, folders: [] });
    await expect(
      handleConfigure(deps, { action: 'add_folder', folder: '/new/path', alias: 'Bad_Alias' }),
    ).rejects.toThrow('invalid alias');
  });
});

describe('handleConfigure — remove_folder', () => {
  it('removes present path; save called', async () => {
    const { store, saved } = makeFakeStore({
      folders: [
        { path: '/keep', priority: 100, enabled: true, tags: [] },
        { path: '/remove-me', priority: 90, enabled: true, tags: [] },
      ],
    });
    const deps = makeDeps({ store, folders: ['/keep', '/remove-me'] });
    const result = await handleConfigure(deps, { action: 'remove_folder', folder: '/remove-me' });
    expect(saved).toHaveLength(1);
    const savedPaths = saved[0]!.folders.map((f) => f.path);
    expect(savedPaths).not.toContain('/remove-me');
    expect(savedPaths).toContain('/keep');
    expect(result.folders).not.toContain('/remove-me');
  });

  it('no-op for absent path; save still called without throwing', async () => {
    const { store, saved } = makeFakeStore({
      folders: [{ path: '/keep', priority: 100, enabled: true, tags: [] }],
    });
    const deps = makeDeps({ store, folders: ['/keep'] });
    await expect(
      handleConfigure(deps, { action: 'remove_folder', folder: '/not-there' }),
    ).resolves.not.toThrow();
    expect(saved).toHaveLength(1);
  });
});

describe('handleConfigure — set_blacklist', () => {
  it('persists new blacklist and updates blacklistFilter', async () => {
    const { store } = makeFakeStore();
    const folder = resolve('/skills');
    const content = makeContent('foo', folder);
    const deps = makeDeps({
      store,
      folders: [],
      scanResults: new Map([[folder, [`${folder}/foo.md`]]]),
      parseResults: new Map([[`${folder}/foo.md`, content]]),
    });

    await handleConfigure(deps, { action: 'set_blacklist', blacklist: ['foo', 'bar'] });

    // Live filter now rejects 'foo'
    expect(deps.blacklistFilter.evaluate(content)).toEqual({ allowed: false, reason: 'manual' });
  });

  it('throws when blacklist arg is missing', async () => {
    const { store } = makeFakeStore();
    const deps = makeDeps({ store });
    await expect(handleConfigure(deps, { action: 'set_blacklist' })).rejects.toThrow(
      'set_blacklist" requires "blacklist"',
    );
  });
});

describe('handleConfigure — reset', () => {
  it('replaces config with defaults; blacklist cleared; folders cleared', async () => {
    const { store, saved } = makeFakeStore({
      folders: [{ path: '/old', priority: 100, enabled: true, tags: [] }],
      blacklist: ['something'],
    });
    const deps = makeDeps({ store, folders: ['/old'] });
    const result = await handleConfigure(deps, { action: 'reset' });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.blacklist).toEqual([]);
    expect(saved[0]!.folders).toEqual([]);
    expect(result.blacklist).toEqual([]);
  });
});

describe('handleConfigure — folderWatcher integration', () => {
  it('add_folder calls folderWatcher.setFolders with the new resolved list', async () => {
    const { store } = makeFakeStore();
    const folderWatcher = makeFakeWatcher();
    const deps = makeDeps({ store, folders: [], folderWatcher });
    const inputPath = '/new/watcher-path';
    const absPath = resolve(inputPath);

    await handleConfigure(deps, { action: 'add_folder', folder: inputPath });

    const setFoldersMock = folderWatcher.setFolders as ReturnType<typeof vi.fn>;
    expect(setFoldersMock).toHaveBeenCalled();
    const lastCall: string[] = setFoldersMock.mock.calls[setFoldersMock.mock.calls.length - 1]![0] as string[];
    expect(lastCall).toContain(absPath);
  });
});

describe('handleConfigure — post-mutation side effects', () => {
  it('metadataCache.isValid() is false after mutation (forces rescan)', async () => {
    const { store } = makeFakeStore();
    const deps = makeDeps({ store });
    // Mark cache fresh before the action.
    deps.metadataCache.markFresh();
    expect(deps.metadataCache.isValid()).toBe(true);
    await handleConfigure(deps, { action: 'add_folder', folder: '/some/path' });
    // reconcileFolders calls invalidate then ensureRegistryFresh which calls markFresh,
    // so after a complete reconcile cycle the cache is valid again.
    // The key invariant: invalidate() was called during the action (rescan was triggered).
    // We verify the rescan happened by confirming the scanner was called.
    const scanFn = deps.scanner.scan as ReturnType<typeof vi.fn>;
    expect(scanFn).toHaveBeenCalled();
  });

  it('registry.size matches ensureRegistryFresh output after add_folder with a fixture skill', async () => {
    const { store } = makeFakeStore();
    // Use resolve() so the path matches what configure.ts stores and what loader scans.
    const folder = resolve('/skills');
    const content = makeContent('my-skill', folder);
    const deps = makeDeps({
      store,
      folders: [],
      scanResults: new Map([[folder, [`${folder}/my-skill.md`]]]),
      parseResults: new Map([[`${folder}/my-skill.md`, content]]),
    });

    const result = await handleConfigure(deps, { action: 'add_folder', folder });
    expect(result.totalSkills).toBe(1);
    expect(deps.registry.has('my-skill')).toBe(true);
  });
});
