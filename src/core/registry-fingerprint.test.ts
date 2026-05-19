import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, unlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFingerprint } from './registry-fingerprint.js';

describe('computeFingerprint', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-fp-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns a stable hash for unchanged folders', async () => {
    await writeFile(join(dir, 'a.md'), 'one', 'utf8');
    await writeFile(join(dir, 'b.md'), 'two', 'utf8');
    const first = await computeFingerprint([dir]);
    const second = await computeFingerprint([dir]);
    expect(first).toBe(second);
  });

  it('changes when a file is added', async () => {
    await writeFile(join(dir, 'a.md'), 'one', 'utf8');
    const before = await computeFingerprint([dir]);
    await writeFile(join(dir, 'b.md'), 'two', 'utf8');
    const after = await computeFingerprint([dir]);
    expect(after).not.toBe(before);
  });

  it('changes when a file is removed', async () => {
    await writeFile(join(dir, 'a.md'), 'one', 'utf8');
    await writeFile(join(dir, 'b.md'), 'two', 'utf8');
    const before = await computeFingerprint([dir]);
    await unlink(join(dir, 'b.md'));
    const after = await computeFingerprint([dir]);
    expect(after).not.toBe(before);
  });

  it('changes when a file is edited in place (mtime advances)', async () => {
    const file = join(dir, 'a.md');
    await writeFile(file, 'one', 'utf8');
    const before = await computeFingerprint([dir]);
    // Advance mtime explicitly — emulates an in-place edit.
    const future = new Date(Date.now() + 60_000);
    await utimes(file, future, future);
    const after = await computeFingerprint([dir]);
    expect(after).not.toBe(before);
  });

  it('ignores node_modules / .git / dist / coverage subdirectories', async () => {
    await writeFile(join(dir, 'a.md'), 'one', 'utf8');
    const baseline = await computeFingerprint([dir]);
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'junk.md'), 'junk', 'utf8');
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'out.md'), 'junk', 'utf8');
    const withIgnored = await computeFingerprint([dir]);
    expect(withIgnored).toBe(baseline);
  });

  it('ignores non-markdown files', async () => {
    await writeFile(join(dir, 'a.md'), 'one', 'utf8');
    const before = await computeFingerprint([dir]);
    await writeFile(join(dir, 'notes.txt'), 'text', 'utf8');
    const after = await computeFingerprint([dir]);
    expect(after).toBe(before);
  });

  it('is order-independent across folders', async () => {
    const dir2 = await mkdtemp(join(tmpdir(), 'sf-fp2-'));
    try {
      await writeFile(join(dir, 'a.md'), 'one', 'utf8');
      await writeFile(join(dir2, 'b.md'), 'two', 'utf8');
      const ab = await computeFingerprint([dir, dir2]);
      const ba = await computeFingerprint([dir2, dir]);
      expect(ab).toBe(ba);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it('tolerates a missing folder', async () => {
    await writeFile(join(dir, 'a.md'), 'one', 'utf8');
    const fp = await computeFingerprint([dir, join(dir, 'does-not-exist')]);
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
  });
});
