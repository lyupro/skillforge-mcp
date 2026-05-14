import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileScanner } from './file-scanner.js';

let dir: string;
let scanner: FileScanner;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillforge-scanner-'));
  scanner = new FileScanner();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileScanner', () => {
  it('returns empty array for empty folder', async () => {
    const result = await scanner.scan(dir);
    expect(result).toEqual([]);
  });

  it('finds all .md files recursively, sorted', async () => {
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'b.md'), '', 'utf-8');
    await writeFile(join(dir, 'a.md'), '', 'utf-8');
    await writeFile(join(dir, 'sub', 'c.md'), '', 'utf-8');

    const result = await scanner.scan(dir);

    expect(result).toHaveLength(3);
    expect(result[0]).toContain('a.md');
    expect(result[1]).toContain('b.md');
    expect(result[2]).toContain('c.md');
  });

  it('skips node_modules directory', async () => {
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'ignored.md'), '', 'utf-8');
    await writeFile(join(dir, 'real.md'), '', 'utf-8');

    const result = await scanner.scan(dir);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('real.md');
  });

  it('filters out non-.md files', async () => {
    await writeFile(join(dir, 'file.txt'), '', 'utf-8');
    await writeFile(join(dir, 'file.ts'), '', 'utf-8');
    await writeFile(join(dir, 'file.md'), '', 'utf-8');

    const result = await scanner.scan(dir);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('file.md');
  });

  it('throws clear error for non-existent folder', async () => {
    const missing = join(dir, 'does-not-exist');
    await expect(scanner.scan(missing)).rejects.toThrow(`Folder not found: ${missing}`);
  });

  it('respects custom ignoreDirs', async () => {
    const customScanner = new FileScanner({ ignoreDirs: ['custom-ignore'] });
    await mkdir(join(dir, 'custom-ignore'));
    await writeFile(join(dir, 'custom-ignore', 'ignored.md'), '', 'utf-8');
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'not-ignored.md'), '', 'utf-8');
    await writeFile(join(dir, 'real.md'), '', 'utf-8');

    const result = await customScanner.scan(dir);

    expect(result.some((p) => p.includes('custom-ignore'))).toBe(false);
    expect(result.some((p) => p.includes('not-ignored.md'))).toBe(true);
    expect(result.some((p) => p.includes('real.md'))).toBe(true);
  });

  it('skips .git and dist directories by default', async () => {
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'config.md'), '', 'utf-8');
    await mkdir(join(dir, 'dist'));
    await writeFile(join(dir, 'dist', 'output.md'), '', 'utf-8');
    await writeFile(join(dir, 'real.md'), '', 'utf-8');

    const result = await scanner.scan(dir);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('real.md');
  });
});
