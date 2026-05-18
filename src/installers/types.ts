/**
 * Shared types for the install CLI (v1.1).
 *
 * Each host tool (Claude Code / Codex CLI / Cursor) ships an Installer
 * implementing this contract so the CLI dispatcher can iterate them
 * uniformly under `--all`, `--dry-run`, and `--uninstall`.
 */

export type EntryKind = 'npx' | 'local' | 'auto';

export interface InstallOptions {
  entry: EntryKind;
  binaryPath?: string;
  force?: boolean;
}

export type InstallStatus =
  | 'installed'
  | 'already-installed'
  | 'updated'
  | 'skipped';

export type UninstallStatus = 'uninstalled' | 'not-installed';

export interface InstallResult {
  tool: string;
  status: InstallStatus;
  configPath: string;
  message?: string;
}

export interface UninstallResult {
  tool: string;
  status: UninstallStatus;
  configPath: string;
  message?: string;
}

export interface PreviewResult {
  tool: string;
  configPath: string;
  willCreate: boolean;
  before: string | null;
  after: string;
  action: 'install' | 'uninstall';
}

export interface Installer {
  readonly name: string;
  detect(): Promise<boolean>;
  install(opts: InstallOptions): Promise<InstallResult>;
  uninstall(): Promise<UninstallResult>;
  preview(opts: InstallOptions & { action: 'install' | 'uninstall' }): Promise<PreviewResult>;
}
