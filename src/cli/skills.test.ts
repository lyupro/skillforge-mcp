import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main } from './skills.js';
import type { SkillsDeps } from './skills.js';
import type { ServerDeps } from '../server-deps.js';
import type { SkillSummary, SkillContent } from '../core/types.js';

/**
 * Tests inject a fake ServerDeps via the `buildDeps` override in `SkillsDeps`.
 * This avoids touching the real `~/.lyupro/.skillforge/config.json` or the
 * filesystem. The fake registry / configStore stubs match only the surface
 * that skills-handlers.ts calls.
 */

function makeSkillSummary(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: 'code-review',
    description: 'Review code for quality issues',
    sourcePath: '/skills/code-review/SKILL.md',
    folder: '/skills',
    tags: ['review'],
    format: 'claude',
    ...overrides,
  };
}

function makeSkillContent(overrides: Partial<SkillContent> = {}): SkillContent {
  return {
    name: 'code-review',
    description: 'Review code for quality issues',
    sourcePath: '/skills/code-review/SKILL.md',
    folder: '/skills',
    tags: ['review'],
    format: 'claude',
    body: 'You are a code reviewer.',
    raw: '---\nname: code-review\n---\nYou are a code reviewer.',
    ...overrides,
  };
}

function makeFakeDeps(
  skills: SkillSummary[] = [makeSkillSummary()],
  content: SkillContent = makeSkillContent(),
  folders: Array<{ path: string; alias?: string; priority: number; enabled: boolean; tags: string[] }> = [
    { path: '/skills', alias: 'work', priority: 100, enabled: true, tags: [] },
  ],
): () => Promise<ServerDeps> {
  const deps = {
    folders: folders.map((f) => f.path),
    configStore: {
      load: async () => ({ folders, blacklist: [], watcher: { debounceMs: 500 }, security: { allowScripts: false }, invocation: { defaultTimeoutMs: 30000, cacheTtlMs: 60000, cacheMaxEntries: 100 } }),
      save: async () => undefined,
    },
    registry: {
      getAll: () => skills as SkillSummary[],
      has: (name: string) => skills.some((s) => s.name === name),
      get: (name: string) => skills.find((s) => s.name === name),
      clear: () => undefined,
      register: () => undefined,
    },
    contentCache: {
      get: (name: string) => (name === content.name ? content : undefined),
      set: () => undefined,
      clear: () => undefined,
      invalidate: () => undefined,
    },
    metadataCache: {
      isValid: () => true,
      markFresh: () => undefined,
      invalidate: () => undefined,
    },
    indexStore: {
      load: async () => null,
      save: async () => undefined,
      invalidate: async () => undefined,
      getPath: () => '/fake/registry-index.json',
    },
    indexEnabled: false,
    parser: {
      parseFile: async () => content,
    },
    scanner: { scan: async () => [] },
    blacklistFilter: {
      evaluate: () => ({ allowed: true }),
      setManualBlacklist: () => undefined,
    },
    resolver: { resolve: (group: SkillSummary[]) => group[0]! },
    folderWatcher: { setFolders: async () => undefined },
    configWatcher: {},
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    sandboxRunner: {},
    decoratorChain: {},
    factory: {},
  } as unknown as ServerDeps;
  return async () => deps;
}

describe('skills.main — unknown / missing action', () => {
  it('no action prints USAGE to stderr and returns 2', async () => {
    let err = '';
    const code = await main([], { stderr: (t) => (err += t) });
    expect(code).toBe(2);
    expect(err).toContain('skillforge skills');
    expect(err).toContain('list');
    expect(err).toContain('get');
    expect(err).toContain('reload');
  });

  it('unknown action prints error + USAGE and returns 2', async () => {
    let err = '';
    const code = await main(['wobble'], { stderr: (t) => (err += t) });
    expect(code).toBe(2);
    expect(err).toContain('unknown action: wobble');
  });
});

describe('skills.main list — table output', () => {
  it('shows column headers and skill name', async () => {
    let out = '';
    const code = await main(['list'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(0);
    expect(out).toContain('NAME');
    expect(out).toContain('SOURCE');
    expect(out).toContain('FOLDER');
    expect(out).toContain('DESCRIPTION');
    expect(out).toContain('code-review');
  });

  it('FOLDER column shows alias by default', async () => {
    let out = '';
    await main(['list'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps(),
    });
    expect(out).toContain('work');
    expect(out).not.toContain('/skills  ');
  });

  it('--folder-fmt path shows path instead of alias', async () => {
    let out = '';
    await main(['list', '--folder-fmt', 'path'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps(),
    });
    expect(out).toContain('/skills');
  });

  it('--json emits raw JSON with skills array', async () => {
    let out = '';
    const code = await main(['list', '--json'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { skills: SkillSummary[] };
    expect(Array.isArray(parsed.skills)).toBe(true);
    expect(parsed.skills[0]!.name).toBe('code-review');
  });

  it('unknown flag returns exit 2', async () => {
    let err = '';
    const code = await main(['list', '--bogus'], {
      stderr: (t) => (err += t),
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(2);
    expect(err).toContain('invalid or unknown flag');
  });

  it('no skills found emits empty message', async () => {
    let out = '';
    const code = await main(['list'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps([]),
    });
    expect(code).toBe(0);
    expect(out).toContain('No skills found');
  });

  it('--folder alias resolves to path before filtering', async () => {
    let out = '';
    const code = await main(['list', '--folder', 'work'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(0);
  });
});

describe('skills.main get', () => {
  it('prints human-readable skill content', async () => {
    let out = '';
    const code = await main(['get', 'code-review'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(0);
    expect(out).toContain('name:');
    expect(out).toContain('code-review');
    expect(out).toContain('--- body ---');
    expect(out).toContain('You are a code reviewer');
  });

  it('--json emits raw JSON SkillContent', async () => {
    let out = '';
    const code = await main(['get', 'code-review', '--json'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as SkillContent;
    expect(parsed.name).toBe('code-review');
    expect(typeof parsed.body).toBe('string');
  });

  it('missing <name> returns exit 2', async () => {
    let err = '';
    const code = await main(['get'], {
      stderr: (t) => (err += t),
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(2);
    expect(err).toContain('missing <name>');
  });

  it('unknown flag returns exit 2', async () => {
    let err = '';
    const code = await main(['get', 'code-review', '--bogus'], {
      stderr: (t) => (err += t),
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(2);
    expect(err).toContain('unknown flag');
  });

  it('skill not found returns exit 1', async () => {
    let err = '';
    const code = await main(['get', 'no-such-skill'], {
      stderr: (t) => (err += t),
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(1);
    expect(err).toContain('Skill not found');
  });
});

describe('skills.main reload', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'sf-skills-reload-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('prints reload summary with folder + skill counts', async () => {
    let out = '';
    const code = await main(['reload'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(0);
    expect(out).toContain('Reload complete');
    expect(out).toContain('folders:');
    expect(out).toContain('skills:');
    expect(out).toContain('errors:');
  });

  it('unknown flag returns exit 2', async () => {
    let err = '';
    const code = await main(['reload', '--bogus'], {
      stderr: (t) => (err += t),
      buildDeps: makeFakeDeps(),
    });
    expect(code).toBe(2);
    expect(err).toContain('unknown flag');
  });
});

/** Build a fake deps whose registry / content lookups are keyed by name —
 *  needed to exercise batch `get` across several distinct skills. */
function makeMultiDeps(names: string[]): () => Promise<ServerDeps> {
  const byName = new Map(
    names.map((n) => [n, makeSkillContent({ name: n, sourcePath: `/skills/${n}.md` })]),
  );
  return async () =>
    ({
      folders: ['/skills'],
      configStore: { load: async () => ({ folders: [] }), save: async () => undefined },
      registry: {
        getAll: () => [...byName.values()],
        has: (name: string) => byName.has(name),
        get: (name: string) => byName.get(name),
        clear: () => undefined,
        register: () => undefined,
      },
      contentCache: {
        get: (name: string) => byName.get(name),
        set: () => undefined,
        clear: () => undefined,
        invalidate: () => undefined,
      },
      metadataCache: { isValid: () => true, markFresh: () => undefined, invalidate: () => undefined },
      indexStore: {
        load: async () => null,
        save: async () => undefined,
        invalidate: async () => undefined,
        getPath: () => '/fake/registry-index.json',
      },
      indexEnabled: false,
      parser: { parseFile: async () => makeSkillContent() },
      scanner: { scan: async () => [] },
      blacklistFilter: { evaluate: () => ({ allowed: true }), setManualBlacklist: () => undefined },
      resolver: { resolve: (group: SkillContent[]) => group[0]! },
      folderWatcher: { setFolders: async () => undefined },
      configWatcher: {},
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      sandboxRunner: {},
      decoratorChain: {},
      factory: {},
    }) as unknown as ServerDeps;
}

describe('skills.main get — batch', () => {
  it('comma-separated names emit a { skills, errors } JSON array', async () => {
    let out = '';
    const code = await main(['get', 'code-review,api-design', '--json'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeMultiDeps(['code-review', 'api-design']),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { skills: SkillContent[]; errors: unknown[] };
    expect(Array.isArray(parsed.skills)).toBe(true);
    expect(parsed.skills.map((s) => s.name).sort()).toEqual(['api-design', 'code-review']);
    expect(parsed.errors).toEqual([]);
  });

  it('a single name still emits the object form (backward compat)', async () => {
    let out = '';
    const code = await main(['get', 'code-review', '--json'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeMultiDeps(['code-review']),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['name']).toBe('code-review');
    expect(parsed['skills']).toBeUndefined();
  });

  it('partial failure — missing skill lands in errors, exit 1', async () => {
    let out = '';
    const code = await main(['get', 'code-review,no-such', '--json'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeMultiDeps(['code-review']),
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(out) as {
      skills: SkillContent[];
      errors: Array<{ name: string }>;
    };
    expect(parsed.skills.map((s) => s.name)).toEqual(['code-review']);
    expect(parsed.errors.map((e) => e.name)).toEqual(['no-such']);
  });

  it('batch human-readable output prints each skill body', async () => {
    let out = '';
    const code = await main(['get', 'code-review,api-design'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeMultiDeps(['code-review', 'api-design']),
    });
    expect(code).toBe(0);
    expect(out).toContain('name:        code-review');
    expect(out).toContain('name:        api-design');
  });
});

describe('skills.main reindex', () => {
  it('prints a reindex summary with index path and build time', async () => {
    let out = '';
    const code = await main(['reindex'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: makeMultiDeps(['code-review']),
    });
    expect(code).toBe(0);
    expect(out).toContain('Reindex complete');
    expect(out).toContain('indexPath:');
    expect(out).toContain('buildTime:');
  });

  it('unknown flag returns exit 2', async () => {
    let err = '';
    const code = await main(['reindex', '--bogus'], {
      stderr: (t) => (err += t),
      buildDeps: makeMultiDeps(['code-review']),
    });
    expect(code).toBe(2);
    expect(err).toContain('unknown flag');
  });
});

describe('skills.main — --no-cache flag', () => {
  it('is accepted and stripped from action args', async () => {
    let out = '';
    let disableCache = false;
    const code = await main(['get', 'code-review', '--no-cache'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: async (opts) => {
        disableCache = opts?.disableCache === true;
        return makeMultiDeps(['code-review'])();
      },
    });
    expect(code).toBe(0);
    expect(disableCache).toBe(true);
    expect(out).toContain('code-review');
  });
});

describe('skills.main — buildDeps failure', () => {
  it('returns exit 1 when deps factory throws', async () => {
    let err = '';
    const code = await main(['list'], {
      stderr: (t) => (err += t),
      buildDeps: async () => { throw new Error('config not found'); },
    });
    expect(code).toBe(1);
    expect(err).toContain('config not found');
  });
});

describe('skills-format — alias map behaviour', () => {
  it('falls back to path when no alias is set', async () => {
    let out = '';
    const noAliasDeps = makeFakeDeps(
      [makeSkillSummary({ folder: '/other' })],
      makeSkillContent({ folder: '/other' }),
      [{ path: '/other', priority: 100, enabled: true, tags: [] }],
    );
    await main(['list'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: noAliasDeps,
    });
    expect(out).toContain('/other');
  });

  it('FOLDER column shows alias when config path is un-resolved but skill.folder is resolved', async () => {
    // Simulate the real bug: config stores a relative path segment that differs
    // from the resolved form.  loadResolvedConfig always resolves paths before
    // placing them in deps.folders, so skill.folder == resolve(rawPath).
    // buildFolderAliasMap must key by resolve(f.path) so the lookup still hits.
    const rawPath = './my-skills-dir';
    const resolvedPath = resolve(rawPath);
    const mismatchDeps = makeFakeDeps(
      [makeSkillSummary({ folder: resolvedPath })],
      makeSkillContent({ folder: resolvedPath }),
      [{ path: rawPath, alias: 'my-alias', priority: 100, enabled: true, tags: [] }],
    );
    let out = '';
    await main(['list'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: mismatchDeps,
    });
    expect(out).toContain('my-alias');
    expect(out).not.toContain(rawPath + '  ');
  });

  it('--folder-fmt path shows the raw config path when config path is un-resolved', async () => {
    const rawPath = './my-skills-dir';
    const resolvedPath = resolve(rawPath);
    const mismatchDeps = makeFakeDeps(
      [makeSkillSummary({ folder: resolvedPath })],
      makeSkillContent({ folder: resolvedPath }),
      [{ path: rawPath, alias: 'my-alias', priority: 100, enabled: true, tags: [] }],
    );
    let out = '';
    await main(['list', '--folder-fmt', 'path'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
      buildDeps: mismatchDeps,
    });
    // With fmt=path the label is f.path (raw), not the alias.
    expect(out).toContain(rawPath);
    expect(out).not.toContain('my-alias');
  });
});
