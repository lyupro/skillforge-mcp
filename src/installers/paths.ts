/**
 * OS-specific config path helpers for host tools.
 *
 * Per repo convention, all SkillForge config paths use `os.homedir()`
 * exclusively — no platform branching. Cursor is the exception: its
 * `settings.json` location is third-party (Cursor app), out of our
 * control, so the platform-specific dispatch here is rubric-exempt.
 */

import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

export interface PathOverrides {
  claudeConfigPath: string;
  codexConfigPath: string;
  cursorSettingsPath: string;
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

// Cursor stores its global settings.json in a per-OS application data
// directory. We follow the location documented by the Cursor app itself.
// This is the only place in the codebase where a platform branch is
// permitted, because the third-party host owns the path.
export function cursorSettingsPath(): string {
  const os = platform();
  if (os === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Cursor', 'User', 'settings.json');
  }
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
  }
  return join(homedir(), '.config', 'Cursor', 'User', 'settings.json');
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
    cursorSettingsPath: cursorSettingsPath(),
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

// Cursor reads project-local MCP servers from `.cursor/mcp.json`. We keep the
// same `mcp.servers` JSON shape used by the global Cursor installer so the
// existing merge logic is reused verbatim.
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
    return cursorSettingsPath();
  }
  assertProjectRoot(projectRoot);
  if (host === 'claude') return claudeProjectConfigPath(projectRoot);
  if (host === 'codex') return codexProjectConfigPath(projectRoot);
  return cursorProjectConfigPath(projectRoot);
}
