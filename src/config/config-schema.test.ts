import { describe, it, expect } from 'vitest';
import { configSchema, defaultConfig } from './config-schema.js';

describe('configSchema', () => {
  it('parses empty object and fills all defaults', () => {
    const result = configSchema.parse({});
    expect(result.version).toBe('1.0');
    expect(result.folders).toEqual([]);
    expect(result.blacklist).toEqual([]);
    expect(result.security.autoAudit).toBe(true);
    expect(result.security.allowScripts).toBe(false);
    expect(result.security.sandboxScripts).toBe(true);
    expect(result.security.sandboxRestrictedPaths).toEqual(['~/.ssh', '~/.aws', '~/.gnupg']);
    expect(result.cache.metadataTtlMs).toBe(300_000);
    expect(result.cache.contentTtlMs).toBe(300_000);
    expect(result.cache.maxSizeMb).toBe(50);
    expect(result.watcher.enabled).toBe(true);
    expect(result.watcher.debounceMs).toBe(500);
    expect(result.logging.level).toBe('info');
    expect(result.logging.file).toBeNull();
  });

  it('defaultConfig() round-trips through JSON parse', () => {
    const original = defaultConfig();
    const roundTripped = configSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(roundTripped).toEqual(original);
  });

  it('strips unknown extra fields', () => {
    const result = configSchema.parse({ unknownField: 'ignored', version: '1.0' });
    expect('unknownField' in result).toBe(false);
    expect(result.version).toBe('1.0');
  });

  it('throws when folders is not an array', () => {
    expect(() => configSchema.parse({ folders: 'not-array' })).toThrow();
  });

  it('throws when watcher.debounceMs is negative', () => {
    expect(() => configSchema.parse({ watcher: { debounceMs: -1 } })).toThrow();
  });

  it('throws when cache.metadataTtlMs is negative', () => {
    expect(() => configSchema.parse({ cache: { metadataTtlMs: -100 } })).toThrow();
  });

  it('throws when cache.contentTtlMs is negative', () => {
    expect(() => configSchema.parse({ cache: { contentTtlMs: -1 } })).toThrow();
  });

  it('throws when cache.maxSizeMb is negative', () => {
    expect(() => configSchema.parse({ cache: { maxSizeMb: -5 } })).toThrow();
  });

  it('throws when logging.level is an unknown string', () => {
    expect(() => configSchema.parse({ logging: { level: 'verbose' } })).toThrow();
  });

  it('accepts all valid logging levels', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      const result = configSchema.parse({ logging: { level } });
      expect(result.logging.level).toBe(level);
    }
  });

  it('parses a nontrivial valid config with 2 folders and blacklist', () => {
    const input = {
      version: '1.0',
      folders: [
        { path: '/home/user/skills', priority: 200, enabled: true, tags: ['work'] },
        { path: '/opt/shared-skills', priority: 50, enabled: false, tags: [] },
      ],
      blacklist: ['dangerous-skill'],
      security: { autoAudit: false },
      watcher: { enabled: false, debounceMs: 1000 },
    };

    const result = configSchema.parse(input);
    expect(result.folders).toHaveLength(2);
    expect(result.folders[0]!.path).toBe('/home/user/skills');
    expect(result.folders[0]!.priority).toBe(200);
    expect(result.folders[0]!.tags).toEqual(['work']);
    expect(result.folders[1]!.enabled).toBe(false);
    expect(result.blacklist).toEqual(['dangerous-skill']);
    expect(result.security.autoAudit).toBe(false);
    expect(result.security.allowScripts).toBe(false);
    expect(result.watcher.debounceMs).toBe(1000);

    const json = JSON.stringify(result);
    const reloaded = configSchema.parse(JSON.parse(json));
    expect(reloaded).toEqual(result);
  });

  it('fills folder entry defaults for partial folder objects', () => {
    const result = configSchema.parse({ folders: [{ path: '/my/skills' }] });
    expect(result.folders[0]!.priority).toBe(100);
    expect(result.folders[0]!.enabled).toBe(true);
    expect(result.folders[0]!.tags).toEqual([]);
  });

  it('throws for folder entry with empty path', () => {
    expect(() => configSchema.parse({ folders: [{ path: '' }] })).toThrow();
  });

  it('fills security defaults when section is omitted', () => {
    const result = configSchema.parse({});
    expect(result.security.auditPatterns).toContain('eval\\(');
  });

  it('fills partial security section with defaults for missing fields', () => {
    const result = configSchema.parse({ security: { autoAudit: false } });
    expect(result.security.autoAudit).toBe(false);
    expect(result.security.allowScripts).toBe(false);
    expect(result.security.sandboxScripts).toBe(true);
  });
});
