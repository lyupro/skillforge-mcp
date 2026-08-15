#!/usr/bin/env node
/**
 * SkillForge `config` subcommand.
 *
 * Answers "what setting is actually in force, and who supplied it" without
 * starting the server. Until this existed, provenance was only visible as a
 * line on stderr during startup — after the fact, and only for conflicts.
 *
 * Usage:
 *   skillforge config [--json]
 *
 * The table is built by walking the settings registry, so a setting added
 * later shows up here on its own.
 */

import { access } from 'node:fs/promises';
import { ConfigStore, defaultConfigPath } from '../config/config-store.js';
import { loadResolvedConfig } from '../config.js';
import { settingsDeclarations } from '../config/settings-declarations.js';
import { resolveSetting, SettingResolutionError } from '../config/settings-resolver.js';
import type { SettingDeclaration } from '../config/settings-resolver.js';
import { extractLogFlags } from './log-flags.js';
import { formatSettingsJson, formatSettingsTable } from './config-format.js';
import type { ConfigReport, SettingRow } from './config-format.js';

export interface ConfigDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Override the config file path — tests inject a temp path here. */
  configPath?: string;
  /** Override the environment — tests inject a fixture here. */
  env?: NodeJS.ProcessEnv;
}

const USAGE = `skillforge config — show which setting is in force and where it came from.

Usage:
  skillforge config [--json]

Precedence is environment > config file > built-in default. When both an
environment variable and a config key supply a value, the OVERRIDDEN column
names the one that lost.

Examples:
  skillforge config
  skillforge config --json
`;

function renderValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '(none)' : value.join(', ');
  return String(value);
}

/**
 * Folders are the one setting the resolver cannot decide alone: the
 * environment lists paths, the config file stores objects with priority and
 * enabled flags, so the two are merged by hand in loadResolvedConfig. Reading
 * the resolver's answer here would report the environment side only.
 */
const FOLDERS_SETTING_KEY = 'folders';

export async function main(rawArgv: string[], deps: ConfigDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const env = deps.env ?? process.env;
  const configPath = deps.configPath ?? defaultConfigPath();

  const { rest } = extractLogFlags(rawArgv);
  const asJson = rest.includes('--json');
  const unknown = rest.filter((arg) => arg !== '--json');
  if (unknown.length > 0) {
    stderr(`skillforge config: unknown argument: ${unknown[0]}\n\n${USAGE}`);
    return 2;
  }

  const store = new ConfigStore({ filePath: configPath });
  let configExists = true;
  try {
    await access(configPath);
  } catch {
    configExists = false;
  }

  let settings: SettingRow[];
  let folderList: string[] = [];
  try {
    const resolved = await loadResolvedConfig(env, store);
    folderList = resolved.folders;
    settings = settingsDeclarations.map((declaration): SettingRow => {
      if (declaration.settingKey === FOLDERS_SETTING_KEY) {
        return {
          setting: declaration.settingKey,
          // A dozen absolute paths do not belong in a table cell; the count
          // goes here and the paths are listed underneath.
          value: resolved.folders.length === 0 ? '(none)' : `${resolved.folders.length} folder(s)`,
          source: resolved.foldersSource,
        };
      }
      // The registry is heterogeneous by design (numbers, strings, lists); the
      // table only ever prints the value, so the concrete type is irrelevant here.
      const setting = resolveSetting(
        declaration as SettingDeclaration<unknown>,
        resolved.persisted,
        env,
      );
      return {
        setting: declaration.settingKey,
        value: renderValue(setting.value),
        source: setting.source,
        ...(setting.conflict === undefined
          ? {}
          : { overridden: `config value ${renderValue(setting.conflict.configValue)}` }),
      };
    });
  } catch (err) {
    // A diagnostic command that dies with a stack trace on the very problem it
    // was run to explain is worse than useless.
    if (err instanceof SettingResolutionError) {
      stderr(`skillforge config: ${err.message}\n`);
      return 1;
    }
    stderr(`skillforge config: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const report: ConfigReport = {
    configPath,
    configExists,
    settings,
    lists: [{ setting: FOLDERS_SETTING_KEY, items: folderList }],
  };
  stdout(asJson ? formatSettingsJson(report) : formatSettingsTable(report));
  return 0;
}
