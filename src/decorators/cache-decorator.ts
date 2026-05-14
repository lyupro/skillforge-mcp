import { createHash } from 'node:crypto';
import { BaseDecorator } from './base-decorator.js';
import type { InvocationContext, InvocationResult, SkillContent } from '../core/types.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';

export interface CacheDecoratorDeps {
  /** Default TTL in ms applied when skill.metadata.cacheTtlMs absent. */
  ttlMs: number;
  /** Max cached entries; oldest evicted (LRU via Map insertion order). */
  maxEntries: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now(). */
  clock?: () => number;
}

interface CacheEntry {
  result: InvocationResult;
  expiresAt: number;
}

function hashKey(name: string, input: string): string {
  const h = createHash('sha256');
  h.update(name);
  h.update('\x00');
  h.update(input);
  return h.digest('hex').slice(0, 16);
}

/**
 * Decorator that caches successful InvocationResults per (skillName, input) pair.
 *
 * Caching is opt-in: enabled only when `skill.cacheable === true` or
 * `skill.cacheTtlMs > 0`. Disabled skills pass through with zero overhead.
 *
 * Only `ok: true` results are cached. Caching failures would pin bad outputs
 * for the entire TTL window — better to let the inner strategy retry each time.
 *
 * LRU eviction uses Map insertion-order: on a cache hit the entry is
 * deleted and re-inserted so it becomes the most-recently-used position.
 */
export class CacheDecorator extends BaseDecorator {
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #clock: () => number;
  readonly #store = new Map<string, CacheEntry>();

  constructor(inner: InvocationStrategy, deps: CacheDecoratorDeps) {
    super(inner);
    this.#ttlMs = deps.ttlMs;
    this.#maxEntries = deps.maxEntries;
    this.#clock = deps.clock ?? (() => Date.now());
  }

  async invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult> {
    if (!this.#isCacheable(skill)) {
      return await this.inner.invoke(skill, context);
    }

    const key = hashKey(skill.name ?? '<unknown>', context.input);
    const now = this.#clock();
    const hit = this.#store.get(key);

    if (hit !== undefined) {
      if (hit.expiresAt > now) {
        // Refresh LRU position: delete + reinsert moves key to newest slot.
        this.#store.delete(key);
        this.#store.set(key, hit);
        return hit.result;
      }
      // Expired — evict stale entry before delegating.
      this.#store.delete(key);
    }

    const result = await this.inner.invoke(skill, context);

    // Only cache successful results to avoid pinning bad outputs across TTL.
    if (result.ok) {
      const ttl = this.#resolveTtl(skill);
      this.#store.set(key, { result, expiresAt: now + ttl });
      this.#evictIfFull();
    }

    return result;
  }

  /** Number of entries currently in the cache (including potentially stale). */
  size(): number {
    return this.#store.size;
  }

  /** Remove all cached entries. */
  clear(): void {
    this.#store.clear();
  }

  #isCacheable(skill: SkillContent): boolean {
    if (skill.cacheable === true) return true;
    if (typeof skill.cacheTtlMs === 'number' && skill.cacheTtlMs > 0) return true;
    return false;
  }

  #resolveTtl(skill: SkillContent): number {
    if (typeof skill.cacheTtlMs === 'number' && skill.cacheTtlMs > 0) {
      return skill.cacheTtlMs;
    }
    return this.#ttlMs;
  }

  #evictIfFull(): void {
    while (this.#store.size > this.#maxEntries) {
      const oldestKey = this.#store.keys().next().value;
      if (oldestKey === undefined) break;
      this.#store.delete(oldestKey);
    }
  }
}
