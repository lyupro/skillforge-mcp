import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './version-policy.js';

/**
 * Tests isolate the config path by pointing `deps.configPath` at a file
 * inside a fresh OS temp dir (created per-test, removed in afterEach), so
 * the real `~/.lyupro/.skillforge/config.json` is never touched. Persistence
 * still runs through the real `ConfigStore` — the same load → mutate → save
 * code path the `skills__configure` MCP tool uses.
 */
describe('version-policy.main', () => {
  let tmpRoot: string;
  let configPath: string;
  let out: string;
  let err: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'sf-version-policy-'));
    configPath = join(tmpRoot, 'config', 'config.json');
    out = '';
    err = '';
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  const deps = (): Parameters<typeof main>[1] => ({
    configPath,
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
  });

  interface ReadConfig {
    versionPolicy?: Record<string, string>;
  }

  async function readConfig(): Promise<ReadConfig> {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw) as ReadConfig;
  }

  it('list → set → list (table + json) → overwrite → remove → clear round-trip', async () => {
    let code = await main(['list'], deps());
    expect(code).toBe(0);
    expect(out).toContain('No version policies set.');

    out = '';
    code = await main(['set', 'engineering-advanced-skills', '2.4.4'], deps());
    expect(code).toBe(0);
    expect(out).toContain('Set version policy: engineering-advanced-skills -> 2.4.4');
    expect(out).toContain('Run "skillforge skills reindex" to apply.');
    let config = await readConfig();
    expect(config.versionPolicy).toEqual({ 'engineering-advanced-skills': '2.4.4' });

    out = '';
    code = await main(['list'], deps());
    expect(code).toBe(0);
    expect(out).toContain('BUNDLE');
    expect(out).toContain('POLICY');
    expect(out).toContain('engineering-advanced-skills');
    expect(out).toContain('2.4.4');

    out = '';
    code = await main(['list', '--json'], deps());
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { versionPolicy: Record<string, string> };
    expect(parsed.versionPolicy).toEqual({ 'engineering-advanced-skills': '2.4.4' });

    out = '';
    code = await main(['set', 'engineering-advanced-skills', 'latest'], deps());
    expect(code).toBe(0);
    config = await readConfig();
    expect(config.versionPolicy).toEqual({ 'engineering-advanced-skills': 'latest' });

    out = '';
    code = await main(['remove', 'engineering-advanced-skills'], deps());
    expect(code).toBe(0);
    expect(out).toContain('Removed 1 policy(ies), 0 not found');
    expect(out).toContain('Run "skillforge skills reindex" to apply.');
    config = await readConfig();
    expect(config.versionPolicy).toEqual({});

    out = '';
    code = await main(['set', 'a', '1.0.0'], deps());
    expect(code).toBe(0);
    out = '';
    code = await main(['clear', '--yes'], deps());
    expect(code).toBe(0);
    config = await readConfig();
    expect(config.versionPolicy).toEqual({});
  });

  describe('set validation', () => {
    it('rejects a loose semver (2.4) with exit 2', async () => {
      const code = await main(['set', 'bundle', '2.4'], deps());
      expect(code).toBe(2);
      expect(err).toContain('invalid value');
    });

    it('rejects a non-semver (latest-ish) with exit 2', async () => {
      const code = await main(['set', 'bundle', 'latest-ish'], deps());
      expect(code).toBe(2);
      expect(err).toContain('invalid value');
    });

    it('rejects a v-prefixed semver (v2.4.4) with exit 2', async () => {
      const code = await main(['set', 'bundle', 'v2.4.4'], deps());
      expect(code).toBe(2);
      expect(err).toContain('invalid value');
    });

    it('missing args returns exit 2', async () => {
      let code = await main(['set'], deps());
      expect(code).toBe(2);
      code = await main(['set', 'bundle'], deps());
      expect(code).toBe(2);
    });
  });

  describe('remove', () => {
    it('reports removed and not-found, exits 0 when at least one matched', async () => {
      await main(['set', 'a', '1.0.0'], deps());
      out = '';
      const code = await main(['remove', 'a', 'ghost'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Removed 1 policy(ies), 1 not found');
    });

    it('of an absent bundle reports not found and exits 1', async () => {
      const code = await main(['remove', 'ghost'], deps());
      expect(code).toBe(1);
      expect(out).toContain('Removed 0 policy(ies), 1 not found');
    });

    it('missing <bundle> returns exit 2', async () => {
      const code = await main(['remove'], deps());
      expect(code).toBe(2);
    });
  });

  describe('clear', () => {
    it('without --yes makes no change and exits 0', async () => {
      await main(['set', 'keep', '1.2.3'], deps());
      out = '';
      const code = await main(['clear'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Re-run with --yes');
      const config = await readConfig();
      expect(config.versionPolicy).toEqual({ keep: '1.2.3' });
    });
  });

  describe('unknown / missing action', () => {
    it('unknown action returns exit 2', async () => {
      const code = await main(['wobble'], deps());
      expect(code).toBe(2);
      expect(err).toContain('unknown action');
    });

    it('no action prints usage and returns exit 2', async () => {
      const code = await main([], deps());
      expect(code).toBe(2);
      expect(err).toContain('skillforge version-policy');
    });
  });
});
