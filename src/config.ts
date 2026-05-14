import { delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ConfigStore, defaultConfigPath } from './config/index.js';
import type { PersistedConfig } from './config/index.js';
import { PatternScanner } from './security/index.js';

export interface SkillForgeConfig {
  /** Resolved absolute paths, deduplicated, in priority order. */
  folders: string[];
  /** Cache TTL in milliseconds. */
  ttlMs: number;
}

const DEFAULT_TTL_MS = 300_000;

function parseFolders(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce<string[]>((acc, p) => {
      const abs = resolve(p);
      if (!acc.includes(abs)) acc.push(abs);
      return acc;
    }, []);
}

function parseTtl(raw: string | undefined): number {
  if (!raw) return DEFAULT_TTL_MS;
  const n = Number(raw);
  if (Number.isNaN(n) || n <= 0) return DEFAULT_TTL_MS;
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SkillForgeConfig {
  const folders = parseFolders(env['SKILLFORGE_FOLDERS']);
  const defaultFolder = join(homedir(), '.claude', 'plugins', 'cache', 'claude-code-skills');

  return {
    folders: folders.length > 0 ? folders : [defaultFolder],
    ttlMs: parseTtl(env['SKILLFORGE_TTL_MS']),
  };
}

export interface ResolvedConfig {
  /** Folders ultimately used by the server (env override > persisted folders > built-in default). */
  folders: string[];
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

  const envFolders = parseFolders(env['SKILLFORGE_FOLDERS']);
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

  return {
    folders,
    ttlMs: parseTtl(env['SKILLFORGE_TTL_MS']),
    persisted,
  };
}

/** Build a PatternScanner from persisted security settings, or null if auto-audit is off
 *  or the patterns list is empty. */
export function buildPatternScanner(persisted: PersistedConfig): PatternScanner | null {
  if (!persisted.security.autoAudit || persisted.security.auditPatterns.length === 0) {
    return null;
  }
  return new PatternScanner({ patterns: persisted.security.auditPatterns });
}
