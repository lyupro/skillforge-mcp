import { stat } from 'node:fs/promises';
import type { SkillMetadata } from '../core/types.js';
import type { RegistryIndex } from '../core/index.js';
import { INDEX_VERSION, computeFingerprint } from '../core/index.js';
import type { ServerDeps } from '../server-deps.js';

export interface RebuildOptions {
  /** When set, errors are pushed here instead of going to stderr. */
  errorSink?: Array<{ path: string; message: string }>;
}

export interface RebuildStats {
  /** All skill names in the registry AFTER the rebuild. */
  skills: string[];
  /** Per-file failures encountered during scan/parse/blacklist. */
  errors: Array<{ path: string; message: string }>;
}

export interface FolderScanResult {
  candidates: SkillMetadata[];
  errors: Array<{ path: string; message: string }>;
}

/** Build a RegistryIndex snapshot from the current registry contents plus a
 *  freshly computed fingerprint of the configured folders. */
async function buildIndexSnapshot(deps: ServerDeps): Promise<RegistryIndex> {
  const fingerprint = await computeFingerprint(deps.folders);
  const skills: RegistryIndex['skills'] = {};

  for (const name of deps.registry.getAll().map((meta) => meta.name)) {
    const entries: RegistryIndex['skills'][string] = [];
    for (const meta of deps.registry.getCandidates(name)) {
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(meta.sourcePath)).mtimeMs;
      } catch {
        // File vanished between scan and snapshot — fingerprint will catch it.
      }
      entries.push({
        sourcePath: meta.sourcePath,
        folder: meta.folder,
        format: meta.format,
        mtimeMs,
        description: meta.description,
        tags: meta.tags,
        formatId: meta.formatId,
        nameSource: meta.nameSource,
      });
    }
    skills[name] = entries;
  }

  return { version: INDEX_VERSION, fingerprint, skills };
}

/** Persist the current registry to the on-disk index. Best-effort: a write
 *  failure is logged but never aborts the rebuild. */
async function persistIndex(deps: ServerDeps): Promise<void> {
  if (!deps.indexEnabled) return;
  try {
    const snapshot = await buildIndexSnapshot(deps);
    await deps.indexStore.save(snapshot);
  } catch (err) {
    // Persisting the cached index is best-effort — operator should see warn-level
    // failure so a perma-broken cache is visible without forcing debug.
    deps.logger.warn(`[skillforge] failed to write registry index: ${String(err)}`);
  }
}

/** Hydrate the in-memory registry from an on-disk index without parsing skill
 *  files. Skill bodies are fetched lazily on `get` by parsing the one target
 *  file. The content cache is left empty — `handleGet` re-parses on miss. */
function hydrateFromIndex(deps: ServerDeps, index: RegistryIndex): void {
  deps.registry.clear();
  deps.contentCache.clear();
  for (const [name, entries] of Object.entries(index.skills)) {
    // The registry stores candidates newest-first because register() prepends.
    // Reverse the persisted registry order to reproduce the full-scan order.
    for (const entry of [...entries].reverse()) {
      const meta: SkillMetadata = {
        name,
        sourcePath: entry.sourcePath,
        folder: entry.folder,
        format: entry.format,
        description: entry.description,
        tags: entry.tags,
        formatId: entry.formatId,
        nameSource: entry.nameSource,
      };
      deps.registry.register(meta);
    }
  }
  deps.metadataCache.markFresh();
}

/** Scan and parse one configured root without affecting any other root. */
export async function scanFolder(deps: ServerDeps, folder: string): Promise<FolderScanResult> {
  const candidates: SkillMetadata[] = [];
  const errors: FolderScanResult['errors'] = [];
  let filePaths: string[];
  try {
    filePaths = await deps.scanner.scan(folder);
  } catch (err) {
    errors.push({ path: folder, message: err instanceof Error ? err.message : String(err) });
    return { candidates, errors };
  }

  for (const filePath of filePaths) {
    let content;
    try {
      content = await deps.parser.tryParseFile(filePath, folder);
      if (content === null) continue;
    } catch (err) {
      errors.push({ path: filePath, message: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const { body: _body, raw: _raw, ...metadata } = content;
    const meta: SkillMetadata = metadata;
    const verdict = deps.blacklistFilter.evaluate(content);
    if (!verdict.allowed) {
      const detail = verdict.reason === 'manual'
        ? `blacklisted by "${verdict.pattern}"`
        : `audit hit: ${verdict.pattern}`;
      deps.logger.warn(`[skillforge] excluded "${meta.name}" from ${filePath} — ${detail}`);
      continue;
    }
    for (const note of verdict.informationalNotes ?? []) {
      deps.logger.debug(
        `[skillforge] audit note (informational): "${note.pattern}" in ${note.reason} ` +
          `— not blocking "${meta.name}"`,
      );
    }

    candidates.push(meta);
    deps.contentCache.set(meta.name + '\x00' + meta.sourcePath, content);
  }

  return { candidates, errors };
}

/** Unconditionally invalidate caches and rescan all configured folders.
 *  Pure rebuild — does NOT consult metadataCache.isValid() first.
 *  Used by both ensureRegistryFresh (after the freshness gate) and the
 *  reload tool (which always wants a fresh scan regardless of TTL).
 *  After a successful scan the on-disk index is rewritten. */
export async function rebuildRegistry(deps: ServerDeps, opts?: RebuildOptions): Promise<RebuildStats> {
  const errorSink = opts?.errorSink;

  deps.registry.clear();
  deps.contentCache.clear();

  for (const folder of deps.folders) {
    const result = await scanFolder(deps, folder);
    deps.registry.replaceRoot(folder, result.candidates);
    for (const error of result.errors) {
      if (errorSink !== undefined) {
        errorSink.push(error);
      } else if (error.path === folder) {
        deps.logger.warn(`[skillforge] skipped folder ${folder}: ${error.message}`);
      } else {
        deps.logger.debug(`[skillforge] skipped ${error.path}: ${error.message}`);
      }
    }
  }

  for (const winner of deps.registry.getAll()) {
    const group = deps.registry.getCandidates(winner.name);
    // A name shared by multiple candidates — warn and report the registry's
    // priority-ordered winner. Derived directory names flow through this same
    // path, so a derived name colliding with a frontmatter name is deduped too.
    if (group.length > 1) {
      const losers = group
        .filter((m) => m !== winner)
        .map((m) => m.sourcePath)
        .join(', ');
      deps.logger.warn(
        `[skillforge] name collision for "${winner.name}" — kept ${winner.sourcePath}, ` +
          `ignored: ${losers}`,
      );
    }
    // Retrieve the full content for the winner from the temporary keyed cache.
    const tempKey = winner.name + '\x00' + winner.sourcePath;
    const winnerContent = deps.contentCache.get(tempKey);
    if (winnerContent !== undefined) {
      deps.contentCache.set(winner.name, winnerContent);
    }
    // Clean up temp keys (all candidates for this name).
    for (const candidate of group) {
      deps.contentCache.invalidate(winner.name + '\x00' + candidate.sourcePath);
    }
  }

  deps.metadataCache.markFresh();

  // Persist the rebuilt registry to the on-disk index for the next process.
  await persistIndex(deps);

  const skills = deps.registry.getAll().map((s) => s.name).sort();
  const errors = errorSink ?? [];
  return { skills, errors };
}

/**
 * Ensures the skill registry is populated and fresh.
 *
 * Freshness gate, in order:
 *   1. In-memory metadata cache valid (same process, within TTL) → return.
 *   2. On-disk index enabled and its fingerprint still matches the configured
 *      folders → hydrate the registry from the index, skip the cold scan.
 *   3. Otherwise → full rebuild + index rewrite.
 *
 * Individual bad files and missing folders are logged to stderr and skipped —
 * one failure never aborts the whole scan.
 */
export async function ensureRegistryFresh(deps: ServerDeps): Promise<void> {
  if (deps.metadataCache.isValid()) return;

  if (deps.indexEnabled) {
    const index = await deps.indexStore.load();
    if (index !== null) {
      const fingerprint = await computeFingerprint(deps.folders);
      if (fingerprint === index.fingerprint) {
        hydrateFromIndex(deps, index);
        return;
      }
    }
  }

  await rebuildRegistry(deps);  // errors go to stderr via default behavior
}
