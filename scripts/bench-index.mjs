#!/usr/bin/env node
/**
 * Benchmark: persistent registry index vs cold scan.
 *
 * Generates a large synthetic skill catalog in a temp folder, then measures
 * `skills get` two ways against it:
 *   - cold  — no on-disk index, every call does a full recursive scan + parse
 *   - warm  — second+ call hydrates the registry from the on-disk index and
 *             parses only the one target file
 *
 * Runs entirely in-process against the built dist, isolated from the real
 * user config — nothing under ~/.lyupro is touched.
 *
 * Run: node scripts/bench-index.mjs [skillCount]
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = join(REPO_ROOT, 'dist');

/** Dynamic import of a built module by absolute path — file:// URL so the
 *  ESM loader accepts it on Windows (a bare `c:\…` path is rejected). */
function importDist(relativePath) {
  return import(pathToFileURL(join(DIST, relativePath)).href);
}

const SKILL_COUNT = Number(process.argv[2]) || 500;
const ITERATIONS = 20;

async function generateCatalog(folder, count) {
  await mkdir(folder, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    const name = `bench-skill-${String(i).padStart(4, '0')}`;
    const body = `# ${name}\n\n${'Filler paragraph. '.repeat(40)}\n`;
    await writeFile(
      join(folder, `${name}.md`),
      `---\nname: ${name}\ndescription: Synthetic bench skill ${i}.\ntags: [bench]\n---\n${body}`,
      'utf8',
    );
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const {
    SkillRegistry,
    SkillResolver,
    SkillMetadataCache,
    SkillContentCache,
    SkillIndexStore,
  } = await importDist('core/index.js');
  const { FrontmatterParser, FileScanner } = await importDist('parser/index.js');
  const { BlacklistFilter } = await importDist('security/index.js');
  const { ensureRegistryFresh } = await importDist('tools/loader.js');
  const { handleGet } = await importDist('tools/get.js');

  const dir = await mkdtemp(join(tmpdir(), 'sf-bench-'));
  const folder = join(dir, 'skills');
  const indexPath = join(dir, 'cache', 'registry-index.json');

  try {
    process.stdout.write(`Generating ${SKILL_COUNT} synthetic skills…\n`);
    await generateCatalog(folder, SKILL_COUNT);

    /** Build a fresh deps object — emulates a new CLI process. */
    const makeDeps = (indexEnabled) => ({
      folders: [folder],
      registry: new SkillRegistry(),
      resolver: new SkillResolver(),
      // TTL set tiny so each call re-evaluates the freshness gate.
      metadataCache: new SkillMetadataCache({ ttlMs: 1 }),
      contentCache: new SkillContentCache({ ttlMs: 300_000 }),
      indexStore: new SkillIndexStore(indexPath),
      indexEnabled,
      scanner: new FileScanner(),
      parser: new FrontmatterParser(),
      blacklistFilter: new BlacklistFilter(),
    });

    const target = `bench-skill-${String(Math.floor(SKILL_COUNT / 2)).padStart(4, '0')}`;

    // --- Cold: index disabled, every call does a full scan -------------------
    const coldTimes = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const deps = makeDeps(false);
      const t0 = performance.now();
      await ensureRegistryFresh(deps);
      await handleGet(deps, { name: target });
      coldTimes.push(performance.now() - t0);
    }

    // --- Warm: index enabled. First call builds it, then measure hydration ---
    await ensureRegistryFresh(makeDeps(true)); // prime the on-disk index
    const warmTimes = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const deps = makeDeps(true);
      const t0 = performance.now();
      await ensureRegistryFresh(deps);
      await handleGet(deps, { name: target });
      warmTimes.push(performance.now() - t0);
    }

    const coldMed = median(coldTimes);
    const warmMed = median(warmTimes);
    const speedup = (coldMed / warmMed).toFixed(1);

    process.stdout.write('\n');
    process.stdout.write(`skills: ${SKILL_COUNT}   iterations: ${ITERATIONS}\n`);
    process.stdout.write(`cold (--no-cache) median: ${coldMed.toFixed(1)} ms\n`);
    process.stdout.write(`warm (index hit)  median: ${warmMed.toFixed(1)} ms\n`);
    process.stdout.write(`speedup: ${speedup}x\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[bench-index] failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
