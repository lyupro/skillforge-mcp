import { describe, it, expect, vi } from 'vitest';
import { handleGet } from './get.js';
import { SkillRegistry } from '../core/skill-registry.js';
import { SkillResolver } from '../core/skill-resolver.js';
import { SkillMetadataCache } from '../core/skill-metadata-cache.js';
import { SkillContentCache } from '../core/skill-content-cache.js';
import { StrategyFactory } from '../factory/strategy-factory.js';
import { PromptStrategy } from '../handlers/prompt-strategy.js';
import { SandboxRunner } from '../security/sandbox-runner.js';
import { DecoratorChain, stderrLogger } from '../decorators/index.js';
import type { ServerDeps } from '../server-deps.js';
import type { SkillContent, SkillMetadata } from '../core/types.js';

function makeContent(name: string): SkillContent {
  return {
    name,
    description: `Desc of ${name}`,
    sourcePath: `/skills/${name}.md`,
    folder: '/skills',
    format: 'claude',
    allowScripts: false,
    allowNetwork: false,
    body: `Body of ${name}`,
    raw: `---\nname: ${name}\n---\nBody of ${name}`,
  };
}

function makeDeps(
  registeredSkills: SkillMetadata[],
  cachedContent: SkillContent[] = [],
  parseResults: Map<string, SkillContent> = new Map(),
): ServerDeps {
  const registry = new SkillRegistry();
  for (const skill of registeredSkills) {
    registry.register(skill);
  }
  const contentCache = new SkillContentCache({ ttlMs: 300_000 });
  for (const content of cachedContent) {
    contentCache.set(content.name, content);
  }

  return {
    folders: ['/skills'],
    registry,
    resolver: new SkillResolver(),
    metadataCache: {
      isValid: () => true, // cache fresh so no scan happens
      markFresh: vi.fn(),
      invalidate: vi.fn(),
      expiresAt: () => null,
      ttlMs: 300_000,
    } as unknown as SkillMetadataCache,
    contentCache,
    scanner: { scan: vi.fn() } as unknown as import('../parser/file-scanner.js').FileScanner,
    parser: {
      parseFile: vi.fn(async (filePath: string, folder: string) => {
        if (parseResults.has(filePath)) return parseResults.get(filePath)!;
        throw new Error(`No parse result for ${filePath}`);
      }),
    } as unknown as import('../parser/frontmatter-parser.js').FrontmatterParser,
    factory: new StrategyFactory([new PromptStrategy()]),
    logger: stderrLogger,
    sandboxRunner: new SandboxRunner({}),
    decoratorChain: new DecoratorChain({ logger: stderrLogger, defaultTimeoutMs: 5_000, cacheTtlMs: 60_000, cacheMaxEntries: 10 }),
  };
}

describe('handleGet', () => {
  it('returns content from cache when hit', async () => {
    const content = makeContent('cached-skill');
    const meta: SkillMetadata = { name: 'cached-skill', sourcePath: content.sourcePath, folder: content.folder, format: 'claude', allowScripts: false, allowNetwork: false };
    const deps = makeDeps([meta], [content]);

    const result = await handleGet(deps, { name: 'cached-skill' });
    expect(result.name).toBe('cached-skill');
    expect(deps.parser.parseFile).not.toHaveBeenCalled();
  });

  it('re-parses from disk on cache miss and stores result', async () => {
    const content = makeContent('disk-skill');
    const meta: SkillMetadata = { name: 'disk-skill', sourcePath: content.sourcePath, folder: content.folder, format: 'claude', allowScripts: false, allowNetwork: false };
    const parseResults = new Map([[content.sourcePath, content]]);
    const deps = makeDeps([meta], [], parseResults);

    const result = await handleGet(deps, { name: 'disk-skill' });
    expect(result.name).toBe('disk-skill');
    expect(deps.parser.parseFile).toHaveBeenCalledWith(content.sourcePath, content.folder);
    // Should now be in cache.
    expect(deps.contentCache.get('disk-skill')).toMatchObject({ name: 'disk-skill' });
  });

  it('throws when skill name is not in registry', async () => {
    const deps = makeDeps([], [], new Map());
    await expect(handleGet(deps, { name: 'unknown' })).rejects.toThrow('Skill not found: unknown');
  });
});
