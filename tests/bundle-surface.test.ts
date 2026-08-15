/** Guards that test-only sources stay out of the published build. */

import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A helper that only tests import still compiles into dist unless its name
 * matches an exclude pattern — that is how `configure-test-harness.ts` shipped
 * inside the 1.15.0 tarball. Naming is the only signal tsc has, so the naming
 * convention is what this test enforces.
 */
const EXCLUDED_SUFFIXES = ['.test.ts', '.test-harness.ts'];

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    }),
  );
  return files.flat();
}

describe('published bundle surface', () => {
  it('names every test-only source so tsconfig excludes it', async () => {
    const sources = await collectSourceFiles(join(repoRoot, 'src'));
    const leaked = sources
      .filter((file) => /test/i.test(relative(repoRoot, file)))
      .filter((file) => !EXCLUDED_SUFFIXES.some((suffix) => file.endsWith(suffix)))
      .map((file) => relative(repoRoot, file).replace(/\\/g, '/'));

    expect(leaked, 'rename these to *.test.ts or *.test-harness.ts, or they ship to users').toEqual(
      [],
    );
  });

  it('keeps the exclude patterns this convention depends on', async () => {
    const raw = await readFile(join(repoRoot, 'tsconfig.json'), 'utf8');
    const exclude = (JSON.parse(raw) as { exclude: string[] }).exclude;

    for (const suffix of EXCLUDED_SUFFIXES) {
      expect(exclude).toContain(`**/*${suffix}`);
    }
  });
});
