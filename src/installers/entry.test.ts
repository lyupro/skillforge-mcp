import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import {
  NPX_PKG,
  npxEntry,
  localEntry,
  isEphemeralPath,
  resolveDispatcherPath,
  resolveAutoEntry,
  buildEntry,
} from './entry.js';

describe('npxEntry / localEntry', () => {
  it('npxEntry resolves the package from the registry with serve', () => {
    expect(npxEntry()).toEqual({ command: 'npx', args: ['-y', NPX_PKG, 'serve'] });
  });

  it('localEntry points node at the binary with an explicit serve arg', () => {
    expect(localEntry('/abs/dispatcher.js')).toEqual({
      command: 'node',
      args: ['/abs/dispatcher.js', 'serve'],
    });
  });
});

describe('isEphemeralPath', () => {
  it('is true for a path inside an npx cache directory', () => {
    expect(isEphemeralPath('/home/u/.npm/_npx/abc123/node_modules/@lyupro/skillforge-mcp/x.js'))
      .toBe(true);
  });

  it('detects the _npx segment with Windows separators', () => {
    expect(isEphemeralPath('C:\\Users\\u\\AppData\\npm-cache\\_npx\\abc\\node_modules\\x.js'))
      .toBe(true);
  });

  it('is false for a stable global install path', () => {
    expect(isEphemeralPath('/usr/lib/node_modules/@lyupro/skillforge-mcp/dist/installers/entry.js'))
      .toBe(false);
  });

  it('does not match a substring — only a full path segment', () => {
    expect(isEphemeralPath('/home/u/my_npx_tool/entry.js')).toBe(false);
  });
});

describe('resolveDispatcherPath', () => {
  it('resolves to dist/cli/dispatcher.js at the package root', () => {
    const url = pathToFileURL(
      '/usr/lib/node_modules/@lyupro/skillforge-mcp/dist/installers/entry.js',
    ).href;
    const p = resolveDispatcherPath(url).replace(/\\/g, '/');
    expect(p.endsWith('/dist/cli/dispatcher.js')).toBe(true);
    expect(p).toContain('skillforge-mcp');
  });
});

describe('resolveAutoEntry', () => {
  it('a stable install resolves to a node-entry on the dispatcher path', () => {
    const url = pathToFileURL(
      '/usr/lib/node_modules/@lyupro/skillforge-mcp/dist/installers/entry.js',
    ).href;
    const entry = resolveAutoEntry(url);
    expect(entry.command).toBe('node');
    expect(entry.args[0].replace(/\\/g, '/').endsWith('/dist/cli/dispatcher.js')).toBe(true);
    expect(entry.args[1]).toBe('serve');
  });

  it('an ephemeral npx run falls back to an npx-entry', () => {
    const url = pathToFileURL(
      '/home/u/.npm/_npx/abc123/node_modules/@lyupro/skillforge-mcp/dist/installers/entry.js',
    ).href;
    expect(resolveAutoEntry(url)).toEqual({ command: 'npx', args: ['-y', NPX_PKG, 'serve'] });
  });
});

describe('buildEntry', () => {
  it('entry=npx → npx-entry', () => {
    expect(buildEntry({ entry: 'npx' }, '/fallback.js')).toEqual({
      command: 'npx',
      args: ['-y', NPX_PKG, 'serve'],
    });
  });

  it('entry=local → node-entry on binaryPath, falling back when absent', () => {
    expect(buildEntry({ entry: 'local', binaryPath: '/explicit.js' }, '/fallback.js')).toEqual({
      command: 'node',
      args: ['/explicit.js', 'serve'],
    });
    expect(buildEntry({ entry: 'local' }, '/fallback.js')).toEqual({
      command: 'node',
      args: ['/fallback.js', 'serve'],
    });
  });

  it('entry=auto with an explicit binaryPath forces a local entry', () => {
    expect(buildEntry({ entry: 'auto', binaryPath: '/explicit.js' }, '/fallback.js')).toEqual({
      command: 'node',
      args: ['/explicit.js', 'serve'],
    });
  });

  it('entry=auto without a binaryPath resolves a valid entry from this module', () => {
    // Running under vitest the module path is stable (not under _npx), so
    // auto resolves to a node-entry on the dispatcher.
    const entry = buildEntry({ entry: 'auto' }, '/fallback.js');
    expect(['node', 'npx']).toContain(entry.command);
    expect(entry.args[entry.args.length - 1]).toBe('serve');
  });
});
