import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './security.js';

/**
 * Tests isolate the config path by pointing `deps.configPath` at a file
 * inside a fresh OS temp dir (created per-test, removed in afterEach), so
 * the real `~/.lyupro/.skillforge/config.json` is never touched. Persistence
 * still runs through the real `ConfigStore` — the same load → mutate → save
 * code path the `skills__configure` MCP tool uses.
 */
describe('security.main', () => {
  let tmpRoot: string;
  let configPath: string;
  let out: string;
  let err: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'sf-security-'));
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
    blacklist?: string[];
    security?: { auditExceptions?: string[]; auditTarget?: string; auditPatterns?: string[] };
  }

  async function readConfig(): Promise<ReadConfig> {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw) as ReadConfig;
  }

  describe('audit-exceptions', () => {
    it('add → list → remove → clear round-trip', async () => {
      let code = await main(['audit-exceptions', 'add', 'sec-auditor', 'lint-pack'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Added 2 exception(s)');
      expect(out).toContain('Run "skillforge skills reindex" to apply.');
      let config = await readConfig();
      expect(config.security?.auditExceptions).toEqual(['sec-auditor', 'lint-pack']);

      out = '';
      code = await main(['audit-exceptions', 'list'], deps());
      expect(code).toBe(0);
      expect(out).toContain('AUDIT-EXCEPTIONS');
      expect(out).toContain('sec-auditor');
      expect(out).toContain('lint-pack');

      out = '';
      code = await main(['audit-exceptions', 'remove', 'sec-auditor'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Removed 1 exception(s)');
      config = await readConfig();
      expect(config.security?.auditExceptions).toEqual(['lint-pack']);

      out = '';
      code = await main(['audit-exceptions', 'clear', '--yes'], deps());
      expect(code).toBe(0);
      config = await readConfig();
      expect(config.security?.auditExceptions).toEqual([]);
    });

    it('add is idempotent — skips already-present values', async () => {
      await main(['audit-exceptions', 'add', 'one'], deps());
      out = '';
      const code = await main(['audit-exceptions', 'add', 'one', 'two'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Added 1 exception(s), skipped 1 already present');
      const config = await readConfig();
      expect(config.security?.auditExceptions).toEqual(['one', 'two']);
    });

    it('list emits JSON with --json', async () => {
      await main(['audit-exceptions', 'add', 'alpha'], deps());
      out = '';
      const code = await main(['audit-exceptions', 'list', '--json'], deps());
      expect(code).toBe(0);
      const parsed = JSON.parse(out) as { auditExceptions: string[] };
      expect(parsed.auditExceptions).toEqual(['alpha']);
    });

    it('remove of an absent value reports not found and exits 1', async () => {
      const code = await main(['audit-exceptions', 'remove', 'ghost'], deps());
      expect(code).toBe(1);
      expect(out).toContain('Removed 0 exception(s), 1 not found');
    });

    it('clear without --yes makes no change and exits 0', async () => {
      await main(['audit-exceptions', 'add', 'keep'], deps());
      out = '';
      const code = await main(['audit-exceptions', 'clear'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Re-run with --yes');
      const config = await readConfig();
      expect(config.security?.auditExceptions).toEqual(['keep']);
    });

    it('missing <name> on add returns exit 2', async () => {
      const code = await main(['audit-exceptions', 'add'], deps());
      expect(code).toBe(2);
    });
  });

  describe('audit-target', () => {
    it('prints the default (scripts) when no value is given', async () => {
      const code = await main(['audit-target'], deps());
      expect(code).toBe(0);
      expect(out).toContain('audit-target: scripts');
    });

    it('sets all then reads it back', async () => {
      let code = await main(['audit-target', 'all'], deps());
      expect(code).toBe(0);
      expect(out).toContain('audit-target: all');
      expect(out).toContain('Run "skillforge skills reindex" to apply.');
      const config = await readConfig();
      expect(config.security?.auditTarget).toBe('all');

      out = '';
      code = await main(['audit-target'], deps());
      expect(code).toBe(0);
      expect(out).toContain('audit-target: all');
    });

    it('rejects an invalid value with exit 2', async () => {
      const code = await main(['audit-target', 'everything'], deps());
      expect(code).toBe(2);
      expect(err).toContain('invalid value');
    });
  });

  describe('audit-patterns', () => {
    it('list shows the code-seeded defaults', async () => {
      const code = await main(['audit-patterns', 'list'], deps());
      expect(code).toBe(0);
      expect(out).toContain('AUDIT-PATTERNS');
      expect(out).toContain('shell=True');
    });

    it('list emits JSON with --json', async () => {
      const code = await main(['audit-patterns', 'list', '--json'], deps());
      expect(code).toBe(0);
      const parsed = JSON.parse(out) as { auditPatterns: string[] };
      expect(parsed.auditPatterns).toContain('shell=True');
    });

    it('unknown action returns exit 2', async () => {
      const code = await main(['audit-patterns', 'add', 'x'], deps());
      expect(code).toBe(2);
    });
  });

  describe('blacklist', () => {
    it('add → list shows correct KIND per entry → remove → clear', async () => {
      let code = await main(
        ['blacklist', 'add', 'research-orchestrator', 'wiki-*', '**/agenthub/**'],
        deps(),
      );
      expect(code).toBe(0);
      expect(out).toContain('Added 3 pattern(s)');
      // Top-level config.blacklist, NOT under security.
      let config = await readConfig();
      expect(config.blacklist).toEqual(['research-orchestrator', 'wiki-*', '**/agenthub/**']);
      expect(config.security?.auditExceptions ?? []).toEqual([]);

      out = '';
      code = await main(['blacklist', 'list'], deps());
      expect(code).toBe(0);
      expect(out).toContain('PATTERN');
      expect(out).toContain('KIND');
      expect(out).toContain('research-orchestrator');
      expect(out).toContain('exact');
      expect(out).toContain('name-glob');
      expect(out).toContain('path-glob');

      out = '';
      code = await main(['blacklist', 'remove', 'wiki-*'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Removed 1 pattern(s)');
      config = await readConfig();
      expect(config.blacklist).toEqual(['research-orchestrator', '**/agenthub/**']);

      out = '';
      code = await main(['blacklist', 'clear', '--yes'], deps());
      expect(code).toBe(0);
      config = await readConfig();
      expect(config.blacklist).toEqual([]);
    });

    it('list emits JSON with --json', async () => {
      await main(['blacklist', 'add', 'foo'], deps());
      out = '';
      const code = await main(['blacklist', 'list', '--json'], deps());
      expect(code).toBe(0);
      const parsed = JSON.parse(out) as { blacklist: string[] };
      expect(parsed.blacklist).toEqual(['foo']);
    });

    it('add is idempotent', async () => {
      await main(['blacklist', 'add', 'dup'], deps());
      out = '';
      const code = await main(['blacklist', 'add', 'dup'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Added 0 pattern(s), skipped 1 already present');
      const config = await readConfig();
      expect(config.blacklist).toEqual(['dup']);
    });

    it('remove of an absent pattern exits 1', async () => {
      const code = await main(['blacklist', 'remove', 'nope'], deps());
      expect(code).toBe(1);
    });

    it('clear without --yes makes no change and exits 0', async () => {
      await main(['blacklist', 'add', 'keep'], deps());
      out = '';
      const code = await main(['blacklist', 'clear'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Re-run with --yes');
      const config = await readConfig();
      expect(config.blacklist).toEqual(['keep']);
    });

    it('missing <pattern> on add returns exit 2', async () => {
      const code = await main(['blacklist', 'add'], deps());
      expect(code).toBe(2);
    });
  });

  describe('unknown / missing area & action', () => {
    it('unknown area returns exit 2', async () => {
      const code = await main(['wobble'], deps());
      expect(code).toBe(2);
      expect(err).toContain('unknown area');
    });

    it('no area prints usage and returns exit 2', async () => {
      const code = await main([], deps());
      expect(code).toBe(2);
      expect(err).toContain('skillforge security');
    });

    it('unknown action under a known area returns exit 2', async () => {
      const code = await main(['blacklist', 'wobble'], deps());
      expect(code).toBe(2);
      expect(err).toContain('unknown action');
    });
  });
});
