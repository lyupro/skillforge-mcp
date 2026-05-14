import { describe, it, expect } from 'vitest';
import { SkillContentCache } from './skill-content-cache.js';
import type { SkillContent } from './types.js';

function makeContent(name: string, body = 'body'): SkillContent {
  return {
    name,
    body,
    raw: `---\nname: ${name}\n---\n${body}`,
    sourcePath: `/skills/${name}/SKILL.md`,
    folder: '/skills',
    format: 'claude',
    description: undefined,
    tags: [],
  };
}

describe('SkillContentCache', () => {
  it('empty cache: get returns undefined and size is 0', () => {
    const cache = new SkillContentCache();
    expect(cache.get('x')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('set then get returns the same content object', () => {
    const cache = new SkillContentCache();
    const content = makeContent('foo');
    cache.set('foo', content);
    expect(cache.get('foo')).toBe(content);
    expect(cache.size).toBe(1);
  });

  it('entry expires after TTL and size drops', () => {
    let nowMs = 0;
    const clock = () => nowMs;
    const cache = new SkillContentCache({ ttlMs: 1000, now: clock });
    cache.set('foo', makeContent('foo'));
    nowMs = 999;
    expect(cache.get('foo')).toBeDefined();
    nowMs = 1000; // expiresAt = 0 + 1000; now >= expiresAt → expired
    expect(cache.get('foo')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('invalidate(name) returns true when entry exists, false when absent', () => {
    const cache = new SkillContentCache();
    cache.set('foo', makeContent('foo'));
    expect(cache.invalidate('foo')).toBe(true);
    expect(cache.invalidate('foo')).toBe(false);
    expect(cache.invalidate('bar')).toBe(false);
  });

  it('clear() empties the cache', () => {
    const cache = new SkillContentCache();
    cache.set('a', makeContent('a'));
    cache.set('b', makeContent('b'));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('LRU eviction: inserting a 3rd entry (maxEntries=2) evicts the oldest; get does NOT update LRU order (intentional — LRU only on set)', () => {
    let nowMs = 0;
    const clock = () => nowMs;
    const cache = new SkillContentCache({ ttlMs: 999_999, now: clock, maxEntries: 2 });
    cache.set('a', makeContent('a'));
    cache.set('b', makeContent('b'));
    // Access 'a' via get — this does NOT move 'a' to end (LRU only updated on set).
    cache.get('a');
    // Insert 'c' — oldest in insertion order is 'a', so 'a' is evicted.
    cache.set('c', makeContent('c'));
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined(); // evicted
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('re-set of existing key moves it to end of insertion order', () => {
    let nowMs = 0;
    const clock = () => nowMs;
    const cache = new SkillContentCache({ ttlMs: 999_999, now: clock, maxEntries: 2 });
    cache.set('a', makeContent('a'));
    cache.set('b', makeContent('b'));
    // Re-set 'a' — moves 'a' to end, so 'b' becomes the oldest.
    cache.set('a', makeContent('a', 'updated'));
    // Insert 'c' — should evict 'b' (now oldest).
    cache.set('c', makeContent('c'));
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined(); // evicted
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('a')?.body).toBe('updated');
    expect(cache.get('c')).toBeDefined();
  });

  it('constructor rejects ttlMs <= 0', () => {
    expect(() => new SkillContentCache({ ttlMs: 0 })).toThrow();
    expect(() => new SkillContentCache({ ttlMs: -5 })).toThrow();
  });

  it('constructor rejects maxEntries <= 0', () => {
    expect(() => new SkillContentCache({ maxEntries: 0 })).toThrow();
    expect(() => new SkillContentCache({ maxEntries: -1 })).toThrow();
  });
});
