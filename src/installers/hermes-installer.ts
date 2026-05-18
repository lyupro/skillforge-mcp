/**
 * Hermes installer — edits the Hermes config (YAML) mcp_servers.skillforge.
 *
 * Hermes stores its config as YAML at ~/.hermes/config.yaml (or
 * $HERMES_HOME/config.yaml). MCP servers live under the top-level
 * `mcp_servers` map; an unrelated top-level `mcp:` key holds the LLM
 * provider config and is never touched here.
 *
 * The config is round-tripped through the `yaml` Document API so existing
 * entries, the `mcp:` block, and operator comments survive a load/save.
 */

import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { Document, parseDocument } from 'yaml';
import { readTextSafe, writeTextAtomic } from './atomic-write.js';
import { hermesConfigPath, defaultBinaryPath } from './paths.js';
import { buildEntry } from './entry.js';
import type {
  Installer,
  InstallOptions,
  InstallResult,
  PreviewResult,
  UninstallResult,
} from './types.js';

const SKILL_KEY = 'skillforge';
const MCP_SERVERS_KEY = 'mcp_servers';

// Hermes-specific connection knobs (seconds). Hermes expects these on the
// server entry; the Claude / Codex / Cursor schemas have no such fields.
const HERMES_TIMEOUT = 120;
const HERMES_CONNECT_TIMEOUT = 60;

export interface HermesInstallerPathOverrides {
  configPath?: string;
  binaryPath?: string;
  binaryProbe?: () => boolean;
}

/** The full skillforge entry written under mcp_servers in the Hermes config. */
interface HermesServerEntry {
  command: string;
  args: string[];
  enabled: boolean;
  timeout: number;
  connect_timeout: number;
}

function buildHermesEntry(opts: InstallOptions, binaryFallback: string): HermesServerEntry {
  const entry = buildEntry(opts, binaryFallback);
  return {
    command: entry.command,
    args: entry.args,
    enabled: true,
    timeout: HERMES_TIMEOUT,
    connect_timeout: HERMES_CONNECT_TIMEOUT,
  };
}

function probeHermesBinary(): boolean {
  try {
    const result = spawnSync('hermes', ['--version'], { stdio: 'ignore' });
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

/**
 * Parse the config text into a yaml Document. An empty or missing file
 * yields a fresh empty-map document. Corrupt YAML throws a clear error so
 * the installer fails fast rather than overwriting a half-written file.
 */
function parseConfig(raw: string | null, configPath: string): Document {
  if (raw === null || raw.trim() === '') return new Document({});
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new Error(
      `Hermes config at "${configPath}" is not valid YAML: ${doc.errors[0].message}`,
    );
  }
  return doc;
}

export class HermesInstaller implements Installer {
  readonly name = 'hermes';
  readonly #configPath: string;
  readonly #binaryFallback: string;
  readonly #probe: () => boolean;

  constructor(overrides: HermesInstallerPathOverrides = {}) {
    this.#configPath = overrides.configPath ?? hermesConfigPath();
    this.#binaryFallback = overrides.binaryPath ?? defaultBinaryPath();
    this.#probe = overrides.binaryProbe ?? probeHermesBinary;
  }

  async detect(): Promise<boolean> {
    if (this.#probe()) return true;
    return fileExists(this.#configPath);
  }

  async install(opts: InstallOptions): Promise<InstallResult> {
    const raw = await readTextSafe(this.#configPath);
    const doc = parseConfig(raw, this.#configPath);
    const exists = doc.hasIn([MCP_SERVERS_KEY, SKILL_KEY]);

    if (exists && opts.force !== true) {
      return {
        tool: this.name,
        status: 'already-installed',
        configPath: this.#configPath,
        message: `SkillForge entry already present; pass --force to overwrite`,
      };
    }

    doc.setIn([MCP_SERVERS_KEY, SKILL_KEY], buildHermesEntry(opts, this.#binaryFallback));
    await writeTextAtomic(this.#configPath, doc.toString());
    return {
      tool: this.name,
      status: exists ? 'updated' : 'installed',
      configPath: this.#configPath,
    };
  }

  async uninstall(): Promise<UninstallResult> {
    const raw = await readTextSafe(this.#configPath);
    if (raw === null) {
      return { tool: this.name, status: 'not-installed', configPath: this.#configPath };
    }
    const doc = parseConfig(raw, this.#configPath);
    if (!doc.hasIn([MCP_SERVERS_KEY, SKILL_KEY])) {
      return { tool: this.name, status: 'not-installed', configPath: this.#configPath };
    }
    doc.deleteIn([MCP_SERVERS_KEY, SKILL_KEY]);
    await writeTextAtomic(this.#configPath, doc.toString());
    return { tool: this.name, status: 'uninstalled', configPath: this.#configPath };
  }

  async preview(opts: InstallOptions & { action: 'install' | 'uninstall' }): Promise<PreviewResult> {
    const raw = await readTextSafe(this.#configPath);
    const doc = parseConfig(raw, this.#configPath);

    if (opts.action === 'install') {
      doc.setIn([MCP_SERVERS_KEY, SKILL_KEY], buildHermesEntry(opts, this.#binaryFallback));
    } else if (doc.hasIn([MCP_SERVERS_KEY, SKILL_KEY])) {
      doc.deleteIn([MCP_SERVERS_KEY, SKILL_KEY]);
    }

    return {
      tool: this.name,
      configPath: this.#configPath,
      willCreate: raw === null,
      before: raw,
      after: doc.toString(),
      action: opts.action,
    };
  }
}
