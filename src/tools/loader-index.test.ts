import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, unlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureRegistryFresh } from './loader.js';
import { SkillRegistry } from '../core/skill-registry.js';
import { SkillResolver } from '../core/skill-resolver.js';
import { SkillMetadataCache } from '../core/skill-metadata-cache.js';
import { SkillContentCache } from '../core/skill-content-cache.js';
import { SkillIndexStore } from '../core/skill-index-store.js';
import { StrategyFactory } from '../factory/strategy-factory.js';
import { PromptStrategy } from '../handlers/prompt-strategy.js';
import { BlacklistFilter } from '../security/blacklist-filter.js';
import { SandboxRunner } from '../security/sandbox-runner.js';
import { FrontmatterParser } from '../parser/frontmatter-parser.js';
import { FileScanner } from '../parser/file-scanner.js';
import { DecoratorChain, stderrLogger } from '../decorators/index.js';
import type { ServerDeps } from '../server-deps.js';

/**
 * End-to-end exercise of the persistent on-disk index against a real temp
 * skill folder: build once, hydrate on the second call, invalidate on edit.
 */

function writeSkill(path: string, name: string): Promise<void> {
  return writeFile(path, `---\nname: ${name}\ndescription: ${name} desc\n---\nBody of ${name}\n`, 'utf8');
}

function makeRealDeps(folders: string | string[], indexPath: string): ServerDeps {
  const configuredFolders = typeof folders === 'string' ? [folders] : folders;
  // metadataCache is forced invalid every call so the on-disk index — not the
  // in-process cache — is the path under test.
  const metadataCache = {
    isValid: () => false,
    markFresh: vi.fn(),
    invalidate: vi.fn(),
    expiresAt: () => null,
    ttlMs: 300_000,
  } as unknown as SkillMetadataCache;

  return {
    folders: configuredFolders,
    configStore: {} as ServerDeps['configStore'],
    registry: new SkillRegistry(configuredFolders),
    resolver: new SkillResolver(),
    metadataCache,
    contentCache: new SkillContentCache({ ttlMs: 300_000 }),
    indexStore: new SkillIndexStore(indexPath),
    indexEnabled: true,
    scanner: new FileScanner(),
    parser: new FrontmatterParser(),
    factory: new StrategyFactory([new PromptStrategy()]),
    blacklistFilter: new BlacklistFilter(),
    folderWatcher: {} as ServerDeps['folderWatcher'],
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

describe('ensureRegistryFresh — persistent index end-to-end', () => {
  let dir: string;
  let folder: string;
  let indexPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-loader-idx-'));
    folder = join(dir, 'skills');
    indexPath = join(dir, 'cache', 'registry-index.json');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(folder, { recursive: true });
    await writeSkill(join(folder, 'a.md'), 'skill-a');
    await writeSkill(join(folder, 'b.md'), 'skill-b');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('first call scans + writes the index; second call hydrates without scanning', async () => {
    const deps = makeRealDeps(folder, indexPath);

    const scanSpy = vi.spyOn(deps.scanner, 'scan');
    await ensureRegistryFresh(deps);
    expect(scanSpy).toHaveBeenCalled();
    expect(deps.registry.size).toBe(2);

    // A separate deps object — emulates a fresh CLI process.
    const deps2 = makeRealDeps(folder, indexPath);
    const scanSpy2 = vi.spyOn(deps2.scanner, 'scan');
    const parseSpy2 = vi.spyOn(deps2.parser, 'parseFile');
    await ensureRegistryFresh(deps2);

    expect(scanSpy2).not.toHaveBeenCalled();
    expect(parseSpy2).not.toHaveBeenCalled();
    expect(deps2.registry.size).toBe(2);
    expect(deps2.registry.get('skill-a')?.description).toBe('skill-a desc');
  });

  it('persists all candidates and preserves the full-scan winner after hydration', async () => {
    const higherFolder = join(dir, 'higher');
    const lowerFolder = join(dir, 'lower');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(higherFolder, { recursive: true });
    await mkdir(lowerFolder, { recursive: true });
    await writeSkill(join(higherFolder, 'shared.md'), 'shared-skill');
    await writeSkill(join(lowerFolder, 'shared.md'), 'shared-skill');
    const folders = [higherFolder, lowerFolder];

    const scanned = makeRealDeps(folders, indexPath);
    await ensureRegistryFresh(scanned);

    const scannedWinner = scanned.registry.get('shared-skill');
    const scannedCandidates = scanned.registry.getCandidates('shared-skill')
      .map((candidate) => ({ folder: candidate.folder, sourcePath: candidate.sourcePath }));
    const saved = await scanned.indexStore.load();
    expect(saved).not.toBeNull();
    const savedCandidates = saved!.skills['shared-skill'];
    expect(savedCandidates).toHaveLength(2);
    expect(savedCandidates.map((candidate) => ({
      folder: candidate.folder,
      sourcePath: candidate.sourcePath,
    }))).toEqual(scannedCandidates);

    const hydrated = makeRealDeps(folders, indexPath);
    const scanSpy = vi.spyOn(hydrated.scanner, 'scan');
    await ensureRegistryFresh(hydrated);

    const hydratedWinner = hydrated.registry.get('shared-skill');
    expect(scanSpy).not.toHaveBeenCalled();
    expect(hydrated.registry.getCandidates('shared-skill').map((candidate) => ({
      folder: candidate.folder,
      sourcePath: candidate.sourcePath,
    }))).toEqual(scannedCandidates);
    expect(hydratedWinner?.folder).toBe(scannedWinner?.folder);
    expect(hydratedWinner?.sourcePath).toBe(scannedWinner?.sourcePath);
  });

  it('adding a skill file invalidates the index → next call rebuilds', async () => {
    const deps = makeRealDeps(folder, indexPath);
    await ensureRegistryFresh(deps);

    await writeSkill(join(folder, 'c.md'), 'skill-c');

    const deps2 = makeRealDeps(folder, indexPath);
    const scanSpy2 = vi.spyOn(deps2.scanner, 'scan');
    await ensureRegistryFresh(deps2);

    expect(scanSpy2).toHaveBeenCalled();
    expect(deps2.registry.size).toBe(3);
  });

  it('removing a skill file invalidates the index → next call rebuilds', async () => {
    const deps = makeRealDeps(folder, indexPath);
    await ensureRegistryFresh(deps);

    await unlink(join(folder, 'b.md'));

    const deps2 = makeRealDeps(folder, indexPath);
    const scanSpy2 = vi.spyOn(deps2.scanner, 'scan');
    await ensureRegistryFresh(deps2);

    expect(scanSpy2).toHaveBeenCalled();
    expect(deps2.registry.size).toBe(1);
  });

  it('editing a skill file in place invalidates the index', async () => {
    const deps = makeRealDeps(folder, indexPath);
    await ensureRegistryFresh(deps);

    // Rewrite + advance mtime to emulate an in-place content edit.
    await writeSkill(join(folder, 'a.md'), 'skill-a-renamed');
    const future = new Date(Date.now() + 60_000);
    await utimes(join(folder, 'a.md'), future, future);

    const deps2 = makeRealDeps(folder, indexPath);
    const scanSpy2 = vi.spyOn(deps2.scanner, 'scan');
    await ensureRegistryFresh(deps2);

    expect(scanSpy2).toHaveBeenCalled();
    expect(deps2.registry.has('skill-a-renamed')).toBe(true);
  });

  it('a corrupt index file degrades to a silent full rebuild', async () => {
    const deps = makeRealDeps(folder, indexPath);
    await ensureRegistryFresh(deps);

    // Corrupt the on-disk index.
    await writeFile(indexPath, '{ broken json', 'utf8');

    const deps2 = makeRealDeps(folder, indexPath);
    const scanSpy2 = vi.spyOn(deps2.scanner, 'scan');
    await expect(ensureRegistryFresh(deps2)).resolves.toBeUndefined();
    expect(scanSpy2).toHaveBeenCalled();
    expect(deps2.registry.size).toBe(2);
  });

  it('a corrupt candidate record degrades to a silent full rebuild', async () => {
    const deps = makeRealDeps(folder, indexPath);
    await ensureRegistryFresh(deps);
    const valid = await deps.indexStore.load();
    expect(valid).not.toBeNull();

    await writeFile(indexPath, JSON.stringify({
      version: valid!.version,
      fingerprint: valid!.fingerprint,
      skills: { 'skill-a': [{ sourcePath: 42 }] },
    }), 'utf8');

    const deps2 = makeRealDeps(folder, indexPath);
    const scanSpy2 = vi.spyOn(deps2.scanner, 'scan');
    await expect(ensureRegistryFresh(deps2)).resolves.toBeUndefined();
    expect(scanSpy2).toHaveBeenCalled();
    expect(deps2.registry.size).toBe(2);
  });

  it('a missing index file degrades to a silent full rebuild', async () => {
    const deps = makeRealDeps(folder, indexPath);
    const scanSpy = vi.spyOn(deps.scanner, 'scan');
    await expect(ensureRegistryFresh(deps)).resolves.toBeUndefined();
    expect(scanSpy).toHaveBeenCalled();
    expect(deps.registry.size).toBe(2);
  });
});
