import { describe, it, expect } from 'vitest';
import {
  classifyPattern,
  compileBlacklist,
  matchBlacklist,
} from './blacklist-pattern.js';

describe('classifyPattern', () => {
  it('treats a plain name as exact', () => {
    expect(classifyPattern('research-orchestrator')).toBe('exact');
  });

  it('treats a wildcard without slash as name-glob', () => {
    expect(classifyPattern('wiki-*')).toBe('name-glob');
    expect(classifyPattern('cs-?')).toBe('name-glob');
  });

  it('treats any slash as path-glob (even without wildcard)', () => {
    expect(classifyPattern('engineering/llm-wiki')).toBe('path-glob');
    expect(classifyPattern('**/agenthub/**')).toBe('path-glob');
  });
});

describe('compileBlacklist', () => {
  it('trims and drops empty/whitespace entries', () => {
    const c = compileBlacklist(['  foo  ', '', '   ', 'bar']);
    expect([...c.exact].sort()).toEqual(['bar', 'foo']);
  });

  it('deduplicates after trim', () => {
    const c = compileBlacklist(['foo', '  foo  ', 'foo']);
    expect([...c.exact]).toEqual(['foo']);
  });

  it('routes each pattern to the right bucket', () => {
    const c = compileBlacklist(['exact-one', 'glob-*', 'path/**']);
    expect([...c.exact]).toEqual(['exact-one']);
    expect(c.nameGlobs.map((g) => g.pattern)).toEqual(['glob-*']);
    expect(c.pathGlobs.map((g) => g.pattern)).toEqual(['path/**']);
  });
});

describe('matchBlacklist', () => {
  it('matches an exact name (regression) and returns the name', () => {
    const c = compileBlacklist(['danger-skill']);
    expect(matchBlacklist(c, 'danger-skill', 'danger-skill.md')).toBe('danger-skill');
    expect(matchBlacklist(c, 'other', 'other.md')).toBeNull();
  });

  it('is case-sensitive on exact names', () => {
    const c = compileBlacklist(['Danger']);
    expect(matchBlacklist(c, 'Danger', 'Danger.md')).toBe('Danger');
    expect(matchBlacklist(c, 'danger', 'danger.md')).toBeNull();
  });

  it('matches a name-glob and returns the pattern', () => {
    const c = compileBlacklist(['wiki-*']);
    expect(matchBlacklist(c, 'wiki-foo', 'wiki-foo.md')).toBe('wiki-*');
    expect(matchBlacklist(c, 'other', 'other.md')).toBeNull();
  });

  it('matches a single-char ? in a name-glob', () => {
    const c = compileBlacklist(['cs-?']);
    expect(matchBlacklist(c, 'cs-a', 'cs-a.md')).toBe('cs-?');
    expect(matchBlacklist(c, 'cs-ab', 'cs-ab.md')).toBeNull();
  });

  it('matches a path-glob with ** crossing separators', () => {
    const c = compileBlacklist(['**/agenthub/**']);
    expect(matchBlacklist(c, 'x', 'agenthub/x/SKILL.md')).toBe('**/agenthub/**');
    expect(matchBlacklist(c, 'x', 'a/agenthub/b/SKILL.md')).toBe('**/agenthub/**');
    expect(matchBlacklist(c, 'x', 'other/x/SKILL.md')).toBeNull();
  });

  it('matches a precise path-glob prefix', () => {
    const c = compileBlacklist(['engineering/llm-wiki/**']);
    expect(matchBlacklist(c, 'x', 'engineering/llm-wiki/foo/SKILL.md')).toBe(
      'engineering/llm-wiki/**',
    );
    expect(matchBlacklist(c, 'x', 'engineering/other/SKILL.md')).toBeNull();
  });

  it('single * in a path-glob does NOT cross a separator', () => {
    const c = compileBlacklist(['*/SKILL.md']);
    expect(matchBlacklist(c, 'x', 'foo/SKILL.md')).toBe('*/SKILL.md');
    expect(matchBlacklist(c, 'x', 'foo/bar/SKILL.md')).toBeNull();
  });

  it('exact wins over an overlapping name-glob (precedence)', () => {
    const c = compileBlacklist(['wiki-foo', 'wiki-*']);
    // exact bucket short-circuits and returns the literal name, not the glob
    expect(matchBlacklist(c, 'wiki-foo', 'wiki-foo.md')).toBe('wiki-foo');
  });

  it('returns null for an empty compiled blacklist', () => {
    const c = compileBlacklist(['', '   ']);
    expect(matchBlacklist(c, 'anything', 'anything.md')).toBeNull();
  });
});
