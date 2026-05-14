import { describe, it, expect } from 'vitest';
import { SkillMetadataCache } from './skill-metadata-cache.js';

describe('SkillMetadataCache', () => {
  it('new instance: isValid() is false and expiresAt() is null', () => {
    const cache = new SkillMetadataCache();
    expect(cache.isValid()).toBe(false);
    expect(cache.expiresAt()).toBeNull();
  });

  it('markFresh() immediately makes isValid() true', () => {
    let nowMs = 1000;
    const clock = () => nowMs;
    const cache = new SkillMetadataCache({ now: clock });
    cache.markFresh();
    expect(cache.isValid()).toBe(true);
  });

  it('isValid() is false after clock advances past TTL', () => {
    let nowMs = 0;
    const clock = () => nowMs;
    const cache = new SkillMetadataCache({ ttlMs: 1000, now: clock });
    cache.markFresh();
    nowMs = 999; // still within TTL (999 < 1000)
    expect(cache.isValid()).toBe(true);
    nowMs = 1000; // exactly at boundary: now - freshAt === ttlMs, not < ttlMs → expired
    expect(cache.isValid()).toBe(false);
  });

  it('expiresAt() equals freshAt + ttlMs', () => {
    let nowMs = 5000;
    const clock = () => nowMs;
    const cache = new SkillMetadataCache({ ttlMs: 300_000, now: clock });
    cache.markFresh();
    expect(cache.expiresAt()).toBe(5000 + 300_000);
  });

  it('invalidate() after markFresh() resets isValid() and expiresAt()', () => {
    let nowMs = 0;
    const clock = () => nowMs;
    const cache = new SkillMetadataCache({ now: clock });
    cache.markFresh();
    cache.invalidate();
    expect(cache.isValid()).toBe(false);
    expect(cache.expiresAt()).toBeNull();
  });

  it('respects custom ttlMs', () => {
    let nowMs = 0;
    const clock = () => nowMs;
    const cache = new SkillMetadataCache({ ttlMs: 60_000, now: clock });
    expect(cache.ttlMs).toBe(60_000);
    cache.markFresh();
    nowMs = 59_999;
    expect(cache.isValid()).toBe(true);
    nowMs = 60_001;
    expect(cache.isValid()).toBe(false);
  });

  it('constructor rejects ttlMs <= 0', () => {
    expect(() => new SkillMetadataCache({ ttlMs: 0 })).toThrow();
    expect(() => new SkillMetadataCache({ ttlMs: -1 })).toThrow();
  });
});
