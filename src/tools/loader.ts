import type { SkillMetadata } from '../core/types.js';
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

/** Unconditionally invalidate caches and rescan all configured folders.
 *  Pure rebuild — does NOT consult metadataCache.isValid() first.
 *  Used by both ensureRegistryFresh (after the freshness gate) and the
 *  reload tool (which always wants a fresh scan regardless of TTL). */
export async function rebuildRegistry(deps: ServerDeps, opts?: RebuildOptions): Promise<RebuildStats> {
  const errorSink = opts?.errorSink;

  deps.registry.clear();
  deps.contentCache.clear();

  // Collect all candidates grouped by skill name for conflict resolution.
  const candidates = new Map<string, SkillMetadata[]>();

  for (const folder of deps.folders) {
    let filePaths: string[];
    try {
      filePaths = await deps.scanner.scan(folder);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (errorSink !== undefined) {
        errorSink.push({ path: folder, message: msg });
      } else {
        console.error(`[skillforge] skipped folder ${folder}: ${msg}`);
      }
      continue;
    }

    for (const filePath of filePaths) {
      let content;
      try {
        content = await deps.parser.parseFile(filePath, folder);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (errorSink !== undefined) {
          errorSink.push({ path: filePath, message: msg });
        } else {
          console.error(`[skillforge] skipped ${filePath}: ${msg}`);
        }
        continue;
      }

      // Derive metadata snapshot (strip body + raw).
      const { body: _body, raw: _raw, ...metadata } = content;
      const meta: SkillMetadata = metadata;

      const verdict = deps.blacklistFilter.evaluate(content);
      if (!verdict.allowed) {
        const detail = verdict.reason === 'manual'
          ? 'blacklisted by name'
          : `audit hit: ${verdict.pattern}`;
        // Blacklist rejections are routine exclusions — always log to stderr, never sink.
        console.error(`[skillforge] excluded "${meta.name}" from ${filePath} — ${detail}`);
        continue;
      }

      const existing = candidates.get(meta.name) ?? [];
      existing.push(meta);
      candidates.set(meta.name, existing);

      // Store full content so resolve winner can be cached below.
      // We keep all candidates' content; winner selection happens after.
      deps.contentCache.set(meta.name + '\x00' + folder, content);
    }
  }

  // Resolve conflicts and register winners.
  for (const [name, group] of candidates) {
    const winner = deps.resolver.resolve(group, deps.folders);
    deps.registry.register(winner);

    // Retrieve the full content for the winner from the temporary keyed cache.
    const tempKey = name + '\x00' + winner.folder;
    const winnerContent = deps.contentCache.get(tempKey);
    if (winnerContent !== undefined) {
      deps.contentCache.set(name, winnerContent);
    }
    // Clean up temp keys (all candidates for this name).
    for (const candidate of group) {
      deps.contentCache.invalidate(name + '\x00' + candidate.folder);
    }
  }

  deps.metadataCache.markFresh();

  const skills = deps.registry.getAll().map((s) => s.name).sort();
  const errors = errorSink ?? [];
  return { skills, errors };
}

/**
 * Ensures the skill registry is populated and fresh.
 * Scans all configured folders on first call or when the TTL has expired.
 * Individual bad files and missing folders are logged to stderr and skipped —
 * one failure never aborts the whole scan.
 */
export async function ensureRegistryFresh(deps: ServerDeps): Promise<void> {
  if (deps.metadataCache.isValid()) return;
  await rebuildRegistry(deps);  // errors go to stderr via default behavior
}
