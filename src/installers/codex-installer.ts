/**
 * Codex CLI installer — edits ~/.codex/config.toml [mcp_servers.skillforge].
 *
 * Codex stores MCP servers in TOML at ~/.codex/config.toml under a
 * `[mcp_servers.<name>]` table. SkillForge's table shape is:
 *
 *   [mcp_servers.skillforge]
 *   command = "npx"
 *   args = ["-y", "@lyupro/skillforge-mcp"]
 *
 * Per the Codex MCP reference (developers.openai.com/codex/mcp).
 */

import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { readTomlSafe, writeTomlAtomic } from './atomic-write.js';
import { codexConfigPath, defaultBinaryPath } from './paths.js';
import { buildEntry, type ServerEntry } from './entry.js';
import type {
  Installer,
  InstallOptions,
  InstallResult,
  PreviewResult,
  UninstallResult,
} from './types.js';

const SKILL_KEY = 'skillforge';

export interface CodexInstallerPathOverrides {
  configPath?: string;
  binaryPath?: string;
  binaryProbe?: () => boolean;
}

interface CodexConfig {
  mcp_servers?: Record<string, ServerEntry>;
  [key: string]: unknown;
}

function probeCodexBinary(): boolean {
  try {
    const result = spawnSync('codex', ['--version'], { stdio: 'ignore' });
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

import toml from '@iarna/toml';

function tomlStringify(obj: Record<string, unknown>): string {
  return toml.stringify(obj as toml.JsonMap);
}

export class CodexInstaller implements Installer {
  readonly name = 'codex';
  readonly #configPath: string;
  readonly #binaryFallback: string;
  readonly #probe: () => boolean;

  constructor(overrides: CodexInstallerPathOverrides = {}) {
    this.#configPath = overrides.configPath ?? codexConfigPath();
    this.#binaryFallback = overrides.binaryPath ?? defaultBinaryPath();
    this.#probe = overrides.binaryProbe ?? probeCodexBinary;
  }

  async detect(): Promise<boolean> {
    if (this.#probe()) return true;
    return fileExists(this.#configPath);
  }

  async install(opts: InstallOptions): Promise<InstallResult> {
    const existing = ((await readTomlSafe(this.#configPath)) as CodexConfig | null) ?? {};
    const servers = (existing.mcp_servers ?? {}) as Record<string, ServerEntry>;
    const entry = buildEntry(opts, this.#binaryFallback);

    if (servers[SKILL_KEY] !== undefined && opts.force !== true) {
      return {
        tool: this.name,
        status: 'already-installed',
        configPath: this.#configPath,
        message: `SkillForge entry already present; pass --force to overwrite`,
      };
    }

    const next: Record<string, unknown> = {
      ...existing,
      mcp_servers: { ...servers, [SKILL_KEY]: entry },
    };
    await writeTomlAtomic(this.#configPath, next);
    const status = servers[SKILL_KEY] !== undefined ? 'updated' : 'installed';
    return { tool: this.name, status, configPath: this.#configPath };
  }

  async uninstall(): Promise<UninstallResult> {
    const existing = (await readTomlSafe(this.#configPath)) as CodexConfig | null;
    if (existing === null || existing.mcp_servers === undefined || existing.mcp_servers[SKILL_KEY] === undefined) {
      return {
        tool: this.name,
        status: 'not-installed',
        configPath: this.#configPath,
      };
    }
    const { [SKILL_KEY]: _drop, ...rest } = existing.mcp_servers;
    const next: Record<string, unknown> = { ...existing, mcp_servers: rest };
    await writeTomlAtomic(this.#configPath, next);
    return { tool: this.name, status: 'uninstalled', configPath: this.#configPath };
  }

  async preview(opts: InstallOptions & { action: 'install' | 'uninstall' }): Promise<PreviewResult> {
    const existing = (await readTomlSafe(this.#configPath)) as CodexConfig | null;
    const before = existing === null ? null : tomlStringify(existing as Record<string, unknown>);

    let nextValue: Record<string, unknown>;
    if (opts.action === 'install') {
      const base = (existing ?? {}) as CodexConfig;
      const servers = (base.mcp_servers ?? {}) as Record<string, ServerEntry>;
      const entry = buildEntry(opts, this.#binaryFallback);
      nextValue = { ...base, mcp_servers: { ...servers, [SKILL_KEY]: entry } };
    } else {
      if (existing === null || existing.mcp_servers === undefined) {
        nextValue = (existing ?? {}) as Record<string, unknown>;
      } else {
        const { [SKILL_KEY]: _drop, ...rest } = existing.mcp_servers;
        nextValue = { ...existing, mcp_servers: rest };
      }
    }

    return {
      tool: this.name,
      configPath: this.#configPath,
      willCreate: existing === null,
      before,
      after: tomlStringify(nextValue),
      action: opts.action,
    };
  }
}
