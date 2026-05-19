import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillIndexStore, INDEX_VERSION, type RegistryIndex } from './skill-index-store.js';

function sampleIndex(): RegistryIndex {
  return {
    version: INDEX_VERSION,
    fingerprint: 'abc123',
    skills: {
      'code-review': {
        sourcePath: '/skills/code-review.md',
        folder: '/skills',
        format: 'claude',
        mtimeMs: 1000,
      },
    },
  };
}

describe('SkillIndexStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-index-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when the index file is missing', async () => {
    const store = new SkillIndexStore(join(dir, 'cache', 'registry-index.json'));
    expect(await store.load()).toBeNull();
  });

  it('round-trips a saved index', async () => {
    const path = join(dir, 'cache', 'registry-index.json');
    const store = new SkillIndexStore(path);
    const index = sampleIndex();
    await store.save(index);
    const loaded = await store.load();
    expect(loaded).toEqual(index);
  });

  it('creates the cache subdirectory on save', async () => {
    const path = join(dir, 'deep', 'nested', 'registry-index.json');
    const store = new SkillIndexStore(path);
    await store.save(sampleIndex());
    expect(await store.load()).toEqual(sampleIndex());
  });

  it('returns null on corrupt JSON', async () => {
    const path = join(dir, 'registry-index.json');
    await writeFile(path, '{not valid json', 'utf8');
    const store = new SkillIndexStore(path);
    expect(await store.load()).toBeNull();
  });

  it('returns null on a schema mismatch', async () => {
    const path = join(dir, 'registry-index.json');
    await writeFile(path, JSON.stringify({ version: INDEX_VERSION, skills: 'wrong' }), 'utf8');
    const store = new SkillIndexStore(path);
    expect(await store.load()).toBeNull();
  });

  it('returns null on a version mismatch', async () => {
    const path = join(dir, 'registry-index.json');
    const stale = { ...sampleIndex(), version: INDEX_VERSION + 1 };
    await writeFile(path, JSON.stringify(stale), 'utf8');
    const store = new SkillIndexStore(path);
    expect(await store.load()).toBeNull();
  });

  it('exposes its configured path', () => {
    const store = new SkillIndexStore('/some/path.json');
    expect(store.getPath()).toBe('/some/path.json');
  });
});
