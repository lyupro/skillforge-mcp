import { describe, it, expect, vi } from 'vitest';
import { handleInvoke } from './invoke.js';
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

function makeDeps(content: SkillContent): ServerDeps {
  const registry = new SkillRegistry();
  const meta: SkillMetadata = {
    name: content.name,
    sourcePath: content.sourcePath,
    folder: content.folder,
    format: content.format,
    allowScripts: false,
    allowNetwork: false,
  };
  registry.register(meta);
  const contentCache = new SkillContentCache({ ttlMs: 300_000 });
  contentCache.set(content.name, content);

  const logger = stderrLogger;
  const sandboxRunner = new SandboxRunner({ logger });
  const decoratorChain = new DecoratorChain({
    logger,
    defaultTimeoutMs: 5_000,
    cacheTtlMs: 60_000,
    cacheMaxEntries: 10,
  });

  return {
    folders: ['/skills'],
    registry,
    resolver: new SkillResolver(),
    metadataCache: {
      isValid: () => true,
      markFresh: vi.fn(),
      invalidate: vi.fn(),
      expiresAt: () => null,
      ttlMs: 300_000,
    } as unknown as SkillMetadataCache,
    contentCache,
    scanner: { scan: vi.fn() } as unknown as import('../parser/file-scanner.js').FileScanner,
    parser: { parseFile: vi.fn() } as unknown as import('../parser/frontmatter-parser.js').FrontmatterParser,
    factory: new StrategyFactory([new PromptStrategy()]),
    logger,
    sandboxRunner,
    decoratorChain,
  };
}

describe('handleInvoke', () => {
  it('invokes strategy with correct context and returns InvocationResult', async () => {
    const content = makeContent('commit-msg');
    const deps = makeDeps(content);

    const result = await handleInvoke(deps, { name: 'commit-msg', input: 'feat: add login' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('commit-msg');
    expect(result.output).toContain('feat: add login');
    expect(typeof result.durationMs).toBe('number');
  });

  it('defaults input to empty string when not provided', async () => {
    const content = makeContent('my-skill');
    const deps = makeDeps(content);

    const result = await handleInvoke(deps, { name: 'my-skill' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('## Input');
  });

  it('propagates not-found error from handleGet when skill is missing', async () => {
    const content = makeContent('existing');
    const deps = makeDeps(content);

    await expect(handleInvoke(deps, { name: 'nonexistent' })).rejects.toThrow(
      'Skill not found: nonexistent',
    );
  });
});

// ---------------------------------------------------------------------------
// Composite branch tests
// ---------------------------------------------------------------------------

function makeCompositeDeps(parent: SkillContent, children: SkillContent[]): ServerDeps {
  const registry = new SkillRegistry();
  const allSkills = [parent, ...children];
  const contentCache = new SkillContentCache({ ttlMs: 300_000 });

  for (const skill of allSkills) {
    const meta: SkillMetadata = {
      name: skill.name,
      sourcePath: skill.sourcePath,
      folder: skill.folder,
      format: skill.format,
      allowScripts: false,
      allowNetwork: false,
    };
    registry.register(meta);
    contentCache.set(skill.name, skill);
  }

  const logger = stderrLogger;
  const sandboxRunner = new SandboxRunner({ logger });
  const decoratorChain = new DecoratorChain({
    logger,
    defaultTimeoutMs: 5_000,
    cacheTtlMs: 60_000,
    cacheMaxEntries: 10,
  });

  return {
    folders: ['/skills'],
    registry,
    resolver: new SkillResolver(),
    metadataCache: {
      isValid: () => true,
      markFresh: vi.fn(),
      invalidate: vi.fn(),
      expiresAt: () => null,
      ttlMs: 300_000,
    } as unknown as SkillMetadataCache,
    contentCache,
    scanner: { scan: vi.fn() } as unknown as import('../parser/file-scanner.js').FileScanner,
    parser: { parseFile: vi.fn() } as unknown as import('../parser/frontmatter-parser.js').FrontmatterParser,
    factory: new StrategyFactory([new PromptStrategy()]),
    logger,
    sandboxRunner,
    decoratorChain,
  };
}

describe('handleInvoke — composite branch', () => {
  it('resolves composite skill by invoking children and concatenating output', async () => {
    const child1: SkillContent = {
      ...makeContent('child-one'),
      body: 'Child one body',
    };
    const child2: SkillContent = {
      ...makeContent('child-two'),
      body: 'Child two body',
    };
    const parent: SkillContent = {
      ...makeContent('parent-composite'),
      skills: ['child-one', 'child-two'],
      body: 'Parent preamble',
    };

    const deps = makeCompositeDeps(parent, [child1, child2]);
    const result = await handleInvoke(deps, { name: 'parent-composite', input: 'test' });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('child-one');
    expect(result.output).toContain('child-two');
    expect(result.output).toContain('Parent preamble');
  });

  it('returns ok:false with cycle error message when a cycle is detected', async () => {
    const selfRef: SkillContent = {
      ...makeContent('self'),
      skills: ['self'],
    };

    const deps = makeCompositeDeps(selfRef, []);
    const result = await handleInvoke(deps, { name: 'self', input: '' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cycle/i);
  });
});
