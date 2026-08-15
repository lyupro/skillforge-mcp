#!/usr/bin/env node
/**
 * Removes the build output before tsc writes it again.
 *
 * tsc never deletes stale emit, so a source file that was renamed or removed
 * keeps its compiled copy in dist forever — and `files: ["dist"]` ships it.
 * That is how a test-only helper reached the 1.15.0 tarball.
 */

import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(repoRoot, 'dist');

// Refuse anything that is not the dist directory of this repository: this
// script runs on every build, so a wrong path here deletes real work.
if (resolve(target) !== resolve(repoRoot, 'dist')) {
  console.error(`[clean-dist] refusing to remove ${target}`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
console.log('[clean-dist] removed dist/');
