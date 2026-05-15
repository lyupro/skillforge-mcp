/**
 * Claude Code installer — edits ~/.claude.json mcpServers.skillforge.
 *
 * Claude Code stores its host-level MCP server registry in a single JSON
 * file at ~/.claude.json across all OSes. The installer detects presence
 * of either the `claude` binary or that file, then merges the SkillForge
 * entry under `mcpServers.skillforge`.
 */

import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { readJsonSafe, writeJsonAtomic } from './atomic-write.js';
import { claudeConfigPath, defaultBinaryPath } from './paths.js';
import type {
  Installer,
  InstallOptions,
  InstallResult,
  PreviewResult,
  UninstallResult,
} from './types.js';

const SKILL_KEY = 'skillforge';
const NPX_PKG = '@lyupro/skillforge-mcp';

export interface ClaudeInstallerPathOverrides {
  configPath?: string;
  binaryPath?: string;
  binaryProbe?: () => boolean;
}

interface ClaudeConfig {
  mcpServers?: Record<string, ServerEntry>;
  [key: string]: unknown;
}

interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function buildEntry(opts: InstallOptions, binaryFallback: string): ServerEntry {
  if (opts.entry === 'npx') {
    return { command: 'npx', args: ['-y', NPX_PKG, 'serve'] };
  }
  const binary = opts.binaryPath ?? binaryFallback;
  return { command: 'node', args: [binary] };
}

function probeClaudeBinary(): boolean {
  try {
    const result = spawnSync('claude', ['--version'], { stdio: 'ignore' });
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

export class ClaudeInstaller implements Installer {
  readonly name = 'claude';
  readonly #configPath: string;
  readonly #binaryFallback: string;
  readonly #probe: () => boolean;

  constructor(overrides: ClaudeInstallerPathOverrides = {}) {
    this.#configPath = overrides.configPath ?? claudeConfigPath();
    this.#binaryFallback = overrides.binaryPath ?? defaultBinaryPath();
    this.#probe = overrides.binaryProbe ?? probeClaudeBinary;
  }

  async detect(): Promise<boolean> {
    if (this.#probe()) return true;
    return fileExists(this.#configPath);
  }

  async install(opts: InstallOptions): Promise<InstallResult> {
    const existing = ((await readJsonSafe(this.#configPath)) as ClaudeConfig | null) ?? {};
    const servers = existing.mcpServers ?? {};
    const entry = buildEntry(opts, this.#binaryFallback);

    if (servers[SKILL_KEY] !== undefined && opts.force !== true) {
      return {
        tool: this.name,
        status: 'already-installed',
        configPath: this.#configPath,
        message: `SkillForge entry already present; pass --force to overwrite`,
      };
    }

    const next: ClaudeConfig = {
      ...existing,
      mcpServers: { ...servers, [SKILL_KEY]: entry },
    };
    await writeJsonAtomic(this.#configPath, next);
    const status = servers[SKILL_KEY] !== undefined ? 'updated' : 'installed';
    return { tool: this.name, status, configPath: this.#configPath };
  }

  async uninstall(): Promise<UninstallResult> {
    const existing = (await readJsonSafe(this.#configPath)) as ClaudeConfig | null;
    if (existing === null || existing.mcpServers === undefined || existing.mcpServers[SKILL_KEY] === undefined) {
      return {
        tool: this.name,
        status: 'not-installed',
        configPath: this.#configPath,
      };
    }
    const { [SKILL_KEY]: _drop, ...rest } = existing.mcpServers;
    const next: ClaudeConfig = { ...existing, mcpServers: rest };
    await writeJsonAtomic(this.#configPath, next);
    return { tool: this.name, status: 'uninstalled', configPath: this.#configPath };
  }

  async preview(opts: InstallOptions & { action: 'install' | 'uninstall' }): Promise<PreviewResult> {
    const existing = (await readJsonSafe(this.#configPath)) as ClaudeConfig | null;
    const before = existing === null ? null : JSON.stringify(existing, null, 2);

    let nextValue: ClaudeConfig;
    if (opts.action === 'install') {
      const base = existing ?? {};
      const servers = base.mcpServers ?? {};
      const entry = buildEntry(opts, this.#binaryFallback);
      nextValue = { ...base, mcpServers: { ...servers, [SKILL_KEY]: entry } };
    } else {
      if (existing === null || existing.mcpServers === undefined) {
        nextValue = existing ?? {};
      } else {
        const { [SKILL_KEY]: _drop, ...rest } = existing.mcpServers;
        nextValue = { ...existing, mcpServers: rest };
      }
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
