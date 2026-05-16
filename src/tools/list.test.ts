import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { handleList } from './list.js';
import { SkillRegistry } from '../core/skill-registry.js';
import { SkillResolver } from '../core/skill-resolver.js';
import { SkillMetadataCache } from '../core/skill-metadata-cache.js';
import { SkillContentCache } from '../core/skill-content-cache.js';
import { StrategyFactory } from '../factory/strategy-factory.js';
import { PromptStrategy } from '../handlers/prompt-strategy.js';
import { SandboxRunner } from '../security/sandbox-runner.js';
import { DecoratorChain, stderrLogger } from '../decorators/index.js';
import { defaultConfig } from '../config/config-schema.js';
import type { ServerDeps } from '../server-deps.js';
import type { SkillMetadata } from '../core/types.js';
import type { ConfigStore } from '../config/index.js';
import type { PersistedConfig } from '../config/index.js';
import type { FolderEntry } from '../config/config-schema.js';

function makeMetadata(overrides: Partial<SkillMetadata> & { name: string }): SkillMetadata {
  return {
    sourcePath: `/skills/${overrides.name}.md`,
    folder: '/skills',
    format: 'claude',
    allowScripts: false,
    allowNetwork: false,
    ...overrides,
  };
}

/** Build a minimal in-memory ConfigStore seeded with the given folder entries. */
function makeFakeStore(folders: FolderEntry[] = []): ConfigStore {
  const config: PersistedConfig = { ...defaultConfig(), folders };
  return {
    load: async () => ({ ...config, folders: [...config.folders] }),
    save: async () => {},
    getFilePath: () => '/fake/config.json',
  } as unknown as ConfigStore;
}

function makeDeps(skills: SkillMetadata[], storeFolders: FolderEntry[] = []): ServerDeps {
  const registry = new SkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
  return {
    folders: ['/skills'],
    configStore: makeFakeStore(storeFolders),
    registry,
    resolver: new SkillResolver(),
    metadataCache: {
      isValid: () => true, // pre-populated, no scan needed
      markFresh: vi.fn(),
      invalidate: vi.fn(),
      expiresAt: () => null,
      ttlMs: 300_000,
    } as unknown as SkillMetadataCache,
    contentCache: new SkillContentCache({ ttlMs: 300_000 }),
    scanner: { scan: vi.fn() } as unknown as import('../parser/file-scanner.js').FileScanner,
    parser: { parseFile: vi.fn() } as unknown as import('../parser/frontmatter-parser.js').FrontmatterParser,
    factory: new StrategyFactory([new PromptStrategy()]),
    logger: stderrLogger,
    sandboxRunner: new SandboxRunner({}),
    decoratorChain: new DecoratorChain({ logger: stderrLogger, defaultTimeoutMs: 5_000, cacheTtlMs: 60_000, cacheMaxEntries: 10 }),
  } as unknown as ServerDeps;
}

describe('handleList', () => {
  const skills = [
    makeMetadata({ name: 'apple-hig-check', description: 'Check Apple HIG compliance', format: 'claude', folder: '/skills/a' }),
    makeMetadata({ name: 'refactor-suggester', description: 'Suggest refactors', format: 'codex', folder: '/skills/b' }),
    makeMetadata({ name: 'commit-msg', description: 'Generate commit messages', format: 'claude', folder: '/skills/a' }),
  ];

  it('returns all skills when no filters applied', async () => {
    const deps = makeDeps(skills);
    const result = await handleList(deps, {});
    expect(result.skills).toHaveLength(3);
  });

  it('filters by exact folder', async () => {
    const deps = makeDeps(skills);
    const result = await handleList(deps, { folder: '/skills/a' });
    expect(result.skills.map((s) => s.name)).toEqual(expect.arrayContaining(['apple-hig-check', 'commit-msg']));
    expect(result.skills).toHaveLength(2);
  });

  it('filters by source (format)', async () => {
    const deps = makeDeps(skills);
    const result = await handleList(deps, { source: 'codex' });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.name).toBe('refactor-suggester');
  });

  it('filters by search (case-insensitive substring on name + description)', async () => {
    const deps = makeDeps(skills);
    const result = await handleList(deps, { search: 'apple' });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.name).toBe('apple-hig-check');
  });

  it('search matches against description', async () => {
    const deps = makeDeps(skills);
    const result = await handleList(deps, { search: 'refactor' });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.name).toBe('refactor-suggester');
  });

  it('combines folder + source filters', async () => {
    const deps = makeDeps(skills);
    const result = await handleList(deps, { folder: '/skills/a', source: 'claude' });
    expect(result.skills.map((s) => s.name)).toEqual(expect.arrayContaining(['apple-hig-check', 'commit-msg']));
  });

  it('returns SkillSummary shape (no strategy, allowScripts, etc.)', async () => {
    const withExtra = makeMetadata({ name: 'x', strategy: 'prompt', allowScripts: true, timeoutMs: 5000 });
    const deps = makeDeps([withExtra]);
    const result = await handleList(deps, {});
    const summary = result.skills[0]!;
    expect('strategy' in summary).toBe(false);
    expect('allowScripts' in summary).toBe(false);
    expect('timeoutMs' in summary).toBe(false);
    expect(summary.name).toBe('x');
  });

  it('returns empty array when no skills match', async () => {
    const deps = makeDeps(skills);
    const result = await handleList(deps, { search: 'zzz-no-match' });
    expect(result.skills).toHaveLength(0);
  });
});

describe('handleList — folderTag filter', () => {
  const folderA = resolve('/skills/a');
  const folderB = resolve('/skills/b');

  const taggedSkills = [
    makeMetadata({ name: 'skill-a1', folder: folderA }),
    makeMetadata({ name: 'skill-a2', folder: folderA }),
    makeMetadata({ name: 'skill-b1', folder: folderB }),
  ];

  const storeFolders: FolderEntry[] = [
    { path: folderA, priority: 100, enabled: true, tags: ['work'] },
    { path: folderB, priority: 100, enabled: true, tags: ['review'] },
  ];

  it('returns only skills from folders tagged with the given tag', async () => {
    const deps = makeDeps(taggedSkills, storeFolders);
    const result = await handleList(deps, { folderTag: 'work' });
    expect(result.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(['skill-a1', 'skill-a2']),
    );
    expect(result.skills).toHaveLength(2);
  });

  it('returns empty array when no folder has the requested tag', async () => {
    const deps = makeDeps(taggedSkills, storeFolders);
    const result = await handleList(deps, { folderTag: 'no-such-tag' });
    expect(result.skills).toHaveLength(0);
  });

  it('combines folderTag with source filter', async () => {
    const mixed = [
      makeMetadata({ name: 'claude-a', folder: folderA, format: 'claude' }),
      makeMetadata({ name: 'codex-a', folder: folderA, format: 'codex' }),
      makeMetadata({ name: 'claude-b', folder: folderB, format: 'claude' }),
    ];
    const deps = makeDeps(mixed, storeFolders);
    const result = await handleList(deps, { folderTag: 'work', source: 'codex' });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.name).toBe('codex-a');
  });

  it('combines folderTag with folder filter', async () => {
    const deps = makeDeps(taggedSkills, storeFolders);
    // folderTag matches folderA; folder filter also folderA → both agree
    const result = await handleList(deps, { folderTag: 'work', folder: folderA });
    expect(result.skills).toHaveLength(2);
    // folderTag matches folderA; folder filter is folderB → intersection empty
    const resultEmpty = await handleList(deps, { folderTag: 'work', folder: folderB });
    expect(resultEmpty.skills).toHaveLength(0);
  });

  it('returns all skills when folderTag is not set (no regression)', async () => {
    const deps = makeDeps(taggedSkills, storeFolders);
    const result = await handleList(deps, {});
    expect(result.skills).toHaveLength(3);
  });
});
