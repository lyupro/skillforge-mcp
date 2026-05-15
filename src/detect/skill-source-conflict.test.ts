import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  detectSkillSourceConflict,
  formatConflictHint,
} from './skill-source-conflict.js';

/**
 * Detection is pure path logic — a fake home dir is injected so the tests
 * never touch a real `~/.claude` or `~/.gemini`. The fake root need not
 * exist on disk because the detector reads no files.
 */
const FAKE_HOME = join('/tmp', 'sf-fake-home');

describe('detectSkillSourceConflict', () => {
  it('detects a Claude Code plugin cache path', () => {
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
    const conflict = detectSkillSourceConflict(folder, FAKE_HOME);
    expect(conflict).not.toBeNull();
    expect(conflict!.host).toBe('claude');
    expect(conflict!.kind).toBe('plugin');
    expect(conflict!.name).toBe('omc-marketplace/oh-my-claudecode');
  });

  it('detects a Gemini CLI extension path', () => {
    const folder = join(FAKE_HOME, '.gemini', 'extensions', 'my-extension', 'skills');
    const conflict = detectSkillSourceConflict(folder, FAKE_HOME);
    expect(conflict).not.toBeNull();
    expect(conflict!.host).toBe('gemini');
    expect(conflict!.kind).toBe('extension');
    expect(conflict!.name).toBe('my-extension');
  });

  it('returns null for an unrelated path', () => {
    const folder = join(FAKE_HOME, '.lyupro', 'skills');
    expect(detectSkillSourceConflict(folder, FAKE_HOME)).toBeNull();
  });

  it('returns null for a Codex-style config path (no native skill system)', () => {
    const folder = join(FAKE_HOME, '.codex', 'skills');
    expect(detectSkillSourceConflict(folder, FAKE_HOME)).toBeNull();
  });

  it('returns null for a Cursor-style config path (no native skill system)', () => {
    const folder = join(FAKE_HOME, '.cursor', 'extensions', 'something');
    expect(detectSkillSourceConflict(folder, FAKE_HOME)).toBeNull();
  });

  it('returns null for the cache root itself with no plugin segment', () => {
    const folder = join(FAKE_HOME, '.claude', 'plugins', 'cache');
    expect(detectSkillSourceConflict(folder, FAKE_HOME)).toBeNull();
  });

  it('returns null for a non-cache path under ~/.claude', () => {
    const folder = join(FAKE_HOME, '.claude', 'projects', 'foo');
    expect(detectSkillSourceConflict(folder, FAKE_HOME)).toBeNull();
  });
});

describe('formatConflictHint', () => {
  it('builds the Claude Code hint with the /plugin disable path', () => {
    const folder = join(
      FAKE_HOME,
      '.claude',
      'plugins',
      'cache',
      'omc-marketplace',
      'oh-my-claudecode',
      '1.2.3',
    );
    const conflict = detectSkillSourceConflict(folder, FAKE_HOME)!;
    const hint = formatConflictHint(conflict);
    expect(hint).toContain('Claude Code plugin');
    expect(hint).toContain('omc-marketplace/oh-my-claudecode');
    expect(hint).toContain('/plugin');
    expect(hint).toContain('loading these skills twice');
  });

  it('builds the Gemini hint with the /extensions disable command', () => {
    const folder = join(FAKE_HOME, '.gemini', 'extensions', 'my-extension');
    const conflict = detectSkillSourceConflict(folder, FAKE_HOME)!;
    const hint = formatConflictHint(conflict);
    expect(hint).toContain('Gemini CLI extension');
    expect(hint).toContain('/extensions disable my-extension');
  });
});
