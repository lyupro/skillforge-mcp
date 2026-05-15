import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './folders.js';

/**
 * Tests isolate the config path by pointing `deps.configPath` at a file
 * inside a fresh OS temp dir (created per-test, removed in afterEach), so
 * the real `~/.lyupro/.skillforge/config.json` is never touched. Persistence
 * still runs through the real `ConfigStore` — the same load → mutate → save
 * code path the `skills__configure` MCP tool uses.
 */
describe('folders.main', () => {
  let tmpRoot: string;
  let configPath: string;
  let skillDir: string;
  let out: string;
  let err: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'sf-folders-'));
    configPath = join(tmpRoot, 'config', 'config.json');
    skillDir = join(tmpRoot, 'skills');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(skillDir, { recursive: true });
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

  async function readConfig(): Promise<{ folders: Array<{ path: string }> }> {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw) as { folders: Array<{ path: string }> };
  }

  describe('add', () => {
    it('persists a valid directory through ConfigStore', async () => {
      const code = await main(['add', skillDir], deps());
      expect(code).toBe(0);
      expect(out).toContain('Registered folder');
      const config = await readConfig();
      expect(config.folders).toHaveLength(1);
      expect(config.folders[0]!.path).toBe(skillDir);
    });

    it('applies --priority, --tags and --disabled flags', async () => {
      const code = await main(
        ['add', skillDir, '--priority', '42', '--tags', 'work,review', '--disabled'],
        deps(),
      );
      expect(code).toBe(0);
      const config = (await readConfig()).folders[0] as {
        priority: number;
        enabled: boolean;
        tags: string[];
      };
      expect(config.priority).toBe(42);
      expect(config.enabled).toBe(false);
      expect(config.tags).toEqual(['work', 'review']);
    });

    it('fails for a non-existent path without writing config', async () => {
      const missing = join(tmpRoot, 'does-not-exist');
      const code = await main(['add', missing], deps());
      expect(code).not.toBe(0);
      expect(err).toContain('does not exist or is not a directory');
      await expect(access(configPath)).rejects.toThrow();
    });

    it('missing <path> returns exit 2', async () => {
      const code = await main(['add'], deps());
      expect(code).toBe(2);
    });
  });

  describe('list', () => {
    it('shows registered folders', async () => {
      await main(['add', skillDir], deps());
      out = '';
      const code = await main(['list'], deps());
      expect(code).toBe(0);
      expect(out).toContain(skillDir);
      expect(out).toContain('PRIORITY');
    });

    it('emits JSON with --json', async () => {
      await main(['add', skillDir], deps());
      out = '';
      const code = await main(['list', '--json'], deps());
      expect(code).toBe(0);
      const parsed = JSON.parse(out) as { folders: Array<{ path: string }> };
      expect(parsed.folders).toHaveLength(1);
      expect(parsed.folders[0]!.path).toBe(skillDir);
    });
  });

  describe('remove', () => {
    it('deletes an existing entry', async () => {
      await main(['add', skillDir], deps());
      out = '';
      const code = await main(['remove', skillDir], deps());
      expect(code).toBe(0);
      expect(out).toContain('Removed folder');
      const config = await readConfig();
      expect(config.folders).toHaveLength(0);
    });

    it('fails when the path is not registered', async () => {
      const code = await main(['remove', skillDir], deps());
      expect(code).not.toBe(0);
      expect(err).toContain('no registered folder matches');
    });
  });

  describe('reset', () => {
    it('without --yes does not change the config', async () => {
      await main(['add', skillDir], deps());
      out = '';
      const code = await main(['reset'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Re-run with --yes');
      const config = await readConfig();
      expect(config.folders).toHaveLength(1);
    });

    it('with --yes clears the folder list', async () => {
      await main(['add', skillDir], deps());
      out = '';
      const code = await main(['reset', '--yes'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders).toHaveLength(0);
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
      expect(err).toContain('skillforge folders');
    });
  });
});
