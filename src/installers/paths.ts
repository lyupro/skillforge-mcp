/**
 * Config path helpers for host tools.
 *
 * Per repo convention, all SkillForge config paths use `os.homedir()`
 * exclusively — no platform branching. Every host (Claude Code, Codex CLI,
 * Cursor) stores its MCP config in a homedir-rooted file uniform across OSes.
 */

import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

export interface PathOverrides {
  claudeConfigPath: string;
  codexConfigPath: string;
  cursorConfigPath: string;
  defaultBinaryPath: string;
}

/**
 * Install scope. `global` edits the host's home-directory config (the
 * historical default); `project` edits a config file rooted at the current
 * working directory so a single repo can opt into SkillForge.
 */
export type Scope = 'global' | 'project';

export type HostName = 'claude' | 'codex' | 'cursor';

export function claudeConfigPath(): string {
  return join(homedir(), '.claude.json');
}

export function codexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml');
}

// Cursor reads its global MCP server registry from ~/.cursor/mcp.json on
// every OS — the same top-level `mcpServers` shape as ~/.claude.json. This
// is distinct from Cursor's VS Code-style `settings.json`, which Cursor
// does NOT read MCP servers from.
export function cursorConfigPath(): string {
  return join(homedir(), '.cursor', 'mcp.json');
}

// Fallback `--entry local` target when --binary-path is not supplied.
// Resolves to <package root>/dist/server.js via import.meta.url so the
// path works whether the file is executed from dist/ or src/ (tsx).
export function defaultBinaryPath(): string {
  const here = fileURLToPath(import.meta.url);
  // here = <root>/(dist|src)/installers/paths.(js|ts)
  // Resolve up three segments to reach the package root, then dist/server.js.
  return resolve(here, '..', '..', '..', 'dist', 'server.js');
}

export function defaultPaths(): PathOverrides {
  return {
    claudeConfigPath: claudeConfigPath(),
    codexConfigPath: codexConfigPath(),
    cursorConfigPath: cursorConfigPath(),
    defaultBinaryPath: defaultBinaryPath(),
  };
}

// --- Project-scoped config paths -------------------------------------------
//
// `--scope project` targets a config file rooted at the current working
// directory instead of the home directory. The internal file shapes are
// identical to the global counterparts, so the same installer + atomic-write
// + merge logic applies unchanged — only the resolved path differs.

// Claude Code reads project-local MCP servers from `.mcp.json` at the repo
// root, with the same top-level `mcpServers` map as `~/.claude.json`.
export function claudeProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, '.mcp.json');
}

// Codex CLI reads project-local config from `.codex/config.toml`, same
// `[mcp_servers.<name>]` table shape as `~/.codex/config.toml`.
export function codexProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, '.codex', 'config.toml');
}

// Cursor reads project-local MCP servers from `.cursor/mcp.json`, the same
// top-level `mcpServers` JSON shape as the global `~/.cursor/mcp.json`, so
// the existing merge logic is reused verbatim.
export function cursorProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, '.cursor', 'mcp.json');
}

/**
 * Validate that `projectRoot` is a usable directory for `--scope project`.
 * Throws a clear error otherwise (caller maps this to a non-zero exit).
 */
export function assertProjectRoot(projectRoot: string): void {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(projectRoot);
  } catch {
    throw new Error(
      `--scope project: cannot resolve a project root at "${projectRoot}" (path does not exist)`,
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(
      `--scope project: project root "${projectRoot}" is not a directory`,
    );
  }
}

/**
 * Resolve the config path for a host under the given scope.
 *
 * - `global` → the host's home-directory config (historical default).
 * - `project` → the host's repo-local config rooted at `projectRoot`
 *   (defaults to `process.cwd()`). Validates the root first.
 */
export function resolveConfigPath(
  host: HostName,
  scope: Scope,
  projectRoot: string = process.cwd(),
): string {
  if (scope === 'global') {
    if (host === 'claude') return claudeConfigPath();
    if (host === 'codex') return codexConfigPath();
    return cursorConfigPath();
  }
  assertProjectRoot(projectRoot);
  if (host === 'claude') return claudeProjectConfigPath(projectRoot);
  if (host === 'codex') return codexProjectConfigPath(projectRoot);
  return cursorProjectConfigPath(projectRoot);
}
