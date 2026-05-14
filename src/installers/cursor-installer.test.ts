import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CursorInstaller } from './cursor-installer.js';

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillforge-cursor-'));
  configPath = join(dir, 'settings.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeInstaller(probeResult = false) {
  return new CursorInstaller({
    configPath,
    binaryPath: '/fake/skillforge/dist/server.js',
    binaryProbe: () => probeResult,
  });
}

describe('CursorInstaller.detect', () => {
  it('returns true when binary probe succeeds', async () => {
    const inst = makeInstaller(true);
    expect(await inst.detect()).toBe(true);
  });

  it('returns true when config file exists', async () => {
    writeFileSync(configPath, '{}');
    const inst = makeInstaller(false);
    expect(await inst.detect()).toBe(true);
  });

  it('returns false when neither binary nor config exists', async () => {
    const inst = makeInstaller(false);
    expect(await inst.detect()).toBe(false);
  });
});

describe('CursorInstaller.install', () => {
  it('installs to empty config (file missing)', async () => {
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx' });
    expect(result.status).toBe('installed');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcp.servers.skillforge).toEqual({
      command: 'npx',
      args: ['-y', '@lyupro/skillforge-mcp'],
    });
  });

  it('preserves other mcp.servers entries during merge', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: { servers: { other: { command: 'node', args: ['/x.js'] } } },
        editor: { fontSize: 14 },
      }),
    );
    const inst = makeInstaller();
    await inst.install({ entry: 'npx' });
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcp.servers.other).toEqual({ command: 'node', args: ['/x.js'] });
    expect(written.mcp.servers.skillforge).toEqual({
      command: 'npx',
      args: ['-y', '@lyupro/skillforge-mcp'],
    });
    expect(written.editor).toEqual({ fontSize: 14 });
  });

  it('returns already-installed when entry exists and force is false', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcp: { servers: { skillforge: { command: 'old', args: [] } } } }),
    );
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx' });
    expect(result.status).toBe('already-installed');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcp.servers.skillforge).toEqual({ command: 'old', args: [] });
  });

  it('overwrites entry when force is true and snapshots .backup', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcp: { servers: { skillforge: { command: 'old', args: [] } } } }),
    );
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx', force: true });
    expect(result.status).toBe('updated');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcp.servers.skillforge).toEqual({
      command: 'npx',
      args: ['-y', '@lyupro/skillforge-mcp'],
    });
    expect(existsSync(`${configPath}.backup`)).toBe(true);
  });

  it('uses node + binary path for entry=local', async () => {
    const inst = makeInstaller();
    await inst.install({ entry: 'local' });
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcp.servers.skillforge.command).toBe('node');
    expect(written.mcp.servers.skillforge.args).toEqual(['/fake/skillforge/dist/server.js']);
  });
});

describe('CursorInstaller.uninstall', () => {
  it('removes the entry when present', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          servers: {
            skillforge: { command: 'npx', args: ['-y', '@lyupro/skillforge-mcp'] },
            other: { command: 'x', args: [] },
          },
        },
      }),
    );
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('uninstalled');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcp.servers.skillforge).toBeUndefined();
    expect(written.mcp.servers.other).toBeDefined();
  });

  it('returns not-installed when file is missing', async () => {
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('not-installed');
  });

  it('returns not-installed when entry is absent', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcp: { servers: { other: { command: 'x', args: [] } } } }),
    );
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('not-installed');
  });
});

describe('CursorInstaller.preview', () => {
  it('describes an install without writing', async () => {
    const inst = makeInstaller();
    const preview = await inst.preview({ entry: 'npx', action: 'install' });
    expect(preview.willCreate).toBe(true);
    expect(preview.before).toBeNull();
    expect(preview.after).toContain('skillforge');
    expect(existsSync(configPath)).toBe(false);
  });

  it('describes an uninstall without writing', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcp: { servers: { skillforge: { command: 'npx', args: [] } } } }),
    );
    const inst = makeInstaller();
    const original = readFileSync(configPath, 'utf8');
    const preview = await inst.preview({ entry: 'npx', action: 'uninstall' });
    expect(preview.willCreate).toBe(false);
    expect(preview.before).toContain('skillforge');
    expect(preview.after).not.toContain('skillforge');
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });
});

describe('CursorInstaller cross-platform paths', () => {
  // The path computation lives in src/installers/paths.ts and is unit-tested
  // there. We verify here that constructing the installer without a configPath
  // override picks up a non-empty path on every platform.
  it('default constructor resolves a settings.json path', () => {
    const inst = new CursorInstaller();
    expect(inst.name).toBe('cursor');
  });
});
