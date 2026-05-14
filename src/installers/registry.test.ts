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
});
