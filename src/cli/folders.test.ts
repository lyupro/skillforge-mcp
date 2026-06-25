import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
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

  async function readConfig(): Promise<{ folders: Array<{ path: string; alias?: string }> }> {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw) as { folders: Array<{ path: string; alias?: string }> };
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

    it('prints a skill-source conflict hint but still registers (exit 0)', async () => {
      // A folder inside the real Claude plugin cache root. The conflict
      // detector is pure path logic (reads no files), and isDirectory is
      // stubbed, so no directory is actually created under the user's home.
      const pluginCachePath = join(
        homedir(),
        '.claude',
        'plugins',
        'cache',
        'some-marketplace',
        'some-plugin',
        '9.9.9',
        'skills',
      );
      const code = await main(['add', pluginCachePath], {
        ...deps(),
        isDirectory: async () => true,
      });
      expect(code).toBe(0);
      expect(out).toContain('Registered folder');
      expect(out).toContain('also served by the Claude Code plugin');
      expect(out).toContain('some-marketplace/some-plugin');
      const config = await readConfig();
      expect(config.folders).toHaveLength(1);
    });

    it('prints no conflict hint for an ordinary folder', async () => {
      const code = await main(['add', skillDir], deps());
      expect(code).toBe(0);
      expect(out).toContain('Registered folder');
      expect(out).not.toContain('also served by');
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

    it('persists an --alias to the new entry', async () => {
      const code = await main(['add', skillDir, '--alias', 'work'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('work');
    });

    it('rejects a doubled-separator --alias with exit 2', async () => {
      const code = await main(['add', skillDir, '--alias', 'foo--bar'], deps());
      expect(code).toBe(2);
      expect(err).toContain('invalid --alias');
    });

    it('lowercases an uppercase --alias and reports the normalization', async () => {
      const code = await main(['add', skillDir, '--alias', 'Dammyjay93-Interface'], deps());
      expect(code).toBe(0);
      expect(out).toContain('alias normalized "Dammyjay93-Interface" → "dammyjay93-interface"');
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('dammyjay93-interface');
    });

    it('accepts an underscore --alias and stores it verbatim', async () => {
      const code = await main(['add', skillDir, '--alias', 'dammyjay93_interface_design'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('dammyjay93_interface_design');
    });

    it('accepts a slash --alias for source-handle style', async () => {
      const code = await main(['add', skillDir, '--alias', 'lyupro/llm-skills'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('lyupro/llm-skills');
    });

    it('rejects a duplicate alias and leaves config unchanged', async () => {
      const other = join(tmpRoot, 'skills-2');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(other, { recursive: true });
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      err = '';
      const before = await readConfig();
      const code = await main(['add', other, '--alias', 'work'], deps());
      expect(code).not.toBe(0);
      expect(err).toContain('alias already in use');
      const after = await readConfig();
      expect(after.folders).toEqual(before.folders);
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

    it('shows an ALIAS column with the alias value', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      const code = await main(['list'], deps());
      expect(code).toBe(0);
      expect(out).toContain('ALIAS');
      expect(out).toContain('work');
    });

    it('--tag filters to folders with that tag', async () => {
      const other = join(tmpRoot, 'skills-tag');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(other, { recursive: true });
      await main(['add', skillDir, '--tags', 'work'], deps());
      await main(['add', other, '--tags', 'review'], deps());
      out = '';
      const code = await main(['list', '--tag', 'work'], deps());
      expect(code).toBe(0);
      expect(out).toContain(skillDir);
      expect(out).not.toContain(other);
    });

    it('--tag with no value returns exit 2', async () => {
      const code = await main(['list', '--tag'], deps());
      expect(code).toBe(2);
      expect(err).toContain('--tag requires a value');
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

    it('removes the same folder when given its alias', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      const code = await main(['remove', 'work'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Removed folder');
      const config = await readConfig();
      expect(config.folders).toHaveLength(0);
    });

    it('matches an alias case-insensitively', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      const code = await main(['remove', 'WORK'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders).toHaveLength(0);
    });
  });

  describe('alias', () => {
    it('sets an alias on a registered folder by path', async () => {
      await main(['add', skillDir], deps());
      out = '';
      const code = await main(['alias', skillDir, 'work'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('work');
    });

    it('changes an existing alias when addressed by the old alias', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      const code = await main(['alias', 'work', 'review'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('review');
    });

    it('returns exit 1 when no folder matches', async () => {
      const code = await main(['alias', skillDir, 'work'], deps());
      expect(code).toBe(1);
      expect(err).toContain('no registered folder matches');
    });

    it('returns exit 2 for a doubled-separator alias', async () => {
      await main(['add', skillDir], deps());
      err = '';
      const code = await main(['alias', skillDir, 'bad--name'], deps());
      expect(code).toBe(2);
      expect(err).toContain('invalid alias');
    });

    it('normalizes an uppercase alias when setting by path', async () => {
      await main(['add', skillDir], deps());
      out = '';
      const code = await main(['alias', skillDir, 'My-Folder'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('my-folder');
    });

    it('returns exit 2 for a duplicate alias', async () => {
      const other = join(tmpRoot, 'skills-3');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(other, { recursive: true });
      await main(['add', skillDir, '--alias', 'work'], deps());
      await main(['add', other], deps());
      err = '';
      const code = await main(['alias', other, 'work'], deps());
      expect(code).toBe(2);
      expect(err).toContain('alias already in use');
    });

    it('returns exit 2 when <name> is missing', async () => {
      const code = await main(['alias', skillDir], deps());
      expect(code).toBe(2);
    });
  });

  describe('rename', () => {
    it('renames an existing alias addressed by the old alias', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      const code = await main(['rename', 'work', 'review'], deps());
      expect(code).toBe(0);
      expect(out).toContain('Renamed alias "work" → "review"');
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('review');
    });

    it('renames an alias addressed by the folder path', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      const code = await main(['rename', skillDir, 'review'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('review');
    });

    it('normalizes the new alias and reports the change', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      const code = await main(['rename', 'work', 'Lyupro/LLM-Skills'], deps());
      expect(code).toBe(0);
      expect(out).toContain('alias normalized "Lyupro/LLM-Skills" → "lyupro/llm-skills"');
      const config = await readConfig();
      expect(config.folders[0]!.alias).toBe('lyupro/llm-skills');
    });

    it('returns exit 2 for an invalid new alias', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      err = '';
      const code = await main(['rename', 'work', 'bad--name'], deps());
      expect(code).toBe(2);
      expect(err).toContain('invalid alias');
    });

    it('returns exit 2 for a new alias already in use', async () => {
      const other = join(tmpRoot, 'skills-rename');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(other, { recursive: true });
      await main(['add', skillDir, '--alias', 'work'], deps());
      await main(['add', other, '--alias', 'review'], deps());
      err = '';
      const code = await main(['rename', 'work', 'review'], deps());
      expect(code).toBe(2);
      expect(err).toContain('alias already in use');
    });

    it('returns exit 1 when no folder matches', async () => {
      const code = await main(['rename', 'ghost', 'review'], deps());
      expect(code).toBe(1);
      expect(err).toContain('no registered folder matches');
    });

    it('returns exit 2 when the new alias is missing', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      const code = await main(['rename', 'work'], deps());
      expect(code).toBe(2);
    });
  });

  describe('enable / disable', () => {
    it('disable sets enabled: false in config', async () => {
      await main(['add', skillDir], deps());
      out = '';
      const code = await main(['disable', skillDir], deps());
      expect(code).toBe(0);
      expect(out).toContain('Disabled folder');
      const config = await readConfig();
      expect((config.folders[0] as { enabled: boolean }).enabled).toBe(false);
    });

    it('enable sets enabled: true after a disable', async () => {
      await main(['add', skillDir, '--disabled'], deps());
      out = '';
      const code = await main(['enable', skillDir], deps());
      expect(code).toBe(0);
      expect(out).toContain('Enabled folder');
      const config = await readConfig();
      expect((config.folders[0] as { enabled: boolean }).enabled).toBe(true);
    });

    it('disable by alias works', async () => {
      await main(['add', skillDir, '--alias', 'work'], deps());
      out = '';
      const code = await main(['disable', 'work'], deps());
      expect(code).toBe(0);
      const config = await readConfig();
      expect((config.folders[0] as { enabled: boolean }).enabled).toBe(false);
    });

    it('enable non-existent path returns exit 1', async () => {
      const code = await main(['enable', skillDir], deps());
      expect(code).toBe(1);
      expect(err).toContain('no registered folder matches');
    });

    it('disable non-existent alias returns exit 1', async () => {
      const code = await main(['disable', 'ghost'], deps());
      expect(code).toBe(1);
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
