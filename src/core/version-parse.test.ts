import { describe, it, expect } from 'vitest';
import { parseVersionFromPath, parseBundleFromPath, compareVersions, matchesPin } from './version-parse.js';

describe('parseVersionFromPath', () => {
  it('parses the version segment from a posix cache path', () => {
    const v = parseVersionFromPath('/cache/claude-code-skills/engineering-advanced-skills/2.4.4/skills/x/SKILL.md');
    expect(v).toMatchObject({ major: 2, minor: 4, patch: 4, raw: '2.4.4' });
  });

  it('parses a windows backslash path', () => {
    const v = parseVersionFromPath('C:\\cache\\bundle\\1.0.10\\skills\\x\\SKILL.md');
    expect(v).toMatchObject({ major: 1, minor: 0, patch: 10 });
  });

  it('accepts a v-prefix and a pre-release suffix', () => {
    expect(parseVersionFromPath('/a/v2.7.3-beta/x')).toMatchObject({ major: 2, minor: 7, patch: 3 });
  });

  it('returns null when no segment looks like a version', () => {
    expect(parseVersionFromPath('/cache/bundle/skills/x/SKILL.md')).toBeNull();
  });

  it('returns the first version-looking segment', () => {
    expect(parseVersionFromPath('/a/1.2.3/b/9.9.9/x')!.raw).toBe('1.2.3');
  });
});

describe('parseBundleFromPath', () => {
  it('returns the segment before the version segment', () => {
    expect(parseBundleFromPath('/cache/claude-code-skills/engineering-advanced-skills/2.4.4/skills/x/SKILL.md'))
      .toBe('engineering-advanced-skills');
  });
  it('returns null when no version segment exists', () => {
    expect(parseBundleFromPath('/cache/bundle/skills/x/SKILL.md')).toBeNull();
  });
  it('returns null when the version is the first segment (nothing precedes)', () => {
    expect(parseBundleFromPath('2.4.4/x/SKILL.md')).toBeNull();
  });
});

describe('compareVersions', () => {
  const v = (s: string) => parseVersionFromPath(`/${s}/x`)!;
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions(v('2.4.4'), v('2.3.0'))).toBeGreaterThan(0);
    expect(compareVersions(v('2.3.0'), v('2.4.4'))).toBeLessThan(0);
    expect(compareVersions(v('1.0.0'), v('1.0.0'))).toBe(0);
    expect(compareVersions(v('2.0.0'), v('1.9.9'))).toBeGreaterThan(0);
  });
});

describe('matchesPin', () => {
  const v = parseVersionFromPath('/x/2.4.4/y')!;
  it('matches an exact pin', () => {
    expect(matchesPin(v, '2.4.4')).toBe(true);
    expect(matchesPin(v, ' 2.4.4 ')).toBe(true);
  });
  it('rejects a different version or garbage', () => {
    expect(matchesPin(v, '2.3.0')).toBe(false);
    expect(matchesPin(v, 'latest')).toBe(false);
  });
});
