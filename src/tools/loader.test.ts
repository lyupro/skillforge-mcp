import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ensureRegistryFresh, rebuildRegistry } from './loader.js';
import { SkillRegistry } from '../core/skill-registry.js';
import { SkillResolver } from '../core/skill-resolver.js';
import { SkillMetadataCache } from '../core/skill-metadata-cache.js';
import { SkillContentCache } from '../core/skill-content-cache.js';
import { StrategyFactory } from '../factory/strategy-factory.js';
import { PromptStrategy } from '../handlers/prompt-strategy.js';
import { BlacklistFilter } from '../security/blacklist-filter.js';
import { PatternScanner } from '../security/pattern-scanner.js';
import { SandboxRunner } from '../security/sandbox-runner.js';
import { DecoratorChain, stderrLogger, createLeveledLogger } from '../decorators/index.js';
import type { Logger, LogLevel } from '../decorators/index.js';
import { INDEX_VERSION, computeFingerprint } from '../core/index.js';
import type { RegistryIndex } from '../core/index.js';
import type { ServerDeps } from '../server-deps.js';
import type { SkillContent } from '../core/types.js';

/** Capture every logger call by level — lets assertions inspect what the
 *  loader wrote and at which level. */
function captureLogger(): { logger: Logger; lines: { level: LogLevel; message: string }[] } {
  const lines: { level: LogLevel; message: string }[] = [];
  const logger: Logger = {
    debug: (m) => { lines.push({ level: 'debug', message: m }); },
    info: (m) => { lines.push({ level: 'info', message: m }); },
    warn: (m) => { lines.push({ level: 'warn', message: m }); },
    error: (m) => { lines.push({ level: 'error', message: m }); },
  };
  return { logger, lines };
}

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
  scanError?: Map<string, Error>;
  parseError?: Map<string, Error>;
  cacheValid: boolean;
  blacklistFilter: BlacklistFilter;
  indexStore: ServerDeps['indexStore'];
  indexEnabled: boolean;
  logger: Logger;
}>): ServerDeps {
  const folders = overrides.folders ?? ['/skills'];
  const scanResults = overrides.scanResults ?? new Map();
  const parseResults = overrides.parseResults ?? new Map();
  const scanErrors = overrides.scanError ?? new Map();
  const parseErrors = overrides.parseError ?? new Map();
  const cacheValid = overrides.cacheValid ?? false;

  return {
    folders,
    registry: new SkillRegistry(),
    resolver: new SkillResolver(),
    metadataCache: {
      isValid: () => cacheValid,
      markFresh: vi.fn(),
      invalidate: vi.fn(),
      expiresAt: () => null,
      ttlMs: 300_000,
    } as unknown as SkillMetadataCache,
    contentCache: new SkillContentCache({ ttlMs: 300_000 }),
    indexStore: overrides.indexStore ?? ({
      load: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      invalidate: vi.fn(async () => {}),
      getPath: () => '/fake/registry-index.json',
    } as unknown as ServerDeps['indexStore']),
    indexEnabled: overrides.indexEnabled ?? false,
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
      tryParseFile: vi.fn(async (filePath: string, _folder: string) => {
        if (parseErrors.has(filePath)) throw parseErrors.get(filePath)!;
        if (parseResults.has(filePath)) return parseResults.get(filePath)!;
        // Test default: any path the fixture did not register is treated as
        // a candidate-miss (silent), matching the loader's new non-candidate
        // contract. Per-suite tests inject explicit fixtures.
        return null;
      }),
    } as unknown as import('../parser/frontmatter-parser.js').FrontmatterParser,
    factory: new StrategyFactory([new PromptStrategy()]),
    blacklistFilter: overrides.blacklistFilter ?? new BlacklistFilter(),
    logger: overrides.logger ?? stderrLogger,
    sandboxRunner: new SandboxRunner({}),
    decoratorChain: new DecoratorChain({ logger: stderrLogger, defaultTimeoutMs: 5_000, cacheTtlMs: 60_000, cacheMaxEntries: 10 }),
  };
}

describe('ensureRegistryFresh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns immediately when cache is valid', async () => {
    const deps = makeDeps({ cacheValid: true });
    const scanSpy = vi.spyOn(deps.scanner, 'scan');
    await ensureRegistryFresh(deps);
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('populates registry and content cache, marks cache fresh after full scan', async () => {
    const folder = '/skills';
    const content = makeContent('apple-hig-check', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/apple-hig-check.md`]]]),
      parseResults: new Map([[`${folder}/apple-hig-check.md`, content]]),
    });

    await ensureRegistryFresh(deps);

    expect(deps.registry.has('apple-hig-check')).toBe(true);
    expect(deps.contentCache.get('apple-hig-check')).toMatchObject({ name: 'apple-hig-check' });
    expect(deps.metadataCache.markFresh).toHaveBeenCalledOnce();
  });

  it('skips malformed skill file at debug level and continues', async () => {
    const { logger, lines } = captureLogger();
    const folder = '/skills';
    const goodContent = makeContent('good-skill', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/bad.md`, `${folder}/good-skill.md`]]]),
      parseResults: new Map([[`${folder}/good-skill.md`, goodContent]]),
      parseError: new Map([[`${folder}/bad.md`, new Error('bad frontmatter')]]),
      logger,
    });

    await ensureRegistryFresh(deps);

    const skipLines = lines.filter((l) => l.message.includes('/skills/bad.md'));
    expect(skipLines).toHaveLength(1);
    expect(skipLines[0]!.level).toBe('debug');
    expect(skipLines[0]!.message).toContain('bad frontmatter');
    expect(deps.registry.has('good-skill')).toBe(true);
    expect(deps.registry.has('bad')).toBe(false);
  });

  it('skips missing folder at warn level and continues with remaining folders', async () => {
    const { logger, lines } = captureLogger();
    const folder1 = '/missing';
    const folder2 = '/present';
    const content = makeContent('my-skill', folder2);
    const deps = makeDeps({
      folders: [folder1, folder2],
      scanResults: new Map([[folder2, [`${folder2}/my-skill.md`]]]),
      parseResults: new Map([[`${folder2}/my-skill.md`, content]]),
      scanError: new Map([[folder1, new Error('Folder not found: /missing')]]),
      logger,
    });

    await ensureRegistryFresh(deps);

    const folderLines = lines.filter((l) => l.message.includes('/missing'));
    expect(folderLines).toHaveLength(1);
    expect(folderLines[0]!.level).toBe('warn');
    expect(deps.registry.has('my-skill')).toBe(true);
  });

  it('manual blacklist exclusion logs at warn level', async () => {
    const { logger, lines } = captureLogger();
    const folder = '/skills';
    const contentX = makeContent('skill-x', folder);
    const contentY = makeContent('skill-y', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/skill-x.md`, `${folder}/skill-y.md`]]]),
      parseResults: new Map([
        [`${folder}/skill-x.md`, contentX],
        [`${folder}/skill-y.md`, contentY],
      ]),
      blacklistFilter: new BlacklistFilter({ manualBlacklist: ['skill-x'] }),
      logger,
    });

    await ensureRegistryFresh(deps);

    expect(deps.registry.has('skill-x')).toBe(false);
    expect(deps.registry.has('skill-y')).toBe(true);
    const excludeLines = lines.filter((l) => l.message.includes('blacklisted by "skill-x"'));
    expect(excludeLines).toHaveLength(1);
    expect(excludeLines[0]!.level).toBe('warn');
  });

  it('auto-audit exclusion logs at warn level (security-significant)', async () => {
    const { logger, lines } = captureLogger();
    const folder = '/skills';
    const evilContent = makeContent('evil-skill', folder);
    // Default auditTarget is 'scripts' — the pattern must live in fenced code.
    evilContent.body = '```js\neval(user_input)\n```';
    const cleanContent = makeContent('clean-skill', folder);
    cleanContent.body = 'print("hello")';

    const scanner = new PatternScanner({ patterns: ['eval\\(', 'exec\\(', 'shell=True', 'base64\\.b64decode'] });
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/evil-skill.md`, `${folder}/clean-skill.md`]]]),
      parseResults: new Map([
        [`${folder}/evil-skill.md`, evilContent],
        [`${folder}/clean-skill.md`, cleanContent],
      ]),
      blacklistFilter: new BlacklistFilter({ patternScanner: scanner }),
      logger,
    });

    await ensureRegistryFresh(deps);

    expect(deps.registry.has('evil-skill')).toBe(false);
    expect(deps.registry.has('clean-skill')).toBe(true);
    const auditLines = lines.filter((l) => l.message.includes('audit hit: eval\\('));
    expect(auditLines).toHaveLength(1);
    expect(auditLines[0]!.level).toBe('warn');
  });

  it('resolves conflict to higher-priority folder winner with warn-level collision log', async () => {
    const { logger, lines } = captureLogger();
    const folder1 = '/priority-1';
    const folder2 = '/priority-2';
    const content1 = makeContent('shared-skill', folder1);
    const content2 = makeContent('shared-skill', folder2);
    const deps = makeDeps({
      folders: [folder1, folder2],
      scanResults: new Map([
        [folder1, [`${folder1}/shared-skill.md`]],
        [folder2, [`${folder2}/shared-skill.md`]],
      ]),
      parseResults: new Map([
        [`${folder1}/shared-skill.md`, content1],
        [`${folder2}/shared-skill.md`, content2],
      ]),
      logger,
    });

    await ensureRegistryFresh(deps);

    const winner = deps.registry.get('shared-skill');
    expect(winner?.folder).toBe(folder1);
    const cachedContent = deps.contentCache.get('shared-skill');
    expect(cachedContent?.folder).toBe(folder1);
    const collisionLines = lines.filter((l) =>
      l.message.includes('name collision for "shared-skill"'),
    );
    expect(collisionLines).toHaveLength(1);
    expect(collisionLines[0]!.level).toBe('warn');
  });
});

describe('rebuildRegistry', () => {
  it('errorSink supplied + scanner throws → error pushed to sink, NOT to the logger', async () => {
    const { logger, lines } = captureLogger();
    const folder = '/missing';
    const deps = makeDeps({
      folders: [folder],
      scanError: new Map([[folder, new Error('folder not found')]]),
      logger,
    });

    const sink: Array<{ path: string; message: string }> = [];
    const stats = await rebuildRegistry(deps, { errorSink: sink });

    expect(sink).toHaveLength(1);
    expect(sink[0]?.path).toBe(folder);
    expect(sink[0]?.message).toContain('folder not found');
    // Logger must NOT carry the scan error when a sink is provided.
    expect(lines.some((l) => l.message.includes('folder not found'))).toBe(false);
    expect(stats.errors).toBe(sink);
  });

  it('no errorSink + scanner throws → warn line preserved (default routing)', async () => {
    const { logger, lines } = captureLogger();
    const folder = '/missing';
    const deps = makeDeps({
      folders: [folder],
      scanError: new Map([[folder, new Error('folder not found')]]),
      logger,
    });

    const stats = await rebuildRegistry(deps);

    const folderLines = lines.filter((l) => l.message.includes('folder not found'));
    expect(folderLines).toHaveLength(1);
    expect(folderLines[0]!.level).toBe('warn');
    expect(stats.errors).toEqual([]);
  });

  it('returns sorted skill names in stats.skills', async () => {
    const folder = '/skills';
    const contentZ = makeContent('zebra-skill', folder);
    const contentA = makeContent('alpha-skill', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/zebra-skill.md`, `${folder}/alpha-skill.md`]]]),
      parseResults: new Map([
        [`${folder}/zebra-skill.md`, contentZ],
        [`${folder}/alpha-skill.md`, contentA],
      ]),
    });

    const stats = await rebuildRegistry(deps);

    expect(stats.skills).toEqual(['alpha-skill', 'zebra-skill']);
  });
});

describe('ensureRegistryFresh — leveled logger integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('default (info) suppresses per-file skip lines but keeps folder failure visible', async () => {
    const sink = captureLogger();
    const leveled = createLeveledLogger({ level: 'info', sink: sink.logger });
    const folderMissing = '/missing';
    const folderPresent = '/skills';
    const goodContent = makeContent('good-skill', folderPresent);
    const deps = makeDeps({
      folders: [folderMissing, folderPresent],
      scanResults: new Map([[folderPresent, [`${folderPresent}/bad.md`, `${folderPresent}/good.md`]]]),
      parseResults: new Map([[`${folderPresent}/good.md`, goodContent]]),
      parseError: new Map([[`${folderPresent}/bad.md`, new Error('missing required frontmatter field')]]),
      scanError: new Map([[folderMissing, new Error('Folder not found')]]),
      logger: leveled,
    });

    await ensureRegistryFresh(deps);

    // Folder failure surfaces at warn — passes through.
    expect(sink.lines.some((l) => l.level === 'warn' && l.message.includes('skipped folder /missing'))).toBe(true);
    // Per-file skip is debug — dropped at info level.
    expect(sink.lines.some((l) => l.message.includes('skipped /skills/bad.md'))).toBe(false);
  });

  it('debug level emits per-file skip lines', async () => {
    const sink = captureLogger();
    const leveled = createLeveledLogger({ level: 'debug', sink: sink.logger });
    const folder = '/skills';
    const goodContent = makeContent('good-skill', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/bad.md`, `${folder}/good.md`]]]),
      parseResults: new Map([[`${folder}/good.md`, goodContent]]),
      parseError: new Map([[`${folder}/bad.md`, new Error('missing required frontmatter field')]]),
      logger: leveled,
    });

    await ensureRegistryFresh(deps);

    expect(sink.lines.some((l) => l.level === 'debug' && l.message.includes('skipped /skills/bad.md'))).toBe(true);
  });

  it('warn level still surfaces blacklist exclusion (security-significant)', async () => {
    const sink = captureLogger();
    const leveled = createLeveledLogger({ level: 'warn', sink: sink.logger });
    const folder = '/skills';
    const content = makeContent('bad-skill', folder);
    const deps = makeDeps({
      folders: [folder],
      scanResults: new Map([[folder, [`${folder}/bad-skill.md`]]]),
      parseResults: new Map([[`${folder}/bad-skill.md`, content]]),
      blacklistFilter: new BlacklistFilter({ manualBlacklist: ['bad-skill'] }),
      logger: leveled,
    });

    await ensureRegistryFresh(deps);

    expect(sink.lines.some((l) => l.level === 'warn' && l.message.includes('blacklisted by "bad-skill"'))).toBe(true);
  });
});

describe('ensureRegistryFresh — on-disk index', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeIndexStore(initial: RegistryIndex | null): {
    store: ServerDeps['indexStore'];
    saved: RegistryIndex[];
  } {
    let current = initial;
    const saved: RegistryIndex[] = [];
    const store = {
      load: vi.fn(async () => current),
      save: vi.fn(async (index: RegistryIndex) => {
        current = index;
        saved.push(index);
      }),
      invalidate: vi.fn(async () => {
        current = null;
      }),
      getPath: () => '/fake/registry-index.json',
    } as unknown as ServerDeps['indexStore'];
    return { store, saved };
  }

  it('hydrates the registry from a valid index without scanning', async () => {
    // Two nonexistent folders both fingerprint to the empty-set hash, so a
    // matching fingerprint is deterministic without touching real files.
    const folders = ['/no-such-folder'];
    const fingerprint = await computeFingerprint(folders);
    const index: RegistryIndex = {
      version: INDEX_VERSION,
      fingerprint,
      skills: {
        'cached-skill': {
          sourcePath: '/no-such-folder/cached-skill.md',
          folder: '/no-such-folder',
          format: 'claude',
          mtimeMs: 1,
          description: 'from index',
          tags: ['x'],
        },
      },
    };
    const { store } = makeIndexStore(index);
    const deps = makeDeps({ folders, indexStore: store, indexEnabled: true });
    const scanSpy = vi.spyOn(deps.scanner, 'scan');

    await ensureRegistryFresh(deps);

    expect(scanSpy).not.toHaveBeenCalled();
    const hydrated = deps.registry.get('cached-skill');
    expect(hydrated?.description).toBe('from index');
    expect(hydrated?.format).toBe('claude');
  });

  it('rebuilds + persists when the index fingerprint no longer matches', async () => {
    const folders = ['/no-such-folder'];
    const staleIndex: RegistryIndex = {
      version: INDEX_VERSION,
      fingerprint: 'stale-does-not-match',
      skills: {},
    };
    const { store, saved } = makeIndexStore(staleIndex);
    const deps = makeDeps({ folders, indexStore: store, indexEnabled: true });
    const scanSpy = vi.spyOn(deps.scanner, 'scan');

    await ensureRegistryFresh(deps);

    expect(scanSpy).toHaveBeenCalled();
    expect(saved.length).toBe(1);
  });

  it('rebuilds when no index exists, then persists a fresh one', async () => {
    const folders = ['/no-such-folder'];
    const { store, saved } = makeIndexStore(null);
    const deps = makeDeps({ folders, indexStore: store, indexEnabled: true });

    await ensureRegistryFresh(deps);

    expect(saved.length).toBe(1);
    expect(saved[0]!.version).toBe(INDEX_VERSION);
  });

  it('skips the index entirely when indexEnabled is false', async () => {
    const folders = ['/no-such-folder'];
    const { store } = makeIndexStore(null);
    const deps = makeDeps({ folders, indexStore: store, indexEnabled: false });

    await ensureRegistryFresh(deps);

    expect(store.load).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
});
