import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('paths', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('exposes the four expected helpers', async () => {
    const mod = await import('./paths.js');
    expect(typeof mod.claudeConfigPath).toBe('function');
    expect(typeof mod.codexConfigPath).toBe('function');
    expect(typeof mod.cursorConfigPath).toBe('function');
    expect(typeof mod.defaultBinaryPath).toBe('function');
    expect(typeof mod.defaultPaths).toBe('function');
  });

  it('claudeConfigPath resolves under homedir as .claude.json', async () => {
    const { claudeConfigPath } = await import('./paths.js');
    const { homedir } = await import('node:os');
    const p = claudeConfigPath();
    expect(p.startsWith(homedir())).toBe(true);
    expect(p.endsWith('.claude.json')).toBe(true);
  });

  it('codexConfigPath resolves under homedir/.codex/config.toml', async () => {
    const { codexConfigPath } = await import('./paths.js');
    const { homedir } = await import('node:os');
    const p = codexConfigPath();
    expect(p.startsWith(homedir())).toBe(true);
    expect(p.replace(/\\/g, '/').endsWith('/.codex/config.toml')).toBe(true);
  });

  it('cursorConfigPath resolves under homedir/.cursor/mcp.json', async () => {
    const { cursorConfigPath } = await import('./paths.js');
    const { homedir } = await import('node:os');
    const p = cursorConfigPath();
    expect(p.startsWith(homedir())).toBe(true);
    expect(p.replace(/\\/g, '/').endsWith('/.cursor/mcp.json')).toBe(true);
  });

  it('defaultBinaryPath ends with dist/server.js', async () => {
    const { defaultBinaryPath } = await import('./paths.js');
    const p = defaultBinaryPath().replace(/\\/g, '/');
    expect(p.endsWith('/dist/server.js')).toBe(true);
  });

  it('defaultPaths returns all four resolved paths', async () => {
    const { defaultPaths } = await import('./paths.js');
    const all = defaultPaths();
    expect(typeof all.claudeConfigPath).toBe('string');
    expect(typeof all.codexConfigPath).toBe('string');
    expect(typeof all.cursorConfigPath).toBe('string');
    expect(typeof all.defaultBinaryPath).toBe('string');
  });
});

describe('project-scoped paths', () => {
  it('claudeProjectConfigPath resolves to <root>/.mcp.json', async () => {
    const { claudeProjectConfigPath } = await import('./paths.js');
    const p = claudeProjectConfigPath('/repo').replace(/\\/g, '/');
    expect(p).toBe('/repo/.mcp.json');
  });

  it('codexProjectConfigPath resolves to <root>/.codex/config.toml', async () => {
    const { codexProjectConfigPath } = await import('./paths.js');
    const p = codexProjectConfigPath('/repo').replace(/\\/g, '/');
    expect(p).toBe('/repo/.codex/config.toml');
  });

  it('cursorProjectConfigPath resolves to <root>/.cursor/mcp.json', async () => {
    const { cursorProjectConfigPath } = await import('./paths.js');
    const p = cursorProjectConfigPath('/repo').replace(/\\/g, '/');
    expect(p).toBe('/repo/.cursor/mcp.json');
  });
});

describe('assertProjectRoot', () => {
  it('passes for an existing directory', async () => {
    const { assertProjectRoot } = await import('./paths.js');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'skillforge-root-'));
    try {
      expect(() => assertProjectRoot(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when the path does not exist', async () => {
    const { assertProjectRoot } = await import('./paths.js');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    expect(() => assertProjectRoot(join(tmpdir(), 'skillforge-missing-xyz'))).toThrow(
      /does not exist/,
    );
  });

  it('throws when the path is a file, not a directory', async () => {
    const { assertProjectRoot } = await import('./paths.js');
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'skillforge-root-'));
    const file = join(dir, 'a-file');
    writeFileSync(file, 'x');
    try {
      expect(() => assertProjectRoot(file)).toThrow(/not a directory/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveConfigPath', () => {
  it('global scope routes to home-directory config per host', async () => {
    const { resolveConfigPath, claudeConfigPath, codexConfigPath } = await import('./paths.js');
    expect(resolveConfigPath('claude', 'global')).toBe(claudeConfigPath());
    expect(resolveConfigPath('codex', 'global')).toBe(codexConfigPath());
  });

  it('project scope routes to repo-local config per host', async () => {
    const { resolveConfigPath } = await import('./paths.js');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'skillforge-root-'));
    try {
      expect(resolveConfigPath('claude', 'project', dir).replace(/\\/g, '/')).toBe(
        `${dir.replace(/\\/g, '/')}/.mcp.json`,
      );
      expect(resolveConfigPath('codex', 'project', dir).replace(/\\/g, '/')).toBe(
        `${dir.replace(/\\/g, '/')}/.codex/config.toml`,
      );
      expect(resolveConfigPath('cursor', 'project', dir).replace(/\\/g, '/')).toBe(
        `${dir.replace(/\\/g, '/')}/.cursor/mcp.json`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('project scope throws for an invalid project root', async () => {
    const { resolveConfigPath } = await import('./paths.js');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    expect(() => resolveConfigPath('claude', 'project', join(tmpdir(), 'nope-xyz'))).toThrow();
  });
});
