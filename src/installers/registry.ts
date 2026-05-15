/**
 * Installer registry — stable enumeration of the three host installers
 * consumed by the `--all` dispatcher and by --claude / --codex / --cursor.
 */

import { ClaudeInstaller } from './claude-installer.js';
import { CodexInstaller } from './codex-installer.js';
import { CursorInstaller } from './cursor-installer.js';
import { resolveConfigPath, type HostName, type Scope } from './paths.js';
import type { Installer } from './types.js';

/**
 * Build a single installer for `host`, with its config path resolved for the
 * given scope. The resolved path is threaded into the existing `configPath`
 * constructor override — installer merge / atomic-write logic is unchanged.
 */
export function getInstallerByName(
  name: HostName,
  scope: Scope = 'global',
  projectRoot?: string,
): Installer {
  const configPath = resolveConfigPath(name, scope, projectRoot);
  if (name === 'claude') return new ClaudeInstaller({ configPath });
  if (name === 'codex') return new CodexInstaller({ configPath });
  return new CursorInstaller({ configPath });
}

export function getAllInstallers(
  scope: Scope = 'global',
  projectRoot?: string,
): Installer[] {
  return (['claude', 'codex', 'cursor'] as const).map((name) =>
    getInstallerByName(name, scope, projectRoot),
  );
}
