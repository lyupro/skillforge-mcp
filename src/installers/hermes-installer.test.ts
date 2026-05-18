import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { HermesInstaller } from './hermes-installer.js';

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillforge-hermes-'));
  configPath = join(dir, 'config.yaml');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeInstaller(probeResult = false) {
  return new HermesInstaller({
    configPath,
    binaryPath: '/fake/skillforge/dist/cli/dispatcher.js',
    binaryProbe: () => probeResult,
  });
}

function readYaml(p: string): Record<string, any> {
  return parse(readFileSync(p, 'utf8')) as Record<string, any>;
}

describe('HermesInstaller.detect', () => {
  it('returns true when binary probe succeeds', async () => {
    expect(await makeInstaller(true).detect()).toBe(true);
  });

  it('returns true when config file exists', async () => {
    writeFileSync(configPath, '');
    expect(await makeInstaller(false).detect()).toBe(true);
  });

  it('returns false when neither binary nor config exists', async () => {
    expect(await makeInstaller(false).detect()).toBe(false);
  });
});

describe('HermesInstaller.install', () => {
  it('installs to an empty config (file missing)', async () => {
    const result = await makeInstaller().install({ entry: 'npx' });
    expect(result.status).toBe('installed');
    const written = readYaml(configPath);
    expect(written.mcp_servers.skillforge.command).toBe('npx');
    expect(written.mcp_servers.skillforge.args).toEqual(['-y', '@lyupro/skillforge-mcp', 'serve']);
  });

  it('writes the Hermes-specific enabled / timeout / connect_timeout fields', async () => {
    await makeInstaller().install({ entry: 'npx' });
    const entry = readYaml(configPath).mcp_servers.skillforge;
    expect(entry.enabled).toBe(true);
    expect(entry.timeout).toBe(120);
    expect(entry.connect_timeout).toBe(60);
  });

  it('uses node + binary path + serve for entry=local', async () => {
    await makeInstaller().install({ entry: 'local' });
    const entry = readYaml(configPath).mcp_servers.skillforge;
    expect(entry.command).toBe('node');
    expect(entry.args).toEqual(['/fake/skillforge/dist/cli/dispatcher.js', 'serve']);
  });

  it('preserves other mcp_servers entries during merge', async () => {
    writeFileSync(configPath, 'mcp_servers:\n  other:\n    command: node\n    args:\n      - /x.js\n');
    await makeInstaller().install({ entry: 'npx' });
    const written = readYaml(configPath);
    expect(written.mcp_servers.other.command).toBe('node');
    expect(written.mcp_servers.skillforge.command).toBe('npx');
  });

  it('never touches the sibling mcp: provider key', async () => {
    writeFileSync(configPath, "mcp:\n  provider: auto\n  model: ''\n  timeout: 30\n");
    await makeInstaller().install({ entry: 'npx' });
    const written = readYaml(configPath);
    expect(written.mcp).toEqual({ provider: 'auto', model: '', timeout: 30 });
    expect(written.mcp_servers.skillforge).toBeDefined();
  });

  it('preserves operator comments in the config', async () => {
    writeFileSync(configPath, '# operator note\nmcp:\n  provider: auto\n');
    await makeInstaller().install({ entry: 'npx' });
    expect(readFileSync(configPath, 'utf8')).toContain('# operator note');
  });

  it('returns already-installed when entry exists and force is false', async () => {
    writeFileSync(configPath, 'mcp_servers:\n  skillforge:\n    command: old\n');
    const result = await makeInstaller().install({ entry: 'npx' });
    expect(result.status).toBe('already-installed');
    expect(readYaml(configPath).mcp_servers.skillforge.command).toBe('old');
  });

  it('overwrites the entry when force is true and snapshots .backup', async () => {
    writeFileSync(configPath, 'mcp_servers:\n  skillforge:\n    command: old\n');
    const result = await makeInstaller().install({ entry: 'npx', force: true });
    expect(result.status).toBe('updated');
    expect(readYaml(configPath).mcp_servers.skillforge.command).toBe('npx');
    expect(existsSync(`${configPath}.backup`)).toBe(true);
  });

  it('throws a clear error on invalid YAML', async () => {
    writeFileSync(configPath, 'mcp_servers: [unclosed\n');
    await expect(makeInstaller().install({ entry: 'npx' })).rejects.toThrow(/not valid YAML/);
  });
});

describe('HermesInstaller.uninstall', () => {
  it('removes only the skillforge entry, leaving mcp: and other servers intact', async () => {
    writeFileSync(
      configPath,
      'mcp:\n  provider: auto\nmcp_servers:\n  skillforge:\n    command: npx\n  other:\n    command: x\n',
    );
    const result = await makeInstaller().uninstall();
    expect(result.status).toBe('uninstalled');
    const written = readYaml(configPath);
    expect(written.mcp_servers.skillforge).toBeUndefined();
    expect(written.mcp_servers.other).toBeDefined();
    expect(written.mcp).toEqual({ provider: 'auto' });
  });

  it('returns not-installed when the file is missing', async () => {
    expect((await makeInstaller().uninstall()).status).toBe('not-installed');
  });

  it('returns not-installed when the entry is absent', async () => {
    writeFileSync(configPath, 'mcp_servers:\n  other:\n    command: x\n');
    expect((await makeInstaller().uninstall()).status).toBe('not-installed');
  });
});

describe('HermesInstaller.preview', () => {
  it('describes an install without writing', async () => {
    const preview = await makeInstaller().preview({ entry: 'npx', action: 'install' });
    expect(preview.willCreate).toBe(true);
    expect(preview.before).toBeNull();
    expect(preview.after).toContain('skillforge');
    expect(existsSync(configPath)).toBe(false);
  });

  it('describes an uninstall without writing', async () => {
    writeFileSync(configPath, 'mcp_servers:\n  skillforge:\n    command: npx\n');
    const original = readFileSync(configPath, 'utf8');
    const preview = await makeInstaller().preview({ entry: 'npx', action: 'uninstall' });
    expect(preview.willCreate).toBe(false);
    expect(preview.before).toContain('skillforge');
    expect(preview.after).not.toContain('skillforge');
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });
});
