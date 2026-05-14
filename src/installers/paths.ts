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

export interface PathOverrides {
  claudeConfigPath: string;
  codexConfigPath: string;
  cursorSettingsPath: string;
  defaultBinaryPath: string;
}

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
