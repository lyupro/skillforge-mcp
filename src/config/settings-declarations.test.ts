import { describe, expect, it } from 'vitest';
import { delimiter, resolve } from 'node:path';
import {
  foldersDeclaration,
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
