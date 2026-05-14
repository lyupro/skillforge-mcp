import { describe, it, expect } from 'vitest';
import { delimiter } from 'node:path';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadResolvedConfig, buildPatternScanner } from './config.js';
import { PatternScanner } from './security/index.js';
import type { PersistedConfig } from './config/index.js';

describe('loadConfig', () => {
  it('returns default folder when SKILLFORGE_FOLDERS is not set', () => {
    const config = loadConfig({});
    const expected = join(homedir(), '.claude', 'plugins', 'cache', 'claude-code-skills');
    expect(config.folders).toEqual([expected]);
  });

  it('parses a single folder from env', () => {
    const config = loadConfig({ SKILLFORGE_FOLDERS: '/my/skills' });
    expect(config.folders).toEqual([resolve('/my/skills')]);
  });

  it('parses multiple folders using platform path delimiter', () => {
    const raw = ['/folder/a', '/folder/b'].join(delimiter);
    const config = loadConfig({ SKILLFORGE_FOLDERS: raw });
    expect(config.folders).toEqual([resolve('/folder/a'), resolve('/folder/b')]);
  });

  it('deduplicates folders preserving first-seen order', () => {
    const raw = ['/dup', '/other', '/dup'].join(delimiter);
    const config = loadConfig({ SKILLFORGE_FOLDERS: raw });
    expect(config.folders).toEqual([resolve('/dup'), resolve('/other')]);
  });

  it('trims whitespace around folder entries', () => {
    const raw = '  /trimmed  ';
    const config = loadConfig({ SKILLFORGE_FOLDERS: raw });
    expect(config.folders).toEqual([resolve('/trimmed')]);
  });

  it('returns default TTL when SKILLFORGE_TTL_MS is not set', () => {
    const config = loadConfig({});
    expect(config.ttlMs).toBe(300_000);
  });

  it('parses a valid TTL from env', () => {
    const config = loadConfig({ SKILLFORGE_TTL_MS: '60000' });
    expect(config.ttlMs).toBe(60_000);
  });

  it('falls back to default TTL for non-numeric value', () => {
    const config = loadConfig({ SKILLFORGE_TTL_MS: 'banana' });
    expect(config.ttlMs).toBe(300_000);
  });

  it('falls back to default TTL for zero', () => {
    const config = loadConfig({ SKILLFORGE_TTL_MS: '0' });
    expect(config.ttlMs).toBe(300_000);
  });

  it('falls back to default TTL for negative value', () => {
    const config = loadConfig({ SKILLFORGE_TTL_MS: '-1000' });
    expect(config.ttlMs).toBe(300_000);
  });
});

// Minimal fake store matching the shape ConfigStore exposes.
function fakeStore(persisted: PersistedConfig): { load: () => Promise<PersistedConfig>; save: () => Promise<void>; getFilePath: () => string } {
  return {
    load: async () => persisted,
    save: async () => {},
    getFilePath: () => '',
  };
}

function basePersistedConfig(overrides: Partial<PersistedConfig> = {}): PersistedConfig {
  return {
    version: '1.0',
    folders: [],
    blacklist: [],
    security: {
      autoAudit: true,
      auditPatterns: ['shell=True', 'eval\\(', 'exec\\(', 'base64\\.b64decode'],
      allowScripts: false,
      sandboxScripts: true,
      sandboxRestrictedPaths: ['~/.ssh', '~/.aws', '~/.gnupg'],
    },
    cache: { metadataTtlMs: 300_000, contentTtlMs: 300_000, maxSizeMb: 50 },
    watcher: { enabled: true, debounceMs: 500 },
    logging: { level: 'info', file: null },
    ...overrides,
  };
}

describe('loadResolvedConfig', () => {
  it('env SKILLFORGE_FOLDERS set → wins; persisted folders ignored', async () => {
    const persisted = basePersistedConfig({
      folders: [{ path: '/persisted/folder', priority: 100, enabled: true, tags: [] }],
    });
    const resolved = await loadResolvedConfig(
      { SKILLFORGE_FOLDERS: '/env/folder' },
      fakeStore(persisted) as never,
    );
    expect(resolved.folders).toEqual([resolve('/env/folder')]);
  });

  it('env unset + 2 enabled entries with different priorities → returned priority desc', async () => {
    const persisted = basePersistedConfig({
      folders: [
        { path: '/low', priority: 10, enabled: true, tags: [] },
        { path: '/high', priority: 200, enabled: true, tags: [] },
      ],
    });
    const resolved = await loadResolvedConfig({}, fakeStore(persisted) as never);
    expect(resolved.folders).toEqual([resolve('/high'), resolve('/low')]);
  });

  it('env unset + disabled entry → that entry filtered out', async () => {
    const persisted = basePersistedConfig({
      folders: [
        { path: '/disabled', priority: 100, enabled: false, tags: [] },
        { path: '/active', priority: 50, enabled: true, tags: [] },
      ],
    });
    const resolved = await loadResolvedConfig({}, fakeStore(persisted) as never);
    expect(resolved.folders).toEqual([resolve('/active')]);
    expect(resolved.folders).not.toContain(resolve('/disabled'));
  });

  it('env unset + persisted folders empty → built-in default folder', async () => {
    const persisted = basePersistedConfig({ folders: [] });
    const resolved = await loadResolvedConfig({}, fakeStore(persisted) as never);
    const expected = join(homedir(), '.claude', 'plugins', 'cache', 'claude-code-skills');
    expect(resolved.folders).toEqual([expected]);
  });

  it('corrupt store (load throws) → rethrows the error', async () => {
    const brokenStore = {
      load: async () => { throw new Error('ConfigStore: invalid JSON in "bad.json"'); },
      save: async () => {},
      getFilePath: () => 'bad.json',
    };
    await expect(
      loadResolvedConfig({}, brokenStore as never),
    ).rejects.toThrow('invalid JSON');
  });

  it('persisted field is included in the returned object', async () => {
    const persisted = basePersistedConfig();
    const resolved = await loadResolvedConfig({}, fakeStore(persisted) as never);
    expect(resolved.persisted).toBe(persisted);
  });
});

describe('buildPatternScanner', () => {
  it('returns null when autoAudit is false', () => {
    const persisted = basePersistedConfig({
      security: {
        autoAudit: false,
        auditPatterns: ['eval\\('],
        allowScripts: false,
        sandboxScripts: true,
        sandboxRestrictedPaths: [],
      },
    });
    expect(buildPatternScanner(persisted)).toBeNull();
  });

  it('returns null when auditPatterns is empty', () => {
    const persisted = basePersistedConfig({
      security: {
        autoAudit: true,
        auditPatterns: [],
        allowScripts: false,
        sandboxScripts: true,
        sandboxRestrictedPaths: [],
      },
    });
    expect(buildPatternScanner(persisted)).toBeNull();
  });

  it('returns a PatternScanner with the configured patterns when both conditions pass', () => {
    const persisted = basePersistedConfig({
      security: {
        autoAudit: true,
        auditPatterns: ['eval\\(', 'exec\\('],
        allowScripts: false,
        sandboxScripts: true,
        sandboxRestrictedPaths: [],
      },
    });
    const scanner = buildPatternScanner(persisted);
    expect(scanner).toBeInstanceOf(PatternScanner);
    expect(scanner!.getPatterns()).toEqual(['eval\\(', 'exec\\(']);
  });
});
