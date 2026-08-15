import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { main } from './config.js';
import { settingsDeclarations } from '../config/settings-declarations.js';

let dir: string;
let out: string[];
let err: string[];

function deps(env: NodeJS.ProcessEnv = {}, configPath = join(dir, 'config.json')) {
  return {
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
    configPath,
    env,
  };
}

async function writeConfig(contents: unknown): Promise<string> {
  const p = join(dir, 'config.json');
  await writeFile(p, JSON.stringify(contents), 'utf-8');
  return p;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillforge-config-cli-'));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('skillforge config', () => {
  it('lists every declared setting — a new one appears without touching this command', async () => {
    const code = await main([], deps());
    expect(code).toBe(0);
    const text = out.join('');
    for (const declaration of settingsDeclarations) {
      expect(text).toContain(declaration.settingKey);
    }
  });

  it('reports the environment as the source when it supplies the value', async () => {
    const code = await main([], deps({ SKILLFORGE_TTL_MS: '1234' }));
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/metadataTtlMs\s+1234\s+env/);
  });

  it('reports the config file as the source when the environment is silent', async () => {
    await writeConfig({ version: '1.0', cache: { metadataTtlMs: 4321 } });
    const code = await main([], deps({}));
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/metadataTtlMs\s+4321\s+config/);
  });

  it('falls back to the declared default and says so', async () => {
    const code = await main([], deps({}));
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/metadataTtlMs\s+300000\s+default/);
  });

  it('names the losing side when both sources are set', async () => {
    await writeConfig({ version: '1.0', cache: { metadataTtlMs: 4321 } });
    const code = await main([], deps({ SKILLFORGE_TTL_MS: '1234' }));
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/metadataTtlMs\s+1234\s+env\s+config value 4321/);
  });

  it('says the config file does not exist yet rather than pretending it read one', async () => {
    const code = await main([], deps({}));
    expect(code).toBe(0);
    expect(out.join('')).toContain('does not exist yet');
  });

  it('reports folders from the merged view, not from the environment side alone', async () => {
    const envFolders = [join(dir, 'a'), join(dir, 'b')].join(delimiter);
    const code = await main([], deps({ SKILLFORGE_FOLDERS: envFolders }));
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/folders\s+2 folder\(s\)\s+env/);
  });

  it('lists the folder paths under the table instead of inside a cell', async () => {
    const envFolders = [join(dir, 'a'), join(dir, 'b')].join(delimiter);
    const code = await main([], deps({ SKILLFORGE_FOLDERS: envFolders }));
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toContain('\nfolders:\n');
    expect(text).toContain(`  ${join(dir, 'a')}`);
    expect(text).toContain(`  ${join(dir, 'b')}`);
  });

  it('--json emits the same data in parsable form', async () => {
    const code = await main(['--json'], deps({ SKILLFORGE_TTL_MS: '1234' }));
    expect(code).toBe(0);
    const report = JSON.parse(out.join('')) as {
      configPath: string;
      configExists: boolean;
      settings: Array<{ setting: string; value: string; source: string }>;
    };
    expect(report.configExists).toBe(false);
    expect(report.settings.map((s) => s.setting)).toEqual(
      settingsDeclarations.map((d) => d.settingKey),
    );
    expect(report.settings.find((s) => s.setting === 'metadataTtlMs')?.source).toBe('env');
  });

  it('explains a malformed value instead of dying with a stack trace', async () => {
    const code = await main([], deps({ SKILLFORGE_TTL_MS: 'garbage' }));
    expect(code).toBe(1);
    expect(err.join('')).toContain('metadataTtlMs');
    expect(out.join('')).toBe('');
  });

  it('rejects an unknown argument with usage', async () => {
    const code = await main(['--bogus'], deps({}));
    expect(code).toBe(2);
    expect(err.join('')).toContain('unknown argument');
  });
});
