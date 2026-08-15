import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ConfigStore, defaultConfigPath } from './config/index.js';
import type { PersistedConfig } from './config/index.js';
import {
  resolveSetting,
  type ResolvedSetting,
  type SettingConflict,
} from './config/settings-resolver.js';
import {
  contentTtlDeclaration,
  foldersDeclaration,
  logLevelDeclaration,
  metadataTtlDeclaration,
  type LogLevel,
} from './config/settings-declarations.js';
import { PatternScanner } from './security/index.js';

export interface SkillForgeConfig {
  /** Resolved absolute paths, deduplicated, in priority order. */
  folders: string[];
  /** Cache TTL in milliseconds. */
  ttlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SkillForgeConfig {
  const folders = resolveSetting(foldersDeclaration, {}, env).value;
  const defaultFolder = join(homedir(), '.claude', 'plugins', 'cache', 'claude-code-skills');
  const ttlMs = resolveSetting(metadataTtlDeclaration, {}, env).value;

  return {
    folders: folders.length > 0 ? folders : [defaultFolder],
    ttlMs,
  };
}

export interface ResolvedConfig {
  /** Folders ultimately used by the server (env override > persisted folders > built-in default). */
  folders: string[];
  metadataTtlMs: ResolvedSetting<number>;
  contentTtlMs: ResolvedSetting<number>;
  logLevel: ResolvedSetting<LogLevel>;
  /** Compatibility alias for the metadata cache TTL. */
  ttlMs: number;
  /** Full persisted config (or schema defaults if file absent). */
  persisted: PersistedConfig;
}

/** Load env + persisted config and merge. Env folders win when set; otherwise
 *  enabled persisted folders (priority desc; ties → first-listed); otherwise
 *  the built-in default. */
export async function loadResolvedConfig(
  env: NodeJS.ProcessEnv = process.env,
  store?: ConfigStore,
): Promise<ResolvedConfig> {
  const resolvedStore = store ?? new ConfigStore({ filePath: defaultConfigPath() });
  const persisted = await resolvedStore.load();

  const envFolders = resolveSetting(foldersDeclaration, {}, env).value;
  const defaultFolder = join(homedir(), '.claude', 'plugins', 'cache', 'claude-code-skills');

  let folders: string[];
  if (envFolders.length > 0) {
    folders = envFolders;
  } else {
    const enabled = persisted.folders.filter((f) => f.enabled);
    if (enabled.length > 0) {
      // Sort by priority descending; stable for ties (Array.sort is stable in V8).
      const sorted = [...enabled].sort((a, b) => b.priority - a.priority);
      folders = sorted.map((f) => resolve(f.path));
    } else {
      folders = [defaultFolder];
    }
  }

  const metadataTtlMs = resolveSetting(metadataTtlDeclaration, persisted, env);
  const contentTtlMs = resolveSetting(contentTtlDeclaration, persisted, env);
  const logLevel = resolveSetting(logLevelDeclaration, persisted, env);

  return {
    folders,
    metadataTtlMs,
    contentTtlMs,
    logLevel,
    ttlMs: metadataTtlMs.value,
    persisted,
  };
}

export function formatSettingConflict(conflict: SettingConflict<number>): string {
  return `${conflict.settingKey}: ${conflict.envKey}=${conflict.envValue} wins over config value ${conflict.configValue}`;
}

/** Build a PatternScanner from persisted security settings, or null if auto-audit is off
 *  or the patterns list is empty. */
export function buildPatternScanner(persisted: PersistedConfig): PatternScanner | null {
  if (!persisted.security.autoAudit || persisted.security.auditPatterns.length === 0) {
    return null;
  }
  return new PatternScanner({ patterns: persisted.security.auditPatterns });
}
