import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { handleReload } from './reload.js';
import { SkillRegistry } from '../core/skill-registry.js';
import { SkillResolver } from '../core/skill-resolver.js';
import { SkillMetadataCache } from '../core/skill-metadata-cache.js';
import { SkillContentCache } from '../core/skill-content-cache.js';
import { StrategyFactory } from '../factory/strategy-factory.js';
import { PromptStrategy } from '../handlers/prompt-strategy.js';
import { BlacklistFilter } from '../security/blacklist-filter.js';
import { SandboxRunner } from '../security/sandbox-runner.js';
import { DecoratorChain, stderrLogger } from '../decorators/index.js';
import type { ServerDeps } from '../server-deps.js';
import type { SkillContent } from '../core/types.js';

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

function makeDeps(overrides: Partial<{
  folders: string[];
  scanResults: Map<string, string[]>;
  parseResults: Map<string, SkillContent>;
  scanError: Map<string, Error>;
  parseError: Map<string, Error>;
  blacklistFilter: BlacklistFilter;
}>): ServerDeps {
  const folders = overrides.folders ?? ['/skills'];
  const scanResults = overrides.scanResults ?? new Map();
  const parseResults = overrides.parseResults ?? new Map();
  const scanErrors = overrides.scanError ?? new Map();
  const parseErrors = overrides.parseError ?? new Map();

  return {
    folders,
    configStore: {} as ServerDeps['configStore'],
    registry: new SkillRegistry(),
    resolver: new SkillResolver(),
    metadataCache: new SkillMetadataCache({ ttlMs: 300_000 }),
    contentCache: new SkillContentCache({ ttlMs: 300_000 }),
    scanner: {
      scan: vi.fn(async (folder: string) => {
        if (scanErrors.has(folder)) throw scanErrors.get(folder)!;
        return scanResults.get(folder) ?? [];
      }),
    } as unknown as import('../parser/file-scanner.js').FileScanner,
    parser: {
      parseFile: vi.fn(async (filePath: string, _folder: string) => {
        if (parseErrors.has(filePath)) throw parseErrors.get(filePath)!;
        if (parseResults.has(filePath)) return parseResults.get(filePath)!;
        throw new Error(`No parse result registered for ${filePath}`);
      }),
    } as unknown as import('../parser/frontmatter-parser.js').FrontmatterParser,
    factory: new StrategyFactory([new PromptStrategy()]),
    blacklistFilter: overrides.blacklistFilter ?? new BlacklistFilter(),
    folderWatcher: {} as ServerDeps['folderWatcher'],
    logger: stderrLogger,
    sandboxRunner: new SandboxRunner({}),
    decoratorChain: new DecoratorChain({ logger: stderrLogger, defaultTimeoutMs: 5_000, cacheTtlMs: 60_000, cacheMaxEntries: 10 }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleReload — basic behavior', () => {
  it('first reload on empty registry: scanner returns 2 files → loaded=2, added sorted, removed=[], errors=[]', async () => {
    const folder = '/skills';
    const contentA = makeContent('skill-a', folder);
    const contentB = makeContent('skill-b', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-a.md`, `${folder}/skill-b.md`]]]),
      parseResults: new Map([
        [`${folder}/skill-a.md`, contentA],
        [`${folder}/skill-b.md`, contentB],
      ]),
    });

    const result = await handleReload(deps, {});

    expect(result.loaded).toBe(2);
    expect(result.added).toEqual(['skill-a', 'skill-b']);
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('second reload with same fixture → added=[], removed=[], loaded=2 (idempotent)', async () => {
    const folder = '/skills';
    const contentA = makeContent('skill-a', folder);
    const contentB = makeContent('skill-b', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-a.md`, `${folder}/skill-b.md`]]]),
      parseResults: new Map([
        [`${folder}/skill-a.md`, contentA],
        [`${folder}/skill-b.md`, contentB],
      ]),
    });

    await handleReload(deps, {});
    const result = await handleReload(deps, {});

    expect(result.loaded).toBe(2);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('reload after removing one source path → removed=[skill-b], added=[], loaded=1', async () => {
    const folder = '/skills';
    const contentA = makeContent('skill-a', folder);
    const contentB = makeContent('skill-b', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-a.md`, `${folder}/skill-b.md`]]]),
      parseResults: new Map([
        [`${folder}/skill-a.md`, contentA],
        [`${folder}/skill-b.md`, contentB],
      ]),
    });

    await handleReload(deps, {});

    // Remove skill-b from the scanner results.
    (deps.scanner.scan as ReturnType<typeof vi.fn>).mockImplementation(async (f: string) => {
      if (f === folder) return [`${folder}/skill-a.md`];
      return [];
    });

    const result = await handleReload(deps, {});

    expect(result.loaded).toBe(1);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(['skill-b']);
    expect(result.errors).toEqual([]);
  });
});

describe('handleReload — error collection', () => {
  it('parse failure: errors contains entry, registry still has the successful skill', async () => {
    const folder = '/skills';
    const contentA = makeContent('skill-a', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-a.md`, `${folder}/bad.md`]]]),
      parseResults: new Map([[`${folder}/skill-a.md`, contentA]]),
      parseError: new Map([[`${folder}/bad.md`, new Error('bad frontmatter')]]),
    });

    const result = await handleReload(deps, {});

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe(`${folder}/bad.md`);
    expect(result.errors[0]?.message).toContain('bad frontmatter');
    expect(result.loaded).toBe(1);
    expect(result.added).toEqual(['skill-a']);
  });

  it('scanner failure: errors contains entry with folder path, loaded reflects successful folders', async () => {
    const badFolder = '/missing';
    const goodFolder = '/skills';
    const contentA = makeContent('skill-a', goodFolder);
    const deps = makeDeps({
      folders: [badFolder, goodFolder],
      scanResults: new Map([[goodFolder, [`${goodFolder}/skill-a.md`]]]),
      parseResults: new Map([[`${goodFolder}/skill-a.md`, contentA]]),
      scanError: new Map([[badFolder, new Error('folder not found')]]),
    });

    const result = await handleReload(deps, {});

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe(badFolder);
    expect(result.errors[0]?.message).toContain('folder not found');
    expect(result.loaded).toBe(1);
  });

  it('parse failure does NOT emit to stderr when errorSink is active', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const folder = '/skills';
    const contentA = makeContent('skill-a', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-a.md`, `${folder}/bad.md`]]]),
      parseResults: new Map([[`${folder}/skill-a.md`, contentA]]),
      parseError: new Map([[`${folder}/bad.md`, new Error('bad frontmatter')]]),
    });

    const result = await handleReload(deps, {});

    // The parse error goes to the sink, not to stderr.
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((m) => m.includes('bad frontmatter'))).toBe(false);
    expect(stderrCalls.some((m) => m.includes('bad.md'))).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('blacklist-excluded skill does NOT appear in errors (routine exclusion)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const folder = '/skills';
    const contentA = makeContent('skill-a', folder);
    const contentBad = makeContent('excluded-skill', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-a.md`, `${folder}/excluded-skill.md`]]]),
      parseResults: new Map([
        [`${folder}/skill-a.md`, contentA],
        [`${folder}/excluded-skill.md`, contentBad],
      ]),
      blacklistFilter: new BlacklistFilter({ manualBlacklist: ['excluded-skill'] }),
    });

    const result = await handleReload(deps, {});

    expect(result.errors).toHaveLength(0);
    expect(result.loaded).toBe(1);
    // Blacklist log goes to stderr as usual.
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((m) => m.includes('blacklisted by name'))).toBe(true);
  });

  it('blacklist-excluded skill is in removed if it was previously registered', async () => {
    const folder = '/skills';
    const contentA = makeContent('skill-a', folder);
    const contentBL = makeContent('will-be-excluded', folder);

    // First reload: no blacklist — both skills register.
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-a.md`, `${folder}/will-be-excluded.md`]]]),
      parseResults: new Map([
        [`${folder}/skill-a.md`, contentA],
        [`${folder}/will-be-excluded.md`, contentBL],
      ]),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleReload(deps, {});
    expect(deps.registry.has('will-be-excluded')).toBe(true);

    // Second reload: add to blacklist — skill disappears.
    deps.blacklistFilter = new BlacklistFilter({ manualBlacklist: ['will-be-excluded'] });
    const result = await handleReload(deps, {});

    expect(result.removed).toContain('will-be-excluded');
    expect(result.errors).toHaveLength(0);
  });
});

describe('handleReload — folder validation', () => {
  it('folder matching a configured folder → behaves like full reload (no throw)', async () => {
    const folder = resolve('/skills');
    const contentA = makeContent('skill-a', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-a.md`]]]),
      parseResults: new Map([[`${folder}/skill-a.md`, contentA]]),
    });

    await expect(handleReload(deps, { folder })).resolves.toMatchObject({
      loaded: 1,
      errors: [],
    });
  });

  it('folder NOT in configured folders → throws with reload: prefix', async () => {
    const deps = makeDeps({ folders: ['/configured'] });

    await expect(handleReload(deps, { folder: '/not-configured' })).rejects.toThrow(
      'reload: folder "/not-configured" is not currently configured',
    );
  });

  it('empty string folder → throws (resolves to cwd which is not configured)', async () => {
    const deps = makeDeps({ folders: ['/configured'] });

    await expect(handleReload(deps, { folder: '' })).rejects.toThrow(
      'reload: folder "" is not currently configured',
    );
  });
});

describe('handleReload — cache state', () => {
  it('after reload, metadataCache.isValid() is true', async () => {
    const folder = '/skills';
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, []]]),
    });

    // Start with cache invalid.
    deps.metadataCache.invalidate();
    expect(deps.metadataCache.isValid()).toBe(false);

    await handleReload(deps, {});

    expect(deps.metadataCache.isValid()).toBe(true);
  });
});
