import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('paths', () => {
  const originalAppData = process.env.APPDATA;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    vi.doUnmock('node:os');
    vi.resetModules();
  });

  it('exposes the four expected helpers', async () => {
    const mod = await import('./paths.js');
    expect(typeof mod.claudeConfigPath).toBe('function');
    expect(typeof mod.codexConfigPath).toBe('function');
    expect(typeof mod.cursorSettingsPath).toBe('function');
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

  it('cursorSettingsPath uses %APPDATA% on win32', async () => {
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return { ...actual, platform: () => 'win32' };
    });
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    const { cursorSettingsPath } = await import('./paths.js');
    const p = cursorSettingsPath();
    expect(p.replace(/\\/g, '/')).toContain('AppData/Roaming/Cursor/User/settings.json');
  });

  it('cursorSettingsPath falls back to ~/AppData/Roaming when APPDATA is unset on win32', async () => {
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return { ...actual, platform: () => 'win32' };
    });
    delete process.env.APPDATA;
    const { cursorSettingsPath } = await import('./paths.js');
    const p = cursorSettingsPath();
    expect(p.replace(/\\/g, '/')).toContain('AppData/Roaming/Cursor/User/settings.json');
  });

  it('cursorSettingsPath uses Library/Application Support on darwin', async () => {
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return { ...actual, platform: () => 'darwin' };
    });
    const { cursorSettingsPath } = await import('./paths.js');
    const p = cursorSettingsPath();
    expect(p.replace(/\\/g, '/')).toContain('Library/Application Support/Cursor/User/settings.json');
  });

  it('cursorSettingsPath uses ~/.config on linux', async () => {
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return { ...actual, platform: () => 'linux' };
    });
    const { cursorSettingsPath } = await import('./paths.js');
    const p = cursorSettingsPath();
    expect(p.replace(/\\/g, '/')).toContain('/.config/Cursor/User/settings.json');
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
    expect(typeof all.cursorSettingsPath).toBe('string');
    expect(typeof all.defaultBinaryPath).toBe('string');
  });
});
