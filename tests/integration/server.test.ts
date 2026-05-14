/**
 * Integration test — runs the MCP server in-process using
 * InMemoryTransport (no subprocess, no dist build required).
 *
 * Fixture skills are written to a tmpdir so the real FileScanner + FrontmatterParser
 * code paths are exercised end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, buildDeps } from '../../src/server.js';
import { defaultConfig } from '../../src/config/config-schema.js';
import type { ConfigStore } from '../../src/config/index.js';
import type { PersistedConfig } from '../../src/config/index.js';
import type { FolderWatcher } from '../../src/watcher/index.js';

// ---------------------------------------------------------------------------
// Fixture skill markdown files
// ---------------------------------------------------------------------------

const FIXTURES: Record<string, string> = {
  'apple-hig-check.md': `---
name: apple-hig-check
description: Check Apple HIG compliance
format: claude
---
Review the UI against Apple Human Interface Guidelines.
`,
  'refactor-suggester.md': `---
name: refactor-suggester
description: Suggest refactors for TypeScript code
format: codex
---
Analyze the code and suggest targeted refactoring improvements.
`,
  'commit-msg.md': `---
name: commit-msg
description: Generate a conventional commit message
format: claude
---
Given the diff, generate a concise conventional commit message.
`,
};

// ---------------------------------------------------------------------------
// Setup: write fixtures, wire server + client via InMemoryTransport
// ---------------------------------------------------------------------------

let fixtureDir: string;
let client: Client;
let serverTransport: InMemoryTransport;
let clientTransport: InMemoryTransport;

beforeAll(async () => {
  // Write fixture files to a temp directory.
  fixtureDir = await mkdtemp(join(tmpdir(), 'skillforge-test-'));
  await Promise.all(
    Object.entries(FIXTURES).map(([name, content]) =>
      writeFile(join(fixtureDir, name), content, 'utf-8'),
    ),
  );

  // Build deps pointing at the fixture dir.
  const deps = await buildDeps();
  deps.folders = [fixtureDir];
  // Replace configStore with an in-memory fake so configure tests never touch the real config file.
  let fakeConfig: PersistedConfig = defaultConfig();
  deps.configStore = {
    load: async () => ({ ...fakeConfig }),
    save: async (c: PersistedConfig) => { fakeConfig = { ...c }; },
    getFilePath: () => '/fake/integration-test/config.json',
  } as unknown as ConfigStore;
  // Replace folderWatcher with a no-op fake — integration tests must not spin up real chokidar.
  deps.folderWatcher = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setFolders: vi.fn(async () => {}),
    isRunning: () => false,
    getFolders: () => [],
  } as unknown as FolderWatcher;
  // Invalidate the default metadata cache so the first tool call triggers a scan.
  deps.metadataCache.invalidate();

  const server = buildServer(deps);

  // Linked pair: client writes to serverTransport, server writes to clientTransport.
  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Connect server then client.
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await rm(fixtureDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP server — tool surface', () => {
  it('listTools() returns the three registered tool names', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('skills__list');
    expect(names).toContain('skills__get');
    expect(names).toContain('skills__invoke');
  });
});

describe('skills__list', () => {
  it('returns all three fixture skills', async () => {
    const result = await client.callTool({ name: 'skills__list', arguments: {} });
    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { skills: Array<{ name: string }> };
    expect(parsed.skills).toHaveLength(3);
    const names = parsed.skills.map((s) => s.name);
    expect(names).toContain('apple-hig-check');
    expect(names).toContain('refactor-suggester');
    expect(names).toContain('commit-msg');
  });

  it('filters by search term (name substring match)', async () => {
    const result = await client.callTool({
      name: 'skills__list',
      arguments: { search: 'refactor' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { skills: Array<{ name: string }> };
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.skills[0]?.name).toBe('refactor-suggester');
  });

  it('filters by source=custom (all fixture files lack SKILL.md/AGENTS.md name)', async () => {
    // FormatDetector assigns 'custom' to any file not named SKILL.md or AGENTS.md
    // and without a persona frontmatter field — all three fixtures qualify.
    const result = await client.callTool({ name: 'skills__list', arguments: { source: 'custom' } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { skills: Array<{ name: string }> };
    expect(parsed.skills).toHaveLength(3);
  });
});

describe('skills__get', () => {
  it('returns skill content for a known skill', async () => {
    const result = await client.callTool({
      name: 'skills__get',
      arguments: { name: 'commit-msg' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { name: string; body: string };
    expect(parsed.name).toBe('commit-msg');
    expect(parsed.body).toContain('conventional commit');
  });

  it('returns isError for unknown skill', async () => {
    const result = await client.callTool({
      name: 'skills__get',
      arguments: { name: 'does-not-exist' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect(text).toContain('Skill not found');
  });
});

describe('skills__invoke', () => {
  it('returns formatted prompt output for a known skill', async () => {
    const result = await client.callTool({
      name: 'skills__invoke',
      arguments: { name: 'apple-hig-check', input: 'Review my login screen.' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { ok: boolean; output: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.output).toContain('apple-hig-check');
    expect(parsed.output).toContain('Review my login screen.');
  });
});

describe('skills__reload', () => {
  it('listTools() includes skills__reload', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('skills__reload');
  });

  it('no folders configured → returns loaded=0, added=[], removed=[], errors=[]', async () => {
    // Build a separate server with no folders, no real filesystem access.
    const deps = await buildDeps();
    deps.folders = [];
    let isolatedConfig: PersistedConfig = defaultConfig();
    deps.configStore = {
      load: async () => ({ ...isolatedConfig }),
      save: async (c: PersistedConfig) => { isolatedConfig = { ...c }; },
      getFilePath: () => '/fake/reload-test/config.json',
    } as unknown as ConfigStore;
    deps.folderWatcher = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      setFolders: vi.fn(async () => {}),
      isRunning: () => false,
      getFolders: () => [],
    } as unknown as FolderWatcher;
    deps.metadataCache.invalidate();

    const isolatedServer = buildServer(deps);
    const [iClientTransport, iServerTransport] = InMemoryTransport.createLinkedPair();
    await isolatedServer.connect(iServerTransport);
    const iClient = new Client({ name: 'reload-test-client', version: '0.0.0' });
    await iClient.connect(iClientTransport);

    const result = await iClient.callTool({ name: 'skills__reload', arguments: {} });
    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { loaded: number; added: string[]; removed: string[]; errors: unknown[] };
    expect(parsed.loaded).toBe(0);
    expect(parsed.added).toEqual([]);
    expect(parsed.removed).toEqual([]);
    expect(parsed.errors).toEqual([]);

    await iClient.close();
  });
});

describe('skills__configure', () => {
  it('listTools() includes skills__configure', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('skills__configure');
  });

  it('get_blacklist returns empty blacklist for fixture setup', async () => {
    const result = await client.callTool({
      name: 'skills__configure',
      arguments: { action: 'get_blacklist' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { folders: string[]; blacklist: string[]; totalSkills: number };
    expect(parsed.blacklist).toEqual([]);
    expect(Array.isArray(parsed.folders)).toBe(true);
    expect(typeof parsed.totalSkills).toBe('number');
  });

  it('set_blacklist stores and returns the supplied blacklist', async () => {
    const result = await client.callTool({
      name: 'skills__configure',
      arguments: { action: 'set_blacklist', blacklist: ['ignored-name'] },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { blacklist: string[] };
    expect(parsed.blacklist).toEqual(['ignored-name']);
  });
});

describe('skills__invoke — composite integration', () => {
  let compositeDir: string;
  let compositeClient: Client;

  beforeAll(async () => {
    compositeDir = await mkdtemp(join(tmpdir(), 'skillforge-composite-'));

    await writeFile(
      join(compositeDir, 'child-a.md'),
      '---\nname: child-a\nformat: claude\n---\nChild A content.',
      'utf-8',
    );
    await writeFile(
      join(compositeDir, 'child-b.md'),
      '---\nname: child-b\nformat: claude\n---\nChild B content.',
      'utf-8',
    );
    await writeFile(
      join(compositeDir, 'parent-comp.md'),
      '---\nname: parent-comp\nformat: claude\nskills:\n  - child-a\n  - child-b\n---\nParent intro.',
      'utf-8',
    );
    await writeFile(
      join(compositeDir, 'self-ref.md'),
      '---\nname: self-ref\nformat: claude\nskills:\n  - self-ref\n---\nSelf referencing.',
      'utf-8',
    );

    const deps = await buildDeps();
    deps.folders = [compositeDir];
    let compositeConfig: PersistedConfig = defaultConfig();
    deps.configStore = {
      load: async () => ({ ...compositeConfig }),
      save: async (c: PersistedConfig) => { compositeConfig = { ...c }; },
      getFilePath: () => '/fake/composite-test/config.json',
    } as unknown as ConfigStore;
    deps.folderWatcher = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      setFolders: vi.fn(async () => {}),
      isRunning: () => false,
      getFolders: () => [],
    } as unknown as FolderWatcher;
    deps.metadataCache.invalidate();

    const compositeServer = buildServer(deps);
    const [cClientTransport, cServerTransport] = InMemoryTransport.createLinkedPair();
    await compositeServer.connect(cServerTransport);
    compositeClient = new Client({ name: 'composite-test-client', version: '0.0.0' });
    await compositeClient.connect(cClientTransport);
  });

  afterAll(async () => {
    await compositeClient.close();
    await rm(compositeDir, { recursive: true, force: true });
  });

  it('invokes composite parent and returns combined child output', async () => {
    const result = await compositeClient.callTool({
      name: 'skills__invoke',
      arguments: { name: 'parent-comp', input: 'test input' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { ok: boolean; output: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.output).toContain('child-a');
    expect(parsed.output).toContain('child-b');
    expect(parsed.output).toContain('Parent intro');
  });

  it('returns ok:false with cycle error for self-referencing skill', async () => {
    const result = await compositeClient.callTool({
      name: 'skills__invoke',
      arguments: { name: 'self-ref', input: '' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/cycle/i);
  });
});

describe('skills__invoke — real-frontmatter promotion', () => {
  let scriptDir: string;
  let scriptClient: Client;

  beforeAll(async () => {
    scriptDir = await mkdtemp(join(tmpdir(), 'skillforge-scriptpromo-'));

    // Script skill — scripts: + allowScripts: declared via real YAML.
    // We rely on the gate-1 failure ("scripts disabled globally") to prove
    // ScriptStrategy was selected by canHandle(). If parser had not promoted
    // `scripts`, the universal PromptStrategy fallback would have answered
    // instead and the body text would have surfaced in `output`.
    await writeFile(
      join(scriptDir, 'script-promo.md'),
      [
        '---',
        'name: script-promo',
        'format: claude',
        'allowScripts: true',
        'scripts:',
        '  - main.py',
        '---',
        'This is a prompt body that must NOT appear when ScriptStrategy claims the skill.',
      ].join('\n'),
      'utf-8',
    );

    // Cacheable prompt skill — verifies cacheable promotion reaches CacheDecorator.
    // We invoke twice with identical input; if cacheable promoted, the second call
    // returns the cached InvocationResult instance unchanged.
    await writeFile(
      join(scriptDir, 'cached-prompt.md'),
      [
        '---',
        'name: cached-prompt',
        'format: claude',
        'cacheable: true',
        'cacheTtlMs: 60000',
        '---',
        'Cacheable prompt body.',
      ].join('\n'),
      'utf-8',
    );

    const deps = await buildDeps();
    deps.folders = [scriptDir];
    let scriptConfig: PersistedConfig = defaultConfig();
    deps.configStore = {
      load: async () => ({ ...scriptConfig }),
      save: async (c: PersistedConfig) => { scriptConfig = { ...c }; },
      getFilePath: () => '/fake/script-promo-test/config.json',
    } as unknown as ConfigStore;
    deps.folderWatcher = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      setFolders: vi.fn(async () => {}),
      isRunning: () => false,
      getFolders: () => [],
    } as unknown as FolderWatcher;
    deps.metadataCache.invalidate();

    const scriptServer = buildServer(deps);
    const [sClientTransport, sServerTransport] = InMemoryTransport.createLinkedPair();
    await scriptServer.connect(sServerTransport);
    scriptClient = new Client({ name: 'script-promo-test-client', version: '0.0.0' });
    await scriptClient.connect(sClientTransport);
  });

  afterAll(async () => {
    await scriptClient.close();
    await rm(scriptDir, { recursive: true, force: true });
  });

  it('ScriptStrategy claims skill when frontmatter declares scripts: [main.py]', async () => {
    const result = await scriptClient.callTool({
      name: 'skills__invoke',
      arguments: { name: 'script-promo', input: 'whatever' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { ok: boolean; error?: string; output: string };
    // Global gate stops execution — but reaching it proves ScriptStrategy was picked.
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('scripts disabled globally');
    expect(parsed.output).not.toContain('prompt body that must NOT appear');
  });

  it('CacheDecorator activates when frontmatter declares cacheable: true', async () => {
    const r1 = await scriptClient.callTool({
      name: 'skills__invoke',
      arguments: { name: 'cached-prompt', input: 'same-input' },
    });
    const r2 = await scriptClient.callTool({
      name: 'skills__invoke',
      arguments: { name: 'cached-prompt', input: 'same-input' },
    });
    const text1 = (r1.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const text2 = (r2.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const p1 = JSON.parse(text1) as { ok: boolean; output: string; durationMs: number };
    const p2 = JSON.parse(text2) as { ok: boolean; output: string; durationMs: number };
    expect(p1.ok).toBe(true);
    expect(p2.ok).toBe(true);
    // Cached InvocationResult is returned literally — output text identical and
    // durationMs identical (frozen at first-invocation measurement).
    expect(p2.output).toBe(p1.output);
    expect(p2.durationMs).toBe(p1.durationMs);
  });
});
