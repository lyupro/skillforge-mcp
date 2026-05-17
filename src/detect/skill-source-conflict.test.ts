import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import {
  detectSkillSourceConflict,
  formatConflictHint,
  type PluginEnabledState,
} from './skill-source-conflict.js';

/**
 * Injectable resolver factories for tests — no real ~/.claude files touched.
 */
const FAKE_HOME = join('/tmp', 'sf-fake-home');

function stateResolver(
  state: PluginEnabledState,
): (_home: string, _key: string) => Promise<PluginEnabledState> {
  return async () => state;
}

describe('detectSkillSourceConflict — Claude Code plugin', () => {
  const folder = join(
    FAKE_HOME,
    '.claude',
    'plugins',
    'cache',
    'omc-marketplace',
    'oh-my-claudecode',
    '1.2.3',
    'skills',
  );

  it('returns null when plugin is DISABLED', async () => {
    const result = await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('disabled'));
    expect(result).toBeNull();
  });

  it('returns descriptor with enabledState=enabled when plugin is ENABLED', async () => {
    const result = await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('enabled'));
    expect(result).not.toBeNull();
    expect(result!.host).toBe('claude');
    expect(result!.kind).toBe('plugin');
    expect(result!.name).toBe('omc-marketplace/oh-my-claudecode');
    expect(result!.enabledState).toBe('enabled');
  });

  it('returns descriptor with enabledState=unknown when state is unknown', async () => {
    const result = await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('unknown'));
    expect(result).not.toBeNull();
    expect(result!.enabledState).toBe('unknown');
  });
});

describe('detectSkillSourceConflict — Gemini CLI extension', () => {
  it('returns descriptor with enabledState=unknown (no state API)', async () => {
    const folder = join(FAKE_HOME, '.gemini', 'extensions', 'my-extension', 'skills');
    const result = await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('enabled'));
    expect(result).not.toBeNull();
    expect(result!.host).toBe('gemini');
    expect(result!.kind).toBe('extension');
    expect(result!.name).toBe('my-extension');
    expect(result!.enabledState).toBe('unknown');
  });
});

describe('detectSkillSourceConflict — unrelated paths', () => {
  it('returns null for an unrelated path', async () => {
    const folder = join(FAKE_HOME, '.lyupro', 'skills');
    expect(await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('enabled'))).toBeNull();
  });

  it('returns null for a Codex-style config path (no native skill system)', async () => {
    const folder = join(FAKE_HOME, '.codex', 'skills');
    expect(await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('enabled'))).toBeNull();
  });

  it('returns null for a Cursor-style config path (no native skill system)', async () => {
    const folder = join(FAKE_HOME, '.cursor', 'extensions', 'something');
    expect(await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('enabled'))).toBeNull();
  });

  it('returns null for the cache root itself with no plugin segment', async () => {
    const folder = join(FAKE_HOME, '.claude', 'plugins', 'cache');
    expect(await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('enabled'))).toBeNull();
  });

  it('returns null for a non-cache path under ~/.claude', async () => {
    const folder = join(FAKE_HOME, '.claude', 'projects', 'foo');
    expect(await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('enabled'))).toBeNull();
  });
});

describe('formatConflictHint', () => {
  const baseFolder = join(
    FAKE_HOME,
    '.claude',
    'plugins',
    'cache',
    'omc-marketplace',
    'oh-my-claudecode',
    '1.2.3',
  );

  it('uses direct "disable it" wording for enabledState=enabled', async () => {
    const conflict = await detectSkillSourceConflict(
      baseFolder,
      FAKE_HOME,
      stateResolver('enabled'),
    );
    const hint = formatConflictHint(conflict!);
    expect(hint).toContain('Claude Code plugin');
    expect(hint).toContain('omc-marketplace/oh-my-claudecode');
    expect(hint).toContain('/plugin');
    expect(hint).toContain('loading these skills twice');
    expect(hint).not.toContain('IF that');
  });

  it('uses conditional "IF enabled" wording for enabledState=unknown', async () => {
    const conflict = await detectSkillSourceConflict(
      baseFolder,
      FAKE_HOME,
      stateResolver('unknown'),
    );
    const hint = formatConflictHint(conflict!);
    expect(hint).toContain('IF that plugin is enabled');
    expect(hint).toContain('/plugin');
    expect(hint).not.toContain('loading these skills twice');
  });

  it('uses conditional wording for Gemini (always unknown)', async () => {
    const folder = join(FAKE_HOME, '.gemini', 'extensions', 'my-extension');
    const conflict = await detectSkillSourceConflict(folder, FAKE_HOME, stateResolver('enabled'));
    const hint = formatConflictHint(conflict!);
    expect(hint).toContain('Gemini CLI extension');
    expect(hint).toContain('IF that extension is enabled');
    expect(hint).toContain('/extensions disable my-extension');
  });

  it('builds the Claude Code hint with the /plugin disable path (enabled)', async () => {
    const conflict = await detectSkillSourceConflict(
      baseFolder,
      FAKE_HOME,
      stateResolver('enabled'),
    );
    const hint = formatConflictHint(conflict!);
    expect(hint).toContain('Claude Code plugin');
    expect(hint).toContain('omc-marketplace/oh-my-claudecode');
    expect(hint).toContain('/plugin');
  });
});

describe('detectSkillSourceConflict — default settings reader degrades gracefully', () => {
  it('returns unknown (not throw) when ~/.claude/settings.json does not exist', async () => {
    const nonExistentHome = join('/tmp', 'sf-no-such-home-' + Date.now());
    const folder = join(
      nonExistentHome,
      '.claude',
      'plugins',
      'cache',
      'mkt',
      'myplugin',
      '0.0.1',
    );
    // Use default resolver — it will try to read a non-existent file
    const result = await detectSkillSourceConflict(folder, nonExistentHome);
    // Should not throw; if file doesn't exist → unknown → returns descriptor
    expect(result).not.toBeNull();
    expect(result!.enabledState).toBe('unknown');
    expect(result!.host).toBe('claude');
  });
});
