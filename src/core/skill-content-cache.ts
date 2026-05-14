import type { SkillContent } from './types.js';

interface ContentCacheOptions {
  ttlMs?: number;
  now?: () => number;
  maxEntries?: number;
}

interface CacheEntry {
  content: SkillContent;
  expiresAt: number;
}

export class SkillContentCache {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #maxEntries: number;
  // Map preserves insertion order — first entry is least-recently-used.
  readonly #store = new Map<string, CacheEntry>();

  constructor(options?: ContentCacheOptions) {
    const ttlMs = options?.ttlMs ?? 300_000;
    const maxEntries = options?.maxEntries ?? 256;
    if (ttlMs <= 0) {
      throw new Error('ttlMs must be a positive number');
    }
    if (maxEntries <= 0) {
      throw new Error('maxEntries must be a positive number');
    }
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = options?.now ?? Date.now;
  }

  get(name: string): SkillContent | undefined {
    const entry = this.#store.get(name);
    if (entry === undefined) return undefined;
    if (this.#now() >= entry.expiresAt) {
      // Remove stale entry rather than serving expired content.
      this.#store.delete(name);
      return undefined;
    }
    return entry.content;
  }

  set(name: string, content: SkillContent): void {
    // Move existing key to end (most-recently-used) by removing before re-inserting.
    if (this.#store.has(name)) {
      this.#store.delete(name);
    } else if (this.#store.size >= this.#maxEntries) {
      // Evict the first (least-recently-used) entry.
      const firstKey = this.#store.keys().next().value as string;
      this.#store.delete(firstKey);
    }
    this.#store.set(name, { content, expiresAt: this.#now() + this.#ttlMs });
  }

  invalidate(name: string): boolean {
    return this.#store.delete(name);
  }

  clear(): void {
    this.#store.clear();
  }

  get size(): number {
    return this.#store.size;
  }

  get ttlMs(): number {
    return this.#ttlMs;
  }
}
