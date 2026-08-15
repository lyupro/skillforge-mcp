import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spawns real processes / boots a real server, so it is not bound by the 5s
// default meant for pure unit tests: on a busy machine that budget expires
// mid-setup and reports a timeout where nothing is actually broken.
vi.setConfig({ testTimeout: 20_000 });
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleReload } from '../../src/tools/reload.js';
import { SkillRegistry } from '../../src/core/skill-registry.js';
import { SkillResolver } from '../../src/core/skill-resolver.js';
import { SkillMetadataCache } from '../../src/core/skill-metadata-cache.js';
import { SkillContentCache } from '../../src/core/skill-content-cache.js';
import { SkillIndexStore } from '../../src/core/skill-index-store.js';
import { FrontmatterParser } from '../../src/parser/frontmatter-parser.js';
import { FileScanner } from '../../src/parser/file-scanner.js';
import { StrategyFactory } from '../../src/factory/strategy-factory.js';
import { PromptStrategy } from '../../src/handlers/prompt-strategy.js';
import { BlacklistFilter } from '../../src/security/blacklist-filter.js';
import { SandboxRunner } from '../../src/security/sandbox-runner.js';
import { DecoratorChain, stderrLogger } from '../../src/decorators/index.js';
import type { ServerDeps } from '../../src/server-deps.js';

function writeSkill(path: string, name: string): Promise<void> {
  return writeFile(path, `---\nname: ${name}\ndescription: ${name}\n---\nBody of ${name}\n`, 'utf8');
}

function makeDeps(folders: string[], indexPath: string): ServerDeps {
  return {
    folders,
    configStore: {} as ServerDeps['configStore'],
    registry: new SkillRegistry(folders),
    resolver: new SkillResolver(),
    metadataCache: new SkillMetadataCache(),
    contentCache: new SkillContentCache(),
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

function registryState(deps: ServerDeps): Array<{
  name: string;
  winner: string;
  candidates: string[];
}> {
  return deps.registry.getAll().map((winner) => ({
    name: winner.name,
    winner: winner.sourcePath,
    candidates: deps.registry.getCandidates(winner.name)
      .map((candidate) => candidate.sourcePath)
      .sort(),
  }));
}

describe('partial reload equivalence', () => {
  let root: string;
  let high: string;
  let low: string;
  let empty: string;
  let vanishing: string;
  let partial: ServerDeps;
  let full: ServerDeps;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-partial-reload-'));
    high = join(root, 'high');
    low = join(root, 'low');
    empty = join(root, 'empty');
    vanishing = join(root, 'vanishing');
    await Promise.all([high, low, empty, vanishing].map((folder) => mkdir(folder, { recursive: true })));
    await Promise.all([
      writeSkill(join(high, 'shared.md'), 'shared'),
      writeSkill(join(low, 'shared.md'), 'shared'),
      writeSkill(join(low, 'shadow.md'), 'shadow'),
      writeSkill(join(low, 'low-only.md'), 'low-only'),
      writeSkill(join(vanishing, 'gone.md'), 'gone'),
    ]);
    const folders = [high, low, empty, vanishing];
    partial = makeDeps(folders, join(root, 'partial-index.json'));
    full = makeDeps(folders, join(root, 'full-index.json'));
    await Promise.all([handleReload(partial, {}), handleReload(full, {})]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function expectEquivalentAfter(
    target: string,
  ): Promise<Awaited<ReturnType<typeof handleReload>>> {
    const scanSpy = vi.spyOn(partial.scanner, 'scan');
    const partialResult = await handleReload(partial, { folder: target });
    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(scanSpy).toHaveBeenCalledWith(target);
    await handleReload(full, {});
    expect(registryState(partial)).toEqual(registryState(full));
    const savedIndex = await partial.indexStore.load();
    expect(savedIndex).not.toBeNull();
    expect(Object.fromEntries(
      Object.entries(savedIndex!.skills).map(([name, candidates]) => [
        name,
        candidates.map((candidate) => candidate.sourcePath).sort(),
      ]),
    )).toEqual(Object.fromEntries(
      registryState(partial).map(({ name, candidates }) => [name, candidates]),
    ));
    scanSpy.mockRestore();
    return partialResult;
  }

  it('matches a full reload across collision, empty, missing, and parse-error changes', async () => {
    await unlink(join(high, 'shared.md'));
    let result = await expectEquivalentAfter(high);
    expect(partial.registry.get('shared')?.folder).toBe(low);
    expect(result.removed).toEqual([]);

    await writeSkill(join(high, 'shadow.md'), 'shadow');
    result = await expectEquivalentAfter(high);
    expect(partial.registry.get('shadow')?.folder).toBe(high);
    expect(result.added).toEqual([]);

    await writeSkill(join(high, 'shared-renamed.md'), 'shared');
    await expectEquivalentAfter(high);
    expect(partial.registry.get('shared')?.sourcePath).toBe(join(high, 'shared-renamed.md'));

    result = await expectEquivalentAfter(empty);
    expect(result.scope).toEqual({ folder: empty, scanned: 0 });

    await rm(vanishing, { recursive: true, force: true });
    result = await expectEquivalentAfter(vanishing);
    expect(result.removed).toEqual(['gone']);
    expect(result.errors).toEqual([{ path: vanishing, message: `Folder not found: ${vanishing}` }]);

    const badHigh = join(high, 'bad.md');
    const badLow = join(low, 'other-bad.md');
    await Promise.all([
      writeFile(badHigh, '---\nname: [\n---\n', 'utf8'),
      writeFile(badLow, '---\nname: [\n---\n', 'utf8'),
    ]);
    result = await expectEquivalentAfter(high);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe(badHigh);
    expect(partial.registry.get('low-only')?.folder).toBe(low);
  });
});
