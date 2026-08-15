import { describe, it, expect, vi } from 'vitest';

// Spawns real processes / boots a real server, so it is not bound by the 5s
// default meant for pure unit tests: on a busy machine that budget expires
// mid-setup and reports a timeout where nothing is actually broken.
vi.setConfig({ testTimeout: 20_000 });
import { pathToFileURL } from 'node:url';
import type { spawnSync } from 'node:child_process';
import {
  NPX_PKG,
  BIN_COMMAND,
  binEntry,
  npxEntry,
  localEntry,
  isEphemeralPath,
  resolveDispatcherPath,
  resolveAutoEntry,
  buildEntry,
  resolveEntry,
  probeBinVersion,
  resolveCommandOnPath,
} from './entry.js';

describe('npxEntry / localEntry', () => {
  it('binEntry uses the host-spawnable package command directly', () => {
    expect(binEntry()).toEqual({ command: BIN_COMMAND, args: ['serve'] });
  });

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
  it('entry=bin uses the short command when its exact version is reachable', () => {
    expect(buildEntry({ entry: 'bin' }, '/fallback.js', {
      packageVersion: '1.13.0',
      probeBin: () => ({ ok: true, version: '1.13.0' }),
    })).toEqual({ command: 'skillforge-mcp', args: ['serve'] });
  });

  it('entry=bin fails loudly when the command cannot be verified', () => {
    expect(() => buildEntry({ entry: 'bin' }, '/fallback.js', {
      packageVersion: '1.13.0',
      probeBin: () => ({ ok: false, reason: 'not spawnable without a shell' }),
    })).toThrow(/Cannot use --entry bin.*not spawnable without a shell/);
  });

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
    const entry = buildEntry({ entry: 'auto' }, '/fallback.js', {
      packageVersion: '1.13.0',
      probeBin: () => ({ ok: true, version: '1.13.0' }),
    });
    expect(entry).toEqual({ command: 'skillforge-mcp', args: ['serve'] });
  });

  it('entry=auto falls back to the direct path and explains a version mismatch', () => {
    const result = resolveEntry({ entry: 'auto' }, '/fallback.js', {
      packageVersion: '1.13.0',
      probeBin: () => ({ ok: true, version: '1.12.0' }),
      moduleUrl: pathToFileURL('/stable/dist/installers/entry.js').href,
    });
    expect(result.entry.command).toBe('node');
    expect(result.entry.args[0].replace(/\\/g, '/')).toMatch(/\/stable\/dist\/cli\/dispatcher\.js$/);
    expect(result.fallbackReason).toContain('reported "1.12.0"; expected "1.13.0"');
  });

  it('entry=auto falls back when the bin is not spawnable without a shell', () => {
    const result = resolveEntry({ entry: 'auto' }, '/fallback.js', {
      packageVersion: '1.13.0',
      probeBin: () => ({ ok: false, reason: 'not spawnable without a shell' }),
      moduleUrl: pathToFileURL('/stable/dist/installers/entry.js').href,
    });
    expect(result.entry.command).toBe('node');
    expect(result.fallbackReason).toContain('not spawnable without a shell');
  });

  it('entry=auto falls back when an older bin hangs instead of answering', () => {
    const result = resolveEntry({ entry: 'auto' }, '/fallback.js', {
      packageVersion: '1.14.0',
      probeBin: () => ({ ok: false, reason: 'skillforge-mcp could not be spawned without a shell: ETIMEDOUT' }),
      moduleUrl: pathToFileURL('/stable/dist/installers/entry.js').href,
    });
    expect(result.entry.command).toBe('node');
    expect(result.fallbackReason).toContain('ETIMEDOUT');
  });
});

describe('probeBinVersion', () => {
  /**
   * Bins from releases before the CLI dispatcher answered an unrecognised
   * argument by waiting on stdin forever. Without a closed stdin and a bounded
   * wait the probe never returns and the install hangs — on exactly the upgrade
   * path this feature exists to serve.
   */
  it('closes stdin and bounds the wait so an old hanging bin cannot freeze the install', () => {
    let seen: Record<string, unknown> | undefined;
    const spawnFn = ((_command: string, _args: string[], opts: Record<string, unknown>) => {
      seen = opts;
      return { error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
    }) as unknown as typeof spawnSync;

    const result = probeBinVersion({
      platform: 'linux',
      resolveCommand: () => '/usr/bin/skillforge-mcp',
      spawn: spawnFn,
    });

    expect(seen?.shell).toBe(false);
    expect(seen?.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(seen?.timeout).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ETIMEDOUT');
  });

  it('reports the trimmed version when the bin answers', () => {
    const spawnFn = (() => ({ status: 0, stdout: '1.14.0\n' })) as unknown as typeof spawnSync;
    expect(probeBinVersion({
      resolveCommand: () => '/usr/bin/skillforge-mcp',
      spawn: spawnFn,
    })).toEqual({ ok: true, version: '1.14.0' });
  });

  it('probes a resolved Windows cmd shim through a shell', () => {
    let seenCommand: string | undefined;
    let seenOptions: Record<string, unknown> | undefined;
    const spawnFn = ((command: string, _args: string[], opts: Record<string, unknown>) => {
      seenCommand = command;
      seenOptions = opts;
      return { status: 0, stdout: '1.14.0' };
    }) as unknown as typeof spawnSync;

    expect(probeBinVersion({
      platform: 'win32',
      resolveCommand: () => 'C:\\npm\\skillforge-mcp.cmd',
      spawn: spawnFn,
    }).ok).toBe(true);
    expect(seenCommand).toBe('C:\\npm\\skillforge-mcp.cmd');
    expect(seenOptions?.shell).toBe(true);
  });

  it('probes a resolved POSIX binary without a shell', () => {
    let shell: unknown;
    const spawnFn = ((_command: string, _args: string[], opts: Record<string, unknown>) => {
      shell = opts.shell;
      return { status: 0, stdout: '1.14.0' };
    }) as unknown as typeof spawnSync;
    probeBinVersion({
      platform: 'linux',
      resolveCommand: () => '/opt/bin/skillforge-mcp',
      spawn: spawnFn,
    });
    expect(shell).toBe(false);
  });

  it('falls back without spawning when the command is absent from PATH', () => {
    const spawnFn = vi.fn();
    expect(probeBinVersion({
      resolveCommand: () => undefined,
      spawn: spawnFn as unknown as typeof spawnSync,
    })).toEqual({ ok: false, reason: 'skillforge-mcp was not found on PATH' });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe('resolveCommandOnPath', () => {
  it('finds a Windows shim using PATHEXT and returns its concrete path', () => {
    expect(resolveCommandOnPath(BIN_COMMAND, {
      platform: 'win32',
      env: { Path: 'C:\\first;C:\\npm', PATHEXT: '.EXE;.CMD' },
      isFile: (candidate) => candidate === 'C:\\npm\\skillforge-mcp.CMD',
    })).toBe('C:\\npm\\skillforge-mcp.CMD');
  });

  it('finds an extensionless POSIX executable', () => {
    expect(resolveCommandOnPath(BIN_COMMAND, {
      platform: 'linux',
      env: { PATH: '/usr/local/bin:/opt/bin' },
      isFile: (candidate) => candidate === '/opt/bin/skillforge-mcp',
    })).toBe('/opt/bin/skillforge-mcp');
  });
});
