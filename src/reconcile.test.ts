import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { reconcileFolders } from './reconcile.js';
import { ConfigWatcher } from './watcher/config-watcher.js';
import { ConfigStore } from './config/config-store.js';
import { defaultConfig } from './config/config-schema.js';
import { SkillRegistry } from './core/skill-registry.js';
import { SkillResolver } from './core/skill-resolver.js';
import { SkillMetadataCache } from './core/skill-metadata-cache.js';
import { SkillContentCache } from './core/skill-content-cache.js';
import { StrategyFactory } from './factory/strategy-factory.js';
import { PromptStrategy } from './handlers/prompt-strategy.js';
import { BlacklistFilter } from './security/blacklist-filter.js';
import { SandboxRunner } from './security/sandbox-runner.js';
import { DecoratorChain, stderrLogger } from './decorators/index.js';
import type { ServerDeps } from './server-deps.js';
import type { ChokidarLike, ChokidarWatcher, ChokidarOptions } from './watcher/chokidar-types.js';
import type { SkillContent } from './core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
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

function makeDeps(opts: {
  configStore: ConfigStore;
  scanResults: Map<string, string[]>;
  parseResults: Map<string, SkillContent>;
}): ServerDeps {
  return {
    folders: [],
    configStore: opts.configStore,
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
      scan: vi.fn(async (folder: string) => opts.scanResults.get(folder) ?? []),
    } as unknown as ServerDeps['scanner'],
    parser: {
      parseFile: vi.fn(async (filePath: string) => {
        const hit = opts.parseResults.get(filePath);
        if (hit === undefined) throw new Error(`No parse result for ${filePath}`);
        return hit;
      }),
    } as unknown as ServerDeps['parser'],
    factory: new StrategyFactory([new PromptStrategy()]),
    blacklistFilter: new BlacklistFilter(),
    folderWatcher: {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      setFolders: vi.fn(async () => {}),
      isRunning: () => false,
      getFolders: () => [],
    } as unknown as ServerDeps['folderWatcher'],
    configWatcher: {} as ServerDeps['configWatcher'],
    logger: stderrLogger,
    sandboxRunner: new SandboxRunner({}),
    decoratorChain: new DecoratorChain({
      logger: stderrLogger,
      defaultTimeoutMs: 5_000,
      cacheTtlMs: 60_000,
      cacheMaxEntries: 10,
    }),
  };
}

// ---------------------------------------------------------------------------
// Fake chokidar (minimal — just enough to drive ConfigWatcher)
// ---------------------------------------------------------------------------

interface FakeWatcher {
  simulate(event: 'add' | 'change', path: string): void;
}

function makeFakeChokidar(): { chokidar: ChokidarLike; watchers: FakeWatcher[] } {
  const watchers: FakeWatcher[] = [];
  const chokidar: ChokidarLike = {
    watch(_paths: string | readonly string[], _options?: ChokidarOptions): ChokidarWatcher {
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      watchers.push({
        simulate(event, path) {
          for (const h of handlers.get(event) ?? []) h(path);
        },
      });
      const instance: ChokidarWatcher = {
        on(event, handler) {
          const list = handlers.get(event) ?? [];
          list.push(handler);
          handlers.set(event, list);
          return instance;
        },
        close: async () => {},
        add() {},
        unwatch() {},
      };
      return instance;
    },
  };
  return { chokidar, watchers };
}

function makeSyncTimers() {
  // Run the debounced callback synchronously on the next setTimeout call.
  let cb: (() => void) | null = null;
  return {
    setTimeoutFn: ((fn: () => void) => {
      cb = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => { cb = null; }) as typeof clearTimeout,
    flush: () => {
      const fn = cb;
      cb = null;
      if (fn !== null) fn();
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reconcileFolders', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (tmpDir !== null) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('rebuilds the registry from the freshly persisted config', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skillforge-reconcile-'));
    const configPath = join(tmpDir, 'config.json');
    const store = new ConfigStore({ filePath: configPath });

    const folder = resolve(tmpDir, 'skills');
    const skill = makeContent('reconciled-skill', folder);
    const deps = makeDeps({
      configStore: store,
      scanResults: new Map([[folder, [`${folder}/reconciled-skill.md`]]]),
      parseResults: new Map([[`${folder}/reconciled-skill.md`, skill]]),
    });

    // Out-of-process write of config.json (simulating the folders CLI).
    await store.save({
      ...defaultConfig(),
      folders: [{ path: folder, priority: 100, enabled: true, tags: [] }],
    });

    expect(deps.registry.size).toBe(0);
    await reconcileFolders(deps);

    expect(deps.folders).toEqual([folder]);
    expect(deps.registry.has('reconciled-skill')).toBe(true);
  });
});

describe('ConfigWatcher → reconcileFolders integration', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (tmpDir !== null) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('a simulated config.json change triggers reconcileFolders and rebuilds the registry', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skillforge-reconcile-'));
    const configPath = join(tmpDir, 'config.json');
    const store = new ConfigStore({ filePath: configPath });

    const folder = resolve(tmpDir, 'skills');
    const skill = makeContent('watched-skill', folder);
    const deps = makeDeps({
      configStore: store,
      scanResults: new Map([[folder, [`${folder}/watched-skill.md`]]]),
      parseResults: new Map([[`${folder}/watched-skill.md`, skill]]),
    });

    const { chokidar, watchers } = makeFakeChokidar();
    const timers = makeSyncTimers();
    let reconcileError: unknown = null;
    let lastOnChange: Promise<void> = Promise.resolve();
    const watcher = new ConfigWatcher({
      configPath,
      onChange: () => {
        lastOnChange = (async () => {
          try {
            await reconcileFolders(deps);
          } catch (err) {
            reconcileError = err;
          }
        })();
        return lastOnChange;
      },
      chokidar,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    await watcher.start();

    // CLI rewrites config.json, then the FS event fires.
    await store.save({
      ...defaultConfig(),
      folders: [{ path: folder, priority: 100, enabled: true, tags: [] }],
    });
    watchers[0]!.simulate('change', configPath);
    timers.flush();
    // Await the async onChange the debounced timer kicked off.
    await lastOnChange;

    expect(reconcileError).toBeNull();
    expect(deps.registry.has('watched-skill')).toBe(true);

    await watcher.stop();
  });

  it('an invalid / half-written config.json does not throw out of the onChange handler', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skillforge-reconcile-'));
    const configPath = join(tmpDir, 'config.json');
    const store = new ConfigStore({ filePath: configPath });

    const deps = makeDeps({
      configStore: store,
      scanResults: new Map(),
      parseResults: new Map(),
    });

    const { chokidar, watchers } = makeFakeChokidar();
    const timers = makeSyncTimers();
    let lastOnChange: Promise<void> = Promise.resolve();
    const watcher = new ConfigWatcher({
      configPath,
      onChange: () => {
        lastOnChange = (async () => {
          try {
            await reconcileFolders(deps);
          } catch (err) {
            console.error(
              `[skillforge:config-watcher] reconcile failed, skipping event: ${String(err)}`,
            );
          }
        })();
        return lastOnChange;
      },
      chokidar,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    await watcher.start();

    // Write a half-written config: valid file, invalid JSON. ConfigStore.load() throws.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(configPath, '{ "folders": [', 'utf8');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    watchers[0]!.simulate('change', configPath);
    expect(() => timers.flush()).not.toThrow();
    await expect(lastOnChange).resolves.not.toThrow();
    spy.mockRestore();

    await watcher.stop();
  });
});
