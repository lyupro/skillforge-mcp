import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import toml from '@iarna/toml';
import { CodexInstaller } from './codex-installer.js';

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillforge-codex-'));
  configPath = join(dir, 'config.toml');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeInstaller(probeResult = false) {
  return new CodexInstaller({
    configPath,
    binaryPath: '/fake/skillforge/dist/server.js',
    binaryProbe: () => probeResult,
  });
}

function readToml(p: string): Record<string, unknown> {
  return toml.parse(readFileSync(p, 'utf8'));
}

describe('CodexInstaller.detect', () => {
  it('returns true when binary probe succeeds', async () => {
    const inst = makeInstaller(true);
    expect(await inst.detect()).toBe(true);
  });

  it('returns true when config file exists', async () => {
    writeFileSync(configPath, '');
    const inst = makeInstaller(false);
    expect(await inst.detect()).toBe(true);
  });

  it('returns false when neither binary nor config exists', async () => {
    const inst = makeInstaller(false);
    expect(await inst.detect()).toBe(false);
  });
});

describe('CodexInstaller.install', () => {
  it('installs to empty config (file missing)', async () => {
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx' });
    expect(result.status).toBe('installed');
    const written = readToml(configPath) as { mcp_servers: { skillforge: { command: string; args: string[] } } };
    expect(written.mcp_servers.skillforge.command).toBe('npx');
    expect(written.mcp_servers.skillforge.args).toEqual(['-y', '@lyupro/skillforge-mcp', 'serve']);
  });

  it('preserves other mcp_servers tables during merge', async () => {
    writeFileSync(
      configPath,
      toml.stringify({
        mcp_servers: { other: { command: 'node', args: ['/x.js'] } },
      } as toml.JsonMap),
    );
    const inst = makeInstaller();
    await inst.install({ entry: 'npx' });
    const written = readToml(configPath) as {
      mcp_servers: Record<string, { command: string; args: string[] }>;
    };
    expect(written.mcp_servers.other.command).toBe('node');
    expect(written.mcp_servers.skillforge.command).toBe('npx');
  });

  it('returns already-installed when entry exists and force is false', async () => {
    writeFileSync(
      configPath,
      toml.stringify({ mcp_servers: { skillforge: { command: 'old', args: [] } } } as toml.JsonMap),
    );
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx' });
    expect(result.status).toBe('already-installed');
    const written = readToml(configPath) as {
      mcp_servers: { skillforge: { command: string } };
    };
    expect(written.mcp_servers.skillforge.command).toBe('old');
  });

  it('overwrites entry when force is true and snapshots .backup', async () => {
    writeFileSync(
      configPath,
      toml.stringify({ mcp_servers: { skillforge: { command: 'old', args: [] } } } as toml.JsonMap),
    );
    const inst = makeInstaller();
    const result = await inst.install({ entry: 'npx', force: true });
    expect(result.status).toBe('updated');
    const written = readToml(configPath) as {
      mcp_servers: { skillforge: { command: string } };
    };
    expect(written.mcp_servers.skillforge.command).toBe('npx');
    expect(existsSync(`${configPath}.backup`)).toBe(true);
  });

  it('uses node + binary path for entry=local', async () => {
    const inst = makeInstaller();
    await inst.install({ entry: 'local' });
    const written = readToml(configPath) as {
      mcp_servers: { skillforge: { command: string; args: string[] } };
    };
    expect(written.mcp_servers.skillforge.command).toBe('node');
    expect(written.mcp_servers.skillforge.args).toEqual(['/fake/skillforge/dist/server.js']);
  });
});

describe('CodexInstaller.uninstall', () => {
  it('removes the entry when present', async () => {
    writeFileSync(
      configPath,
      toml.stringify({
        mcp_servers: {
          skillforge: { command: 'npx', args: ['-y', '@lyupro/skillforge-mcp', 'serve'] },
          other: { command: 'x', args: [] },
        },
      } as toml.JsonMap),
    );
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('uninstalled');
    const written = readToml(configPath) as {
      mcp_servers: Record<string, unknown>;
    };
    expect(written.mcp_servers.skillforge).toBeUndefined();
    expect(written.mcp_servers.other).toBeDefined();
  });

  it('returns not-installed when file is missing', async () => {
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('not-installed');
  });

  it('returns not-installed when entry is absent', async () => {
    writeFileSync(
      configPath,
      toml.stringify({ mcp_servers: { other: { command: 'x', args: [] } } } as toml.JsonMap),
    );
    const inst = makeInstaller();
    const result = await inst.uninstall();
    expect(result.status).toBe('not-installed');
  });
});

describe('CodexInstaller.preview', () => {
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
      toml.stringify({ mcp_servers: { skillforge: { command: 'npx', args: [] } } } as toml.JsonMap),
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
