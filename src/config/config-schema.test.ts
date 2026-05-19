import { describe, it, expect } from 'vitest';
import {
  configSchema,
  defaultConfig,
  defaultSkillFormats,
  resolveSkillFormats,
} from './config-schema.js';

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
    expect(result.cache.indexEnabled).toBe(true);
    expect(result.cache.indexPath).toBeUndefined();
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

  it('preserves unknown extra fields (passthrough — forward-compatibility)', () => {
    const result = configSchema.parse({ unknownField: 'keep-me', version: '1.0' });
    expect((result as Record<string, unknown>)['unknownField']).toBe('keep-me');
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

  it('accepts an explicit cache.indexEnabled and cache.indexPath', () => {
    const result = configSchema.parse({
      cache: { indexEnabled: false, indexPath: '/custom/index.json' },
    });
    expect(result.cache.indexEnabled).toBe(false);
    expect(result.cache.indexPath).toBe('/custom/index.json');
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

  it('accepts a kebab-case folder alias', () => {
    const result = configSchema.parse({
      folders: [{ path: '/my/skills', alias: 'my-folder' }],
    });
    expect(result.folders[0]!.alias).toBe('my-folder');
  });

  it('parses a folder entry without an alias (field is optional)', () => {
    const result = configSchema.parse({ folders: [{ path: '/my/skills' }] });
    expect(result.folders[0]!.alias).toBeUndefined();
  });

  it('rejects non-kebab-case folder aliases', () => {
    for (const bad of ['My_Folder', 'bad alias', '', 'UPPER', 'trailing-']) {
      expect(() =>
        configSchema.parse({ folders: [{ path: '/my/skills', alias: bad }] }),
      ).toThrow();
    }
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

  it('preserves unknown key inside a folder entry after parse', () => {
    const result = configSchema.parse({
      folders: [{ path: '/foo', futureField: 'bar' }],
    });
    const folder = result.folders[0] as Record<string, unknown>;
    expect(folder['futureField']).toBe('bar');
  });

  it('preserves unknown key in a section schema after parse', () => {
    const result = configSchema.parse({
      security: { autoAudit: false, futureSecurityField: true },
    });
    expect((result.security as Record<string, unknown>)['futureSecurityField']).toBe(true);
  });
});

describe('skillFormats schema', () => {
  it('defaults skillFormats to an empty array', () => {
    expect(configSchema.parse({}).skillFormats).toEqual([]);
  });

  it('ships 4 built-in seed formats', () => {
    const ids = defaultSkillFormats().map((f) => f.id);
    expect(ids).toEqual(['claude', 'codex', 'persona', 'custom']);
  });

  it('locks deriveNameFromDir true for the canonical claude/codex formats', () => {
    const byId = new Map(defaultSkillFormats().map((f) => [f.id, f]));
    expect(byId.get('claude')!.deriveNameFromDir).toBe(true);
    expect(byId.get('codex')!.deriveNameFromDir).toBe(true);
    expect(byId.get('persona')!.deriveNameFromDir).toBe(false);
    expect(byId.get('custom')!.deriveNameFromDir).toBe(false);
  });

  it('resolveSkillFormats returns the 4 built-ins for an empty config', () => {
    const formats = resolveSkillFormats(defaultConfig());
    expect(formats.map((f) => f.id)).toEqual(['claude', 'codex', 'persona', 'custom']);
  });

  it('parses a filename match descriptor', () => {
    const result = configSchema.parse({
      skillFormats: [{ id: 'x', match: { type: 'filename', value: 'X.md' } }],
    });
    const entry = result.skillFormats[0]!;
    expect(entry.match).toEqual({ type: 'filename', value: 'X.md' });
    expect(entry.nameField).toBe('name');
    expect(entry.deriveNameFromDir).toBe(false);
    expect(entry.enabled).toBe(true);
    expect(entry.priority).toBe(100);
  });

  it('parses a filenameGlob match descriptor', () => {
    const result = configSchema.parse({
      skillFormats: [{ id: 'g', match: { type: 'filenameGlob', value: '*.skill.md' } }],
    });
    expect(result.skillFormats[0]!.match).toEqual({
      type: 'filenameGlob',
      value: '*.skill.md',
    });
  });

  it('parses a frontmatterField match descriptor', () => {
    const result = configSchema.parse({
      skillFormats: [{ id: 'p', match: { type: 'frontmatterField', field: 'persona' } }],
    });
    expect(result.skillFormats[0]!.match).toEqual({
      type: 'frontmatterField',
      field: 'persona',
    });
  });

  it('rejects an unknown match type', () => {
    expect(() =>
      configSchema.parse({
        skillFormats: [{ id: 'x', match: { type: 'bogus', value: 'X.md' } }],
      }),
    ).toThrow();
  });

  it('rejects a format entry with an empty id', () => {
    expect(() =>
      configSchema.parse({
        skillFormats: [{ id: '', match: { type: 'filename', value: 'X.md' } }],
      }),
    ).toThrow();
  });

  it('merges an operator format over the built-ins by id', () => {
    const config = configSchema.parse({
      skillFormats: [
        { id: 'gemini-gem', match: { type: 'filename', value: 'GEMINI.md' } },
      ],
    });
    const formats = resolveSkillFormats(config);
    expect(formats.map((f) => f.id)).toEqual([
      'claude',
      'codex',
      'persona',
      'custom',
      'gemini-gem',
    ]);
  });

  it('lets an operator entry replace a built-in by reusing its id', () => {
    const config = configSchema.parse({
      skillFormats: [
        { id: 'custom', match: { type: 'filenameGlob', value: '*.md' }, enabled: false },
      ],
    });
    const custom = resolveSkillFormats(config).find((f) => f.id === 'custom')!;
    expect(custom.enabled).toBe(false);
  });

  it('round-trips skillFormats through JSON', () => {
    const config = configSchema.parse({
      skillFormats: [
        {
          id: 'gemini-gem',
          match: { type: 'filename', value: 'GEMINI.md' },
          deriveNameFromDir: true,
          priority: 50,
        },
      ],
    });
    const reloaded = configSchema.parse(JSON.parse(JSON.stringify(config)));
    expect(reloaded.skillFormats).toEqual(config.skillFormats);
  });
});
