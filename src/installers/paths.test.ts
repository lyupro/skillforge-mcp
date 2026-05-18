import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('paths', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('exposes the host config-path helpers', async () => {
    const mod = await import('./paths.js');
    expect(typeof mod.claudeConfigPath).toBe('function');
    expect(typeof mod.codexConfigPath).toBe('function');
    expect(typeof mod.cursorConfigPath).toBe('function');
    expect(typeof mod.hermesConfigPath).toBe('function');
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

  it('hermesConfigPath resolves under homedir/.hermes/config.yaml', async () => {
    const { hermesConfigPath } = await import('./paths.js');
    const { homedir } = await import('node:os');
    const prev = process.env.HERMES_HOME;
    delete process.env.HERMES_HOME;
    try {
      const p = hermesConfigPath();
      expect(p.startsWith(homedir())).toBe(true);
      expect(p.replace(/\\/g, '/').endsWith('/.hermes/config.yaml')).toBe(true);
    } finally {
      if (prev !== undefined) process.env.HERMES_HOME = prev;
    }
  });

  it('hermesConfigPath honors HERMES_HOME when set', async () => {
    const { hermesConfigPath } = await import('./paths.js');
    const prev = process.env.HERMES_HOME;
    process.env.HERMES_HOME = '/custom/hermes-home';
    try {
      expect(hermesConfigPath().replace(/\\/g, '/')).toBe('/custom/hermes-home/config.yaml');
    } finally {
      if (prev === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prev;
    }
  });

  it('defaultBinaryPath ends with dist/cli/dispatcher.js', async () => {
    const { defaultBinaryPath } = await import('./paths.js');
    const p = defaultBinaryPath().replace(/\\/g, '/');
    expect(p.endsWith('/dist/cli/dispatcher.js')).toBe(true);
  });

  it('defaultPaths returns all four resolved paths', async () => {
    const { defaultPaths } = await import('./paths.js');
    const all = defaultPaths();
    expect(typeof all.claudeConfigPath).toBe('string');
    expect(typeof all.codexConfigPath).toBe('string');
    expect(typeof all.cursorConfigPath).toBe('string');
    expect(typeof all.hermesConfigPath).toBe('string');
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

  it('hermesProjectConfigPath resolves to <root>/.hermes/config.yaml', async () => {
    const { hermesProjectConfigPath } = await import('./paths.js');
    const p = hermesProjectConfigPath('/repo').replace(/\\/g, '/');
    expect(p).toBe('/repo/.hermes/config.yaml');
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
    const { resolveConfigPath, claudeConfigPath, codexConfigPath, cursorConfigPath, hermesConfigPath } =
      await import('./paths.js');
    expect(resolveConfigPath('claude', 'global')).toBe(claudeConfigPath());
    expect(resolveConfigPath('codex', 'global')).toBe(codexConfigPath());
    expect(resolveConfigPath('cursor', 'global')).toBe(cursorConfigPath());
    expect(resolveConfigPath('hermes', 'global')).toBe(hermesConfigPath());
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
      expect(resolveConfigPath('hermes', 'project', dir).replace(/\\/g, '/')).toBe(
        `${dir.replace(/\\/g, '/')}/.hermes/config.yaml`,
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
