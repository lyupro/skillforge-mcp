/**
 * Cursor installer — edits Cursor's settings.json mcp.servers.skillforge.
 *
 * Cursor stores its global settings JSON at an OS-specific path:
 *   Windows: %APPDATA%/Cursor/User/settings.json
 *   macOS:   ~/Library/Application Support/Cursor/User/settings.json
 *   Linux:   ~/.config/Cursor/User/settings.json
 *
 * The MCP server registry lives under `mcp.servers.<name>` with the same
 * { command, args, env? } shape used by Claude Code.
 */

import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { readJsonSafe, writeJsonAtomic } from './atomic-write.js';
import { cursorSettingsPath, defaultBinaryPath } from './paths.js';
import type {
  Installer,
  InstallOptions,
  InstallResult,
  PreviewResult,
  UninstallResult,
} from './types.js';

const SKILL_KEY = 'skillforge';
const NPX_PKG = '@lyupro/skillforge-mcp';

export interface CursorInstallerPathOverrides {
  configPath?: string;
  binaryPath?: string;
  binaryProbe?: () => boolean;
}

interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface CursorSettings {
  mcp?: { servers?: Record<string, ServerEntry> };
  [key: string]: unknown;
}

function buildEntry(opts: InstallOptions, binaryFallback: string): ServerEntry {
  if (opts.entry === 'npx') {
    return { command: 'npx', args: ['-y', NPX_PKG] };
  }
  return { command: 'node', args: [opts.binaryPath ?? binaryFallback] };
}

function probeCursorBinary(): boolean {
  try {
    const result = spawnSync('cursor', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function readSkillforge(cfg: CursorSettings): ServerEntry | undefined {
  return cfg.mcp?.servers?.[SKILL_KEY];
}

function mergeInstall(existing: CursorSettings, entry: ServerEntry): CursorSettings {
  const mcp = existing.mcp ?? {};
  const servers = mcp.servers ?? {};
  return {
    ...existing,
    mcp: { ...mcp, servers: { ...servers, [SKILL_KEY]: entry } },
  };
}

function mergeUninstall(existing: CursorSettings): CursorSettings {
  const mcp = existing.mcp;
  if (mcp === undefined || mcp.servers === undefined) return existing;
  const { [SKILL_KEY]: _drop, ...rest } = mcp.servers;
  return { ...existing, mcp: { ...mcp, servers: rest } };
}

export class CursorInstaller implements Installer {
  readonly name = 'cursor';
  readonly #configPath: string;
  readonly #binaryFallback: string;
  readonly #probe: () => boolean;

  constructor(overrides: CursorInstallerPathOverrides = {}) {
    this.#configPath = overrides.configPath ?? cursorSettingsPath();
    this.#binaryFallback = overrides.binaryPath ?? defaultBinaryPath();
    this.#probe = overrides.binaryProbe ?? probeCursorBinary;
  }

  async detect(): Promise<boolean> {
    if (this.#probe()) return true;
    return fileExists(this.#configPath);
  }

  async install(opts: InstallOptions): Promise<InstallResult> {
    const existing = ((await readJsonSafe(this.#configPath)) as CursorSettings | null) ?? {};
    const entry = buildEntry(opts, this.#binaryFallback);
    const prior = readSkillforge(existing);

    if (prior !== undefined && opts.force !== true) {
      return {
        tool: this.name,
        status: 'already-installed',
        configPath: this.#configPath,
        message: `SkillForge entry already present; pass --force to overwrite`,
      };
    }

    const next = mergeInstall(existing, entry);
    await writeJsonAtomic(this.#configPath, next);
    return {
      tool: this.name,
      status: prior !== undefined ? 'updated' : 'installed',
      configPath: this.#configPath,
    };
  }

  async uninstall(): Promise<UninstallResult> {
    const existing = (await readJsonSafe(this.#configPath)) as CursorSettings | null;
    if (existing === null || readSkillforge(existing) === undefined) {
      return { tool: this.name, status: 'not-installed', configPath: this.#configPath };
    }
    const next = mergeUninstall(existing);
    await writeJsonAtomic(this.#configPath, next);
    return { tool: this.name, status: 'uninstalled', configPath: this.#configPath };
  }

  async preview(opts: InstallOptions & { action: 'install' | 'uninstall' }): Promise<PreviewResult> {
    const existing = (await readJsonSafe(this.#configPath)) as CursorSettings | null;
    const before = existing === null ? null : JSON.stringify(existing, null, 2);

    let nextValue: CursorSettings;
    if (opts.action === 'install') {
      const base = existing ?? {};
      const entry = buildEntry(opts, this.#binaryFallback);
      nextValue = mergeInstall(base, entry);
    } else {
      nextValue = existing === null ? {} : mergeUninstall(existing);
    }

    return {
      tool: this.name,
      configPath: this.#configPath,
      willCreate: existing === null,
      before,
      after: JSON.stringify(nextValue, null, 2),
      action: opts.action,
    };
  }
}
