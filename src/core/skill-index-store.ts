/**
 * Persistent on-disk registry index.
 *
 * Every `skills get` CLI call is a fresh process with an empty in-memory
 * metadata cache, which otherwise forces a full cold scan (recursive readdir
 * + frontmatter parse of every skill file). This store persists a snapshot of
 * the resolved registry to disk so subsequent processes can hydrate the
 * registry from one file read and parse only the requested skill.
 *
 * The index carries a fingerprint of the source folders (file paths +
 * mtimeMs). A caller recomputes the fingerprint cheaply (filesystem metadata
 * only) and rebuilds when it no longer matches.
 *
 * Load returns null on a missing, corrupt, or version-mismatched index — the
 * caller treats that as a cache miss and performs a full rebuild.
 */

import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { readJsonSafe, writeJsonAtomic } from '../installers/atomic-write.js';

/** Bumped when the on-disk index shape changes — older indexes load as null. */
export const INDEX_VERSION = 2;

const indexEntrySchema = z.object({
  sourcePath: z.string(),
  folder: z.string(),
  format: z.enum(['claude', 'codex', 'persona', 'custom']),
  mtimeMs: z.number(),
  // description + tags are carried so `skills list` (which filters on them)
  // stays correct when the registry is hydrated from the index instead of a
  // full parse. Both are populated for free during the rebuild that writes
  // the index — no extra disk read.
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Provenance — which skill-format descriptor matched and whether the name
  // was read from frontmatter or derived from the directory. Optional so an
  // index written before this field still loads.
  formatId: z.string().optional(),
  nameSource: z.enum(['frontmatter', 'directory']).optional(),
});

const registryIndexSchema = z.object({
  version: z.number(),
  fingerprint: z.string(),
  skills: z.record(z.string(), indexEntrySchema),
});

export type SkillIndexEntry = z.infer<typeof indexEntrySchema>;
export type RegistryIndex = z.infer<typeof registryIndexSchema>;

export class SkillIndexStore {
  readonly #path: string;

  constructor(indexPath: string) {
    this.#path = indexPath;
  }

  getPath(): string {
    return this.#path;
  }

  /**
   * Load the on-disk index. Returns null on a missing file, corrupt JSON,
   * schema mismatch, or a version mismatch — every failure mode degrades to a
   * cache miss rather than an exception.
   */
  async load(): Promise<RegistryIndex | null> {
    let raw: unknown;
    try {
      raw = await readJsonSafe(this.#path);
    } catch {
      // Corrupt JSON — treat as missing.
      return null;
    }
    if (raw === null) return null;

    const result = registryIndexSchema.safeParse(raw);
    if (!result.success) return null;
    if (result.data.version !== INDEX_VERSION) return null;

    return result.data;
  }

  /** Atomically write the index to disk. */
  async save(index: RegistryIndex): Promise<void> {
    await writeJsonAtomic(this.#path, index);
  }

  /**
   * Remove the on-disk index. Called by the watchers when a skill file or the
   * config changes — the next process then rebuilds from scratch. Best-effort:
   * a missing file is not an error.
   */
  async invalidate(): Promise<void> {
    try {
      await unlink(this.#path);
    } catch {
      // Already absent — nothing to invalidate.
    }
  }
}
