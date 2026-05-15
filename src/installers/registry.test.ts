import { describe, it, expect } from 'vitest';
import { getAllInstallers, getInstallerByName } from './registry.js';

describe('getAllInstallers', () => {
  it('returns three installers in claude/codex/cursor order', () => {
    const list = getAllInstallers();
    expect(list).toHaveLength(3);
    expect(list.map((i) => i.name)).toEqual(['claude', 'codex', 'cursor']);
  });

  it('each installer exposes the full contract', () => {
    for (const inst of getAllInstallers()) {
      expect(typeof inst.detect).toBe('function');
      expect(typeof inst.install).toBe('function');
      expect(typeof inst.uninstall).toBe('function');
      expect(typeof inst.preview).toBe('function');
    }
  });
});

describe('getInstallerByName', () => {
  it('returns the matching installer for each name', () => {
    expect(getInstallerByName('claude').name).toBe('claude');
    expect(getInstallerByName('codex').name).toBe('codex');
    expect(getInstallerByName('cursor').name).toBe('cursor');
  });

  it('defaults to global scope when no scope is given', () => {
    // No throw — global scope needs no project root validation.
    expect(getInstallerByName('claude').name).toBe('claude');
  });

  it('accepts an explicit project scope with a valid root', () => {
    expect(getInstallerByName('claude', 'project', process.cwd()).name).toBe('claude');
  });
});

describe('getAllInstallers with scope', () => {
  it('global scope returns three installers', () => {
    expect(getAllInstallers('global').map((i) => i.name)).toEqual([
      'claude',
      'codex',
      'cursor',
    ]);
  });

  it('project scope returns three installers for a valid root', () => {
    expect(getAllInstallers('project', process.cwd())).toHaveLength(3);
  });
});
