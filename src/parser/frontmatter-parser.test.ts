import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrontmatterParser } from './frontmatter-parser.js';
import type { ScriptsDirDetector } from './scripts-dir-detector.js';

let dir: string;
let parser: FrontmatterParser;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillforge-test-'));
  parser = new FrontmatterParser();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSkill(fileName: string, content: string): Promise<string> {
  const filePath = join(dir, fileName);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('FrontmatterParser', () => {
  it('parses a valid SKILL.md with name, description, and body', async () => {
    const filePath = await writeSkill('SKILL.md', [
      '---',
      'name: My Skill',
      'description: Does stuff',
      '---',
      '',
      'Body content here.',
    ].join('\n'));

    const result = await parser.parseFile(filePath, dir);

    expect(result.name).toBe('My Skill');
    expect(result.description).toBe('Does stuff');
    expect(result.body).toBe('Body content here.');
    expect(result.raw).toContain('name: My Skill');
    expect(result.sourcePath).toBe(filePath);
    expect(result.folder).toBe(dir);
  });

  it('throws with path in message when name is missing', async () => {
    const filePath = await writeSkill('no-name.md', '---\ndescription: oops\n---\nbody');
    await expect(parser.parseFile(filePath, dir)).rejects.toThrow(filePath);
    await expect(parser.parseFile(filePath, dir)).rejects.toThrow("missing required frontmatter field 'name'");
  });

  it('throws when name is empty string', async () => {
    const filePath = await writeSkill('empty-name.md', '---\nname: ""\n---\nbody');
    await expect(parser.parseFile(filePath, dir)).rejects.toThrow("missing required frontmatter field 'name'");
  });

  it('normalizes tags from array', async () => {
    const filePath = await writeSkill('tags-array.md', '---\nname: T\ntags:\n  - foo\n  - bar\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.tags).toEqual(['foo', 'bar']);
  });

  it('normalizes tags from comma-separated string', async () => {
    const filePath = await writeSkill('tags-csv.md', '---\nname: T\ntags: "foo, bar, baz"\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.tags).toEqual(['foo', 'bar', 'baz']);
  });

  it('normalizes tags from single string', async () => {
    const filePath = await writeSkill('tags-single.md', '---\nname: T\ntags: solo\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.tags).toEqual(['solo']);
  });

  it('puts unknown frontmatter fields in extra', async () => {
    const filePath = await writeSkill('extra.md', '---\nname: T\ncustom_field: hello\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.extra).toEqual({ custom_field: 'hello' });
  });

  it('does not put allow_scripts in extra — it is consumed', async () => {
    const filePath = await writeSkill('scripts.md', '---\nname: T\nallow_scripts: true\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.allowScripts).toBe(true);
    expect(result.extra?.['allow_scripts']).toBeUndefined();
  });

  it('normalizes timeout_ms to timeoutMs', async () => {
    const filePath = await writeSkill('timeout.md', '---\nname: T\ntimeout_ms: 5000\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.timeoutMs).toBe(5000);
  });

  it('promotes scripts array from frontmatter (used by ScriptStrategy auto-detect)', async () => {
    const filePath = await writeSkill('script-skill.md', [
      '---',
      'name: T',
      'allow_scripts: true',
      'scripts:',
      '  - main.py',
      '---',
      '',
    ].join('\n'));
    const result = await parser.parseFile(filePath, dir);
    expect(result.scripts).toEqual(['main.py']);
    expect(result.extra?.['scripts']).toBeUndefined();
  });

  it('drops scripts when entries are not strings (defensive)', async () => {
    const filePath = await writeSkill('bad-scripts.md', [
      '---',
      'name: T',
      'scripts:',
      '  - 42',
      '---',
      '',
    ].join('\n'));
    const result = await parser.parseFile(filePath, dir);
    expect(result.scripts).toBeUndefined();
  });

  it('promotes cacheable boolean from frontmatter', async () => {
    const filePath = await writeSkill('cacheable.md', '---\nname: T\ncacheable: true\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.cacheable).toBe(true);
    expect(result.extra?.['cacheable']).toBeUndefined();
  });

  it('promotes cacheTtlMs from camelCase frontmatter', async () => {
    const filePath = await writeSkill('cache-ttl-camel.md', '---\nname: T\ncacheTtlMs: 60000\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.cacheTtlMs).toBe(60000);
  });

  it('normalizes cache_ttl_ms snake_case to cacheTtlMs', async () => {
    const filePath = await writeSkill('cache-ttl-snake.md', '---\nname: T\ncache_ttl_ms: 30000\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.cacheTtlMs).toBe(30000);
  });

  it('drops cacheTtlMs <= 0 (matches CacheDecorator opt-in semantics)', async () => {
    const filePath = await writeSkill('cache-ttl-zero.md', '---\nname: T\ncacheTtlMs: 0\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.cacheTtlMs).toBeUndefined();
  });

  it('defaults format to custom for generic filename', async () => {
    const filePath = await writeSkill('generic.md', '---\nname: T\n---\n');
    const result = await parser.parseFile(filePath, dir);
    expect(result.format).toBe('custom');
  });

  it('sets folder from the argument', async () => {
    const filePath = await writeSkill('folder-test.md', '---\nname: T\n---\n');
    const result = await parser.parseFile(filePath, '/some/configured/folder');
    expect(result.folder).toBe('/some/configured/folder');
  });

  it('detects claude format for SKILL.md filename', async () => {
    const subDir = join(dir, 'myskill');
    await mkdir(subDir);
    const filePath = join(subDir, 'SKILL.md');
    await writeFile(filePath, '---\nname: T\n---\n', 'utf-8');
    const result = await parser.parseFile(filePath, dir);
    expect(result.format).toBe('claude');
  });
});

describe('FrontmatterParser — scriptsDir injection', () => {
  it('populates scriptsDir when detector returns a path', async () => {
    const expectedDir = join(dir, 'scripts');
    const fakeDetector: ScriptsDirDetector = {
      detect: vi.fn(async () => expectedDir),
    };
    const parserWithDetector = new FrontmatterParser({ scriptsDirDetector: fakeDetector });
    const filePath = await writeSkill('script-skill.md', '---\nname: ScriptSkill\n---\n');

    const result = await parserWithDetector.parseFile(filePath, dir);

    expect(result.scriptsDir).toBe(expectedDir);
  });

  it('leaves scriptsDir undefined when detector returns undefined', async () => {
    const fakeDetector: ScriptsDirDetector = {
      detect: vi.fn(async () => undefined),
    };
    const parserWithDetector = new FrontmatterParser({ scriptsDirDetector: fakeDetector });
    const filePath = await writeSkill('no-scripts-skill.md', '---\nname: NoScripts\n---\n');

    const result = await parserWithDetector.parseFile(filePath, dir);

    expect(result.scriptsDir).toBeUndefined();
  });

  it('calls detector with the absolute skill file path', async () => {
    const detectSpy = vi.fn(async () => undefined as string | undefined);
    const fakeDetector: ScriptsDirDetector = { detect: detectSpy };
    const parserWithDetector = new FrontmatterParser({ scriptsDirDetector: fakeDetector });
    const filePath = await writeSkill('path-check-skill.md', '---\nname: PathCheck\n---\n');

    await parserWithDetector.parseFile(filePath, dir);

    expect(detectSpy).toHaveBeenCalledWith(filePath);
  });
});
