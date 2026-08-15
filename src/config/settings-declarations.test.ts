import { describe, expect, it } from 'vitest';
import { delimiter, resolve } from 'node:path';
import {
  foldersDeclaration,
  logLevelDeclaration,
  settingsDeclarations,
} from './settings-declarations.js';
import { resolveSetting, SettingResolutionError } from './settings-resolver.js';

describe('settingsDeclarations', () => {
  it('enumerates all project settings with complete identifying metadata', () => {
    expect(settingsDeclarations.map((declaration) => declaration.settingKey)).toEqual([
      'metadataTtlMs',
      'contentTtlMs',
      'folders',
      'hermesHome',
      'logLevel',
    ]);

    for (const declaration of settingsDeclarations) {
      expect(declaration.settingKey.length).toBeGreaterThan(0);
      const envKeys = typeof declaration.envKey === 'string'
        ? [declaration.envKey]
        : declaration.envKey;
      expect(envKeys.length).toBeGreaterThan(0);
      expect(envKeys.every((envKey) => envKey.length > 0)).toBe(true);
      expect(declaration.expected.length).toBeGreaterThan(0);
    }
  });
});

describe('logLevelDeclaration', () => {
  it.each(['1', 'true', 'on', 'yes', 'TRUE', 'ON', 'YES'])(
    'maps enabling environment value %s to debug',
    (value) => {
      expect(resolveSetting(logLevelDeclaration, {}, { SKILLFORGE_DEBUG: value })).toEqual({
        value: 'debug',
        source: 'env',
      });
    },
  );

  it('accepts a named log level case-insensitively', () => {
    expect(resolveSetting(logLevelDeclaration, {}, { SKILLFORGE_DEBUG: 'WARN' })).toEqual({
      value: 'warn',
      source: 'env',
    });
  });

  it.each(['0', 'false', 'off', 'no', '', '   '])(
    'treats disabling environment value %j as unset',
    (value) => {
      expect(
        resolveSetting(
          logLevelDeclaration,
          { logging: { level: 'error' } },
          { SKILLFORGE_DEBUG: value },
        ),
      ).toEqual({ value: 'error', source: 'config' });
      expect(resolveSetting(logLevelDeclaration, {}, { SKILLFORGE_DEBUG: value })).toEqual({
        value: 'info',
        source: 'default',
      });
    },
  );

  it('uses DEBUG when SKILLFORGE_DEBUG is absent', () => {
    expect(resolveSetting(logLevelDeclaration, {}, { DEBUG: '1' })).toEqual({
      value: 'debug',
      source: 'env',
    });
  });

  it('prefers SKILLFORGE_DEBUG when both environment names are set', () => {
    expect(
      resolveSetting(logLevelDeclaration, {}, { SKILLFORGE_DEBUG: 'warn', DEBUG: '1' }),
    ).toEqual({ value: 'warn', source: 'env' });
  });

  it('names DEBUG in conflicts and invalid-value errors', () => {
    const resolved = resolveSetting(
      logLevelDeclaration,
      { logging: { level: 'error' } },
      { DEBUG: '1' },
    );
    expect(resolved.conflict?.envKey).toBe('DEBUG');

    try {
      resolveSetting(logLevelDeclaration, {}, { DEBUG: 'verbose' });
      expect.unreachable('Expected invalid DEBUG value to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingResolutionError);
      expect((error as SettingResolutionError).envKey).toBe('DEBUG');
    }
  });

  it('rejects an unknown environment value with both accepted forms', () => {
    try {
      resolveSetting(logLevelDeclaration, {}, { SKILLFORGE_DEBUG: 'verbose' });
      expect.unreachable('Expected invalid log level to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingResolutionError);
      expect(error).toMatchObject({ source: 'env', envKey: 'SKILLFORGE_DEBUG' });
      expect((error as SettingResolutionError).expected).toContain('log level');
      expect((error as SettingResolutionError).expected).toContain('enabling flag');
    }
  });

  it('rejects an unknown config value as a config resolution error', () => {
    try {
      resolveSetting(logLevelDeclaration, { logging: { level: 'verbose' } }, {});
      expect.unreachable('Expected invalid config log level to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingResolutionError);
      expect(error).toMatchObject({ source: 'config', envKey: undefined });
    }
  });
});

describe('foldersDeclaration', () => {
  function resolveFolders(value?: string): string[] {
    const environment = value === undefined ? {} : { SKILLFORGE_FOLDERS: value };
    return resolveSetting(foldersDeclaration, {}, environment).value;
  }

  it('defaults to an empty list when the environment value is absent', () => {
    expect(resolveFolders()).toEqual([]);
  });

  it('resolves one folder to an absolute path', () => {
    expect(resolveFolders('relative/folder')).toEqual([resolve('relative/folder')]);
  });

  it('parses several folders with the platform delimiter', () => {
    expect(resolveFolders(['first', 'second'].join(delimiter))).toEqual([
      resolve('first'),
      resolve('second'),
    ]);
  });

  it('deduplicates resolved paths while preserving first appearance', () => {
    expect(resolveFolders(['first', 'second', 'first'].join(delimiter))).toEqual([
      resolve('first'),
      resolve('second'),
    ]);
  });

  it('silently discards empty segments between delimiters', () => {
    expect(resolveFolders(['first', '', 'second'].join(delimiter))).toEqual([
      resolve('first'),
      resolve('second'),
    ]);
  });

  it('fails loud when a non-empty value contains only delimiters', () => {
    expect(() => resolveFolders(delimiter.repeat(3))).toThrow(SettingResolutionError);
  });

  it('treats an empty string as unset', () => {
    expect(resolveFolders('')).toEqual([]);
  });
});
