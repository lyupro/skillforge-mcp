/** Declares every project setting with its sources, default, parser, and expected value shape. */

import { delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  integerAtLeast,
  nonEmptyStringParser,
  type SettingDeclaration,
  type SettingParser,
} from './settings-resolver.js';

const DEFAULT_TTL_MS = 300_000;

const foldersParser: SettingParser<string[]> = {
  parse(value: unknown): string[] {
    if (typeof value !== 'string') throw new Error('invalid folder list');

    const folders = value
      .split(delimiter)
      .map((folder) => folder.trim())
      .filter(Boolean)
      .reduce<string[]>((accumulator, folder) => {
        const absolutePath = resolve(folder);
        if (!accumulator.includes(absolutePath)) accumulator.push(absolutePath);
        return accumulator;
      }, []);

    if (folders.length === 0) throw new Error('invalid folder list');
    return folders;
  },
};

export const metadataTtlDeclaration = {
  settingKey: 'metadataTtlMs',
  envKey: 'SKILLFORGE_TTL_MS',
  configPath: ['cache', 'metadataTtlMs'],
  parser: integerAtLeast(0),
  defaultValue: DEFAULT_TTL_MS,
  expected: 'a non-negative integer',
} satisfies SettingDeclaration<number>;

export const contentTtlDeclaration = {
  settingKey: 'contentTtlMs',
  envKey: 'SKILLFORGE_TTL_MS',
  configPath: ['cache', 'contentTtlMs'],
  parser: integerAtLeast(0),
  defaultValue: DEFAULT_TTL_MS,
  expected: 'a non-negative integer',
} satisfies SettingDeclaration<number>;

export const foldersDeclaration = {
  settingKey: 'folders',
  envKey: 'SKILLFORGE_FOLDERS',
  parser: foldersParser,
  defaultValue: [],
  expected: `one or more folder paths separated by ${JSON.stringify(delimiter)}`,
} satisfies SettingDeclaration<string[]>;

export const hermesHomeDeclaration = {
  settingKey: 'hermesHome',
  envKey: 'HERMES_HOME',
  isEnvValueUnset: (value: string) => value.trim() === '',
  parser: nonEmptyStringParser,
  // The real fallback directory, not a sentinel: an empty default would be a
  // value this setting's own parser rejects, and callers would have to know
  // that "" secretly means "use the home directory".
  defaultValue: join(homedir(), '.hermes'),
  expected: 'a non-empty string',
} satisfies SettingDeclaration<string>;

export const settingsDeclarations = [
  metadataTtlDeclaration,
  contentTtlDeclaration,
  foldersDeclaration,
  hermesHomeDeclaration,
] as const;
