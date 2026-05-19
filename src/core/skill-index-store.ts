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

import { z } from 'zod';
import { readJsonSafe, writeJsonAtomic } from '../installers/atomic-write.js';

/** Bumped when the on-disk index shape changes — older indexes load as null. */
export const INDEX_VERSION = 1;

const indexEntrySchema = z.object({
  sourcePath: z.string(),
  folder: z.string(),
  format: z.enum(['claude', 'codex', 'persona', 'custom']),
  mtimeMs: z.number(),
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
}
