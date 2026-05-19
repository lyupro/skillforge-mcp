import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './formats.js';
import type { PersistedConfig } from '../config/config-schema.js';

/**
 * Tests isolate the config path by pointing `deps.configPath` at a file
 * inside a fresh OS temp dir (created per-test, removed in afterEach) so the
 * real config under `~/.lyupro/.skillforge/config.json` is never touched.
 * Persistence still runs through the real `ConfigStore` — the same load →
 * mutate → save code path the parser sees on the next process.
 */
describe('formats.main', () => {
  let tmpRoot: string;
  let configPath: string;
  let out: string;
  let err: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'sf-formats-'));
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

  async function readConfig(): Promise<PersistedConfig> {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw) as PersistedConfig;
  }

  describe('list', () => {
    it('prints the 4 built-in formats by default', async () => {
      const code = await main(['list'], deps());
      expect(code).toBe(0);
      for (const id of ['claude', 'codex', 'persona', 'custom']) {
        expect(out).toContain(id);
      }
    });

    it('emits JSON with --json', async () => {
      const code = await main(['list', '--json'], deps());
      expect(code).toBe(0);
      const parsed = JSON.parse(out) as { formats: Array<{ id: string }> };
      expect(parsed.formats.map((f) => f.id)).toEqual([
        'claude',
        'codex',
        'persona',
        'custom',
      ]);
    });
  });

  describe('add', () => {
    it('persists a new operator format via ConfigStore', async () => {
      const code = await main(
        [
          'add',
          'gemini-gem',
          '--filename',
          'GEMINI.md',
          '--derive-name-from-dir',
        ],
        deps(),
      );
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.skillFormats).toHaveLength(1);
      expect(config.skillFormats[0]!.id).toBe('gemini-gem');
      expect(config.skillFormats[0]!.deriveNameFromDir).toBe(true);
    });

    it('applies --priority and --disabled', async () => {
      const code = await main(
        [
          'add',
          'mark',
          '--filename-glob',
          '*.skill.md',
          '--priority',
          '500',
          '--disabled',
        ],
        deps(),
      );
      expect(code).toBe(0);
      const entry = (await readConfig()).skillFormats[0]!;
      expect(entry.priority).toBe(500);
      expect(entry.enabled).toBe(false);
    });

    it('accepts a frontmatter-field match descriptor', async () => {
      const code = await main(
        ['add', 'role', '--frontmatter-field', 'role'],
        deps(),
      );
      expect(code).toBe(0);
      const entry = (await readConfig()).skillFormats[0]!;
      expect(entry.match).toEqual({ type: 'frontmatterField', field: 'role' });
    });

    it('rejects a non-kebab id with exit 2', async () => {
      const code = await main(
        ['add', 'Bad_Id', '--filename', 'X.md'],
        deps(),
      );
      expect(code).toBe(2);
      expect(err).toContain('invalid <id>');
    });

    it('rejects missing <id> with exit 2', async () => {
      const code = await main(['add'], deps());
      expect(code).toBe(2);
    });

    it('rejects multiple match flags with exit 2', async () => {
      const code = await main(
        ['add', 'x', '--filename', 'X.md', '--filename-glob', '*.md'],
        deps(),
      );
      expect(code).toBe(2);
      expect(err).toContain('invalid flags');
    });

    it('rejects no match flag with exit 2', async () => {
      const code = await main(['add', 'x'], deps());
      expect(code).toBe(2);
    });

    it('rejects a duplicate operator id', async () => {
      await main(['add', 'gemini-gem', '--filename', 'GEMINI.md'], deps());
      out = '';
      err = '';
      const code = await main(
        ['add', 'gemini-gem', '--filename', 'OTHER.md'],
        deps(),
      );
      expect(code).toBe(2);
      expect(err).toContain('id already in use');
    });
  });

  describe('remove', () => {
    it('removes an operator format', async () => {
      await main(['add', 'gemini-gem', '--filename', 'GEMINI.md'], deps());
      out = '';
      const code = await main(['remove', 'gemini-gem'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.skillFormats).toHaveLength(0);
    });

    it('refuses to remove a built-in and suggests disable', async () => {
      const code = await main(['remove', 'claude'], deps());
      expect(code).toBe(1);
      expect(err).toContain('built-in');
      expect(err).toContain('disable claude');
    });

    it('returns exit 1 for an unknown id', async () => {
      const code = await main(['remove', 'nope'], deps());
      expect(code).toBe(1);
    });
  });

  describe('enable / disable', () => {
    it('disable persists enabled:false for a built-in', async () => {
      const code = await main(['disable', 'custom'], deps());
      expect(code).toBe(0);
      const custom = (await readConfig()).skillFormats.find((f) => f.id === 'custom');
      expect(custom!.enabled).toBe(false);
    });

    it('enable persists enabled:true after a disable', async () => {
      await main(['disable', 'custom'], deps());
      out = '';
      const code = await main(['enable', 'custom'], deps());
      expect(code).toBe(0);
      const custom = (await readConfig()).skillFormats.find((f) => f.id === 'custom');
      expect(custom!.enabled).toBe(true);
    });

    it('disable on an unknown id returns exit 1', async () => {
      const code = await main(['disable', 'nope'], deps());
      expect(code).toBe(1);
      expect(err).toContain('no format matches');
    });
  });

  describe('round-trip — list reflects an added format', () => {
    it('add → list shows the new id in the table', async () => {
      await main(
        ['add', 'gemini-gem', '--filename', 'GEMINI.md', '--derive-name-from-dir'],
        deps(),
      );
      out = '';
      const code = await main(['list'], deps());
      expect(code).toBe(0);
      expect(out).toContain('gemini-gem');
      expect(out).toContain('filename=GEMINI.md');
    });
  });

  describe('unknown / missing sub-action', () => {
    it('unknown sub-action returns exit 2', async () => {
      const code = await main(['wobble'], deps());
      expect(code).toBe(2);
      expect(err).toContain('unknown action');
    });

    it('no sub-action prints usage and returns exit 2', async () => {
      const code = await main([], deps());
      expect(code).toBe(2);
      expect(err).toContain('skillforge formats');
    });
  });
});
