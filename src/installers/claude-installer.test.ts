import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeInstaller } from './claude-installer.js';

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillforge-claude-'));
  configPath = join(dir, '.claude.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeInstaller(probeResult = false) {
  return new ClaudeInstaller({
    configPath,
    binaryPath: '/fake/skillforge/dist/server.js',
    binaryProbe: () => probeResult,
  });
}

describe('ClaudeInstaller.detect', () => {
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

describe('ClaudeInstaller.install', () => {
  it('installs to empty config (file missing)', async () => {
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx' });
    expect(result.status).toBe('installed');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcpServers.skillforge).toEqual({
      command: 'npx',
      args: ['-y', '@lyupro/skillforge-mcp', 'serve'],
    });
  });

  it('preserves other mcpServers entries during merge', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: { other: { command: 'node', args: ['/x.js'] } },
        otherTopLevel: 'preserved',
      }),
    );
    const inst = makeInstaller();
    await inst.install({ entry: 'npx' });
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcpServers.other).toEqual({ command: 'node', args: ['/x.js'] });
    expect(written.mcpServers.skillforge).toEqual({
      command: 'npx',
      args: ['-y', '@lyupro/skillforge-mcp', 'serve'],
    });
    expect(written.otherTopLevel).toBe('preserved');
  });

  it('returns already-installed when entry exists and force is false', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { skillforge: { command: 'old', args: [] } } }),
    );
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx' });
    expect(result.status).toBe('already-installed');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcpServers.skillforge).toEqual({ command: 'old', args: [] });
  });

  it('overwrites entry when force is true', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { skillforge: { command: 'old', args: [] } } }),
    );
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx', force: true });
    expect(result.status).toBe('updated');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcpServers.skillforge).toEqual({
      command: 'npx',
      args: ['-y', '@lyupro/skillforge-mcp', 'serve'],
    });
    expect(existsSync(`${configPath}.backup`)).toBe(true);
  });

  it('uses node + binary path for entry=local', async () => {
    const inst = makeInstaller();
    await inst.install({ entry: 'local' });
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcpServers.skillforge.command).toBe('node');
    expect(written.mcpServers.skillforge.args).toEqual([
      '/fake/skillforge/dist/server.js',
      'serve',
    ]);
  });

  it('respects custom binaryPath override on install opts', async () => {
    const inst = makeInstaller();
    await inst.install({ entry: 'local', binaryPath: '/explicit/server.js' });
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcpServers.skillforge.args).toEqual(['/explicit/server.js', 'serve']);
  });
});

describe('ClaudeInstaller.uninstall', () => {
  it('removes the entry when present', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          skillforge: { command: 'npx', args: ['-y', '@lyupro/skillforge-mcp', 'serve'] },
          other: { command: 'x', args: [] },
        },
      }),
    );
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('uninstalled');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.mcpServers.skillforge).toBeUndefined();
    expect(written.mcpServers.other).toBeDefined();
  });

  it('returns not-installed when file is missing', async () => {
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('not-installed');
  });

  it('returns not-installed when entry is absent', async () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }));
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('not-installed');
  });
});

describe('ClaudeInstaller.preview', () => {
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
      JSON.stringify({ mcpServers: { skillforge: { command: 'npx', args: [] } } }),
    );
    const inst = makeInstaller();
    const original = readFileSync(configPath, 'utf8');
    const preview = await inst.preview({ entry: 'npx', action: 'uninstall' });
    expect(preview.willCreate).toBe(false);
    expect(preview.before).toContain('skillforge');
    expect(preview.after).not.toContain('skillforge');
    // disk unchanged
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });
});
