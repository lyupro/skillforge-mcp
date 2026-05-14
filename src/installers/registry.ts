/**
 * Installer registry — stable enumeration of the three host installers
 * consumed by the `--all` dispatcher and by --claude / --codex / --cursor.
 */

import { ClaudeInstaller } from './claude-installer.js';
import { CodexInstaller } from './codex-installer.js';
import { CursorInstaller } from './cursor-installer.js';
import type { Installer } from './types.js';

export function getAllInstallers(): Installer[] {
  return [new ClaudeInstaller(), new CodexInstaller(), new CursorInstaller()];
}

export function getInstallerByName(name: 'claude' | 'codex' | 'cursor'): Installer {
  if (name === 'claude') return new ClaudeInstaller();
  if (name === 'codex') return new CodexInstaller();
  return new CursorInstaller();
}
