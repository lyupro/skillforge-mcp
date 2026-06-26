import { describe, it, expect } from 'vitest';
import {
  ageInDays,
  cooldownBlocks,
  needsSudo,
  parseMinReleaseAge,
} from './update-preflight.js';

describe('needsSudo', () => {
  it('POSIX non-root user + non-writable prefix → true', () => {
    expect(needsSudo({ platform: 'linux', uid: 1000, writable: false })).toBe(true);
  });

  it('writable prefix → false', () => {
    expect(needsSudo({ platform: 'linux', uid: 1000, writable: true })).toBe(false);
  });

  it('root (uid 0) → false', () => {
    expect(needsSudo({ platform: 'linux', uid: 0, writable: false })).toBe(false);
  });

  it('Windows (uid null) → false', () => {
    expect(needsSudo({ platform: 'win32', uid: null, writable: false })).toBe(false);
  });
});

describe('ageInDays', () => {
  const now = 1_700_000_000_000;

  it('null timestamp → null', () => {
    expect(ageInDays(null, now)).toBeNull();
  });

  it('unparseable timestamp → null', () => {
    expect(ageInDays('not-a-date', now)).toBeNull();
  });

  it('computes whole-day age', () => {
    const threeDaysAgo = new Date(now - 3 * 86_400_000).toISOString();
    expect(ageInDays(threeDaysAgo, now)).toBeCloseTo(3, 5);
  });
});

describe('cooldownBlocks', () => {
  it('age below cooldown → blocks', () => {
    expect(cooldownBlocks(7, 2)).toBe(true);
  });

  it('age at/above cooldown → allows', () => {
    expect(cooldownBlocks(7, 7)).toBe(false);
    expect(cooldownBlocks(7, 10)).toBe(false);
  });

  it('no cooldown configured (null/0) → never blocks', () => {
    expect(cooldownBlocks(null, 0)).toBe(false);
    expect(cooldownBlocks(0, 0)).toBe(false);
  });

  it('unknown age (null) → does not block', () => {
    expect(cooldownBlocks(7, null)).toBe(false);
  });
});

describe('parseMinReleaseAge', () => {
  it('empty / undefined / null output → null', () => {
    expect(parseMinReleaseAge('')).toBeNull();
    expect(parseMinReleaseAge('undefined\n')).toBeNull();
    expect(parseMinReleaseAge('null')).toBeNull();
  });

  it('positive integer → number', () => {
    expect(parseMinReleaseAge('7\n')).toBe(7);
  });

  it('zero or negative → null (no cooldown)', () => {
    expect(parseMinReleaseAge('0')).toBeNull();
    expect(parseMinReleaseAge('-3')).toBeNull();
  });

  it('non-numeric → null', () => {
    expect(parseMinReleaseAge('abc')).toBeNull();
  });
});
