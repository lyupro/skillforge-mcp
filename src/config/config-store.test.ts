import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ConfigStore, defaultConfigPath } from './config-store.js';
import { defaultConfig } from './config-schema.js';
import type { PersistedConfig } from './config-schema.js';

interface FakeFs {
  store: Map<string, string>;
  calls: Array<{ op: string; args: string[] }>;
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, contents: string) => Promise<void>;
  rename: (oldP: string, newP: string) => Promise<void>;
  mkdir: (p: string, opts: { recursive: boolean }) => Promise<void>;
  access: (p: string) => Promise<void>;
}

function makeFakeFs(initial: Record<string, string> = {}): FakeFs {
  const store = new Map(Object.entries(initial));
  const calls: Array<{ op: string; args: string[] }> = [];

  return {
    store,
    calls,
    readFile: async (p) => {
      calls.push({ op: 'readFile', args: [p] });
      const val = store.get(p);
      if (val === undefined) {
        const err = Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
        throw err;
      }
      return val;
    },
    writeFile: async (p, contents) => {
      calls.push({ op: 'writeFile', args: [p, contents] });
      store.set(p, contents);
    },
    rename: async (oldP, newP) => {
      calls.push({ op: 'rename', args: [oldP, newP] });
      const val = store.get(oldP);
      if (val !== undefined) {
        store.set(newP, val);
        store.delete(oldP);
      }
    },
    mkdir: async (p, _opts) => {
      calls.push({ op: 'mkdir', args: [p] });
    },
    access: async (p) => {
      calls.push({ op: 'access', args: [p] });
      if (!store.has(p)) {
        const err = Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
        throw err;
      }
    },
  };
}

const TEST_PATH = '/fake/config/skillforge/config.json';

describe('ConfigStore.load()', () => {
  it('returns defaultConfig() when file is missing, without calling writeFile', async () => {
    const fakeFs = makeFakeFs();
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });

    const result = await store.load();
    expect(result).toEqual(defaultConfig());
    expect(fakeFs.calls.some((c) => c.op === 'writeFile')).toBe(false);
  });

  it('throws with file path in message when JSON is invalid', async () => {
    const fakeFs = makeFakeFs({ [TEST_PATH]: 'not { valid json' });
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });

    await expect(store.load()).rejects.toThrow(TEST_PATH);
  });

  it('fills missing fields with defaults when file has partial content', async () => {
    const partial = JSON.stringify({ folders: [{ path: '/my/skills' }] });
    const fakeFs = makeFakeFs({ [TEST_PATH]: partial });
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });

    const result = await store.load();
    expect(result.folders[0]!.path).toBe('/my/skills');
    expect(result.folders[0]!.priority).toBe(100);
    expect(result.security.autoAudit).toBe(true);
    expect(result.watcher.debounceMs).toBe(500);
  });

  it('throws when file has wrong type for a field', async () => {
    const bad = JSON.stringify({ folders: 'not-an-array' });
    const fakeFs = makeFakeFs({ [TEST_PATH]: bad });
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });

    await expect(store.load()).rejects.toThrow();
  });

  it('loads a fully valid config correctly', async () => {
    const config: PersistedConfig = {
      ...defaultConfig(),
      blacklist: ['skip-me'],
      watcher: { enabled: false, debounceMs: 200 },
    };
    const fakeFs = makeFakeFs({ [TEST_PATH]: JSON.stringify(config) });
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });

    const result = await store.load();
    expect(result.blacklist).toEqual(['skip-me']);
    expect(result.watcher.enabled).toBe(false);
    expect(result.watcher.debounceMs).toBe(200);
  });
});

describe('ConfigStore.save()', () => {
  it('writes to tmp path then renames to final path in order', async () => {
    const fakeFs = makeFakeFs();
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });
    const config = defaultConfig();

    await store.save(config);

    const tmpPath = `${TEST_PATH}.tmp`;
    const writeCall = fakeFs.calls.find((c) => c.op === 'writeFile');
    const renameCall = fakeFs.calls.find((c) => c.op === 'rename');

    expect(writeCall).toBeDefined();
    expect(writeCall!.args[0]).toBe(tmpPath);
    expect(renameCall).toBeDefined();
    expect(renameCall!.args[0]).toBe(tmpPath);
    expect(renameCall!.args[1]).toBe(TEST_PATH);

    const writeIndex = fakeFs.calls.indexOf(writeCall!);
    const renameIndex = fakeFs.calls.indexOf(renameCall!);
    expect(writeIndex).toBeLessThan(renameIndex);
  });

  it('calls mkdir with parent directory and recursive:true before writing', async () => {
    const fakeFs = makeFakeFs();
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });

    await store.save(defaultConfig());

    const mkdirCall = fakeFs.calls.find((c) => c.op === 'mkdir');
    expect(mkdirCall).toBeDefined();
    expect(mkdirCall!.args[0]).toBe('/fake/config/skillforge');

    const mkdirIndex = fakeFs.calls.indexOf(mkdirCall!);
    const writeCall = fakeFs.calls.find((c) => c.op === 'writeFile');
    const writeIndex = fakeFs.calls.indexOf(writeCall!);
    expect(mkdirIndex).toBeLessThan(writeIndex);
  });

  it('save then load round-trips the config', async () => {
    const fakeFs = makeFakeFs();
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });
    const config: PersistedConfig = {
      ...defaultConfig(),
      blacklist: ['evil-skill'],
      logging: { level: 'debug', file: '/var/log/skillforge.log' },
    };

    await store.save(config);
    const loaded = await store.load();
    expect(loaded).toEqual(config);
  });

  it('preserves unknown top-level key across load→save→load (forward-compat round-trip)', async () => {
    const withFuture = JSON.stringify({
      ...defaultConfig(),
      futureTopLevelKey: 'survive',
    });
    const fakeFs = makeFakeFs({ [TEST_PATH]: withFuture });
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });

    const loaded = await store.load();
    expect((loaded as Record<string, unknown>)['futureTopLevelKey']).toBe('survive');

    await store.save(loaded);

    const saved = fakeFs.store.get(TEST_PATH);
    const reparsed = JSON.parse(saved!) as Record<string, unknown>;
    expect(reparsed['futureTopLevelKey']).toBe('survive');
  });

  it('preserves unknown folder entry key across load→save→load (forward-compat round-trip)', async () => {
    const withFuture = JSON.stringify({
      ...defaultConfig(),
      folders: [{ path: '/foo', futureField: 'keep' }],
    });
    const fakeFs = makeFakeFs({ [TEST_PATH]: withFuture });
    const store = new ConfigStore({ filePath: TEST_PATH, fs: fakeFs });

    const loaded = await store.load();
    const folders = (loaded as Record<string, unknown>)['folders'] as Record<string, unknown>[];
    expect(folders[0]!['futureField']).toBe('keep');

    await store.save(loaded);

    const saved = fakeFs.store.get(TEST_PATH);
    const reparsed = JSON.parse(saved!) as Record<string, unknown>;
    const savedFolders = reparsed['folders'] as Record<string, unknown>[];
    expect(savedFolders[0]!['futureField']).toBe('keep');
  });
});

describe('ConfigStore.getFilePath()', () => {
  it('returns the configured file path', () => {
    const store = new ConfigStore({ filePath: TEST_PATH, fs: makeFakeFs() });
    expect(store.getFilePath()).toBe(TEST_PATH);
  });
});

describe('defaultConfigPath()', () => {
  it('returns the Lyu Pro brand path under homedir on every platform', () => {
    const result = defaultConfigPath();
    const expected = join(homedir(), '.lyupro', '.skillforge', 'config.json');
    expect(result).toBe(expected);
  });
});
