#!/usr/bin/env node
/**
 * File-size limit enforcer (SkillForge MCP).
 *
 * Reads .file-size-limit.json, walks glob patterns, fails on files exceeding maxLines.
 *
 * Usage:
 *   node scripts/check-file-size.mjs            # use mode from config
 *   node scripts/check-file-size.mjs --error    # force error mode
 *   node scripts/check-file-size.mjs --json     # JSON output for CI
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cwd, exit, argv } from 'node:process';
import { glob } from 'glob';

const ROOT = cwd();
const CFG_PATH = resolve(ROOT, '.file-size-limit.json');

const args = new Set(argv.slice(2));
const forceError = args.has('--error');
const jsonOutput = args.has('--json');

async function loadConfig() {
  try {
    const raw = await readFile(CFG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[check-file-size] Failed to read ${CFG_PATH}: ${err.message}`);
    exit(2);
  }
}

async function collectFiles(cfg) {
  const patterns = cfg.include ?? [];
  const ignore = cfg.exclude ?? [];
  const nested = await Promise.all(
    patterns.map((p) => glob(p, { ignore, cwd: ROOT, nodir: true })),
  );
  return [...new Set(nested.flat())];
}

async function measure(file) {
  const content = await readFile(resolve(ROOT, file), 'utf8');
  const lines = content.split('\n').length;
  return { file, lines };
}

function formatTable(rows) {
  const header = 'File'.padEnd(70) + ' | Lines';
  const sep = '-'.repeat(70) + '-+------';
  const body = rows
    .sort((a, b) => b.lines - a.lines)
    .map((r) => r.file.padEnd(70) + ' | ' + String(r.lines).padStart(5))
    .join('\n');
  return `${header}\n${sep}\n${body}`;
}

async function main() {
  const cfg = await loadConfig();
  const limit = cfg.maxLines ?? 400;
  const mode = forceError ? 'error' : cfg.mode ?? 'error';
  const files = await collectFiles(cfg);

  const measured = await Promise.all(files.map(measure));
  const violators = measured.filter((m) => m.lines > limit);

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          limit,
          mode,
          totalFiles: measured.length,
          violatorsCount: violators.length,
          violators,
          baselineDate: cfg.baselineDate ?? null,
        },
        null,
        2,
      ),
    );
  } else {
    const tag = mode === 'error' ? 'ERROR' : 'WARN';
    console.log(`[check-file-size] mode=${mode} limit=${limit} files=${measured.length}`);

    if (violators.length === 0) {
      console.log(`[check-file-size] OK: all ${measured.length} files within limit (${limit} lines)`);
    } else {
      console.log(`[check-file-size] ${tag}: ${violators.length} file(s) exceed ${limit} lines:`);
      console.log(formatTable(violators));
    }

    if (cfg.baselineDate) {
      console.log(`[check-file-size] Baseline date: ${cfg.baselineDate}`);
    }
  }

  if (violators.length > 0 && mode === 'error') {
    exit(1);
  }
  exit(0);
}

main().catch((err) => {
  console.error(`[check-file-size] Unhandled error: ${err.stack ?? err.message ?? err}`);
  exit(2);
});
