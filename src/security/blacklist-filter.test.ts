import { describe, it, expect, vi, afterEach } from 'vitest';
import { BlacklistFilter } from './blacklist-filter.js';
import { PatternScanner } from './pattern-scanner.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeContent(name: string, body = 'safe body') {
  return {
    name,
    description: undefined,
    sourcePath: `/skills/${name}.md`,
    folder: '/skills',
    tags: [],
    format: 'claude' as const,
    allowScripts: false,
    allowNetwork: false,
    body,
    raw: `---\nname: ${name}\n---\n${body}`,
  };
}

describe('BlacklistFilter', () => {
  describe('isNoop()', () => {
    it('returns true when constructed with no options', () => {
      expect(new BlacklistFilter().isNoop()).toBe(true);
    });

    it('returns true when constructed with empty manual list and no scanner', () => {
      expect(new BlacklistFilter({ manualBlacklist: [] }).isNoop()).toBe(true);
    });

    it('returns false when manual list is nonempty', () => {
      expect(new BlacklistFilter({ manualBlacklist: ['foo'] }).isNoop()).toBe(false);
    });

    it('returns false when scanner is provided', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('] });
      expect(new BlacklistFilter({ patternScanner: scanner }).isNoop()).toBe(false);
    });
  });

  describe('manual blacklist', () => {
    it('rejects a skill whose name is in the list', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['danger-skill'] });
      const verdict = filter.evaluate(makeContent('danger-skill'));
      expect(verdict).toEqual({ allowed: false, reason: 'manual', pattern: 'danger-skill' });
    });

    it('allows a skill whose name is not in the list (no scanner)', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['other-skill'] });
      const verdict = filter.evaluate(makeContent('safe-skill'));
      expect(verdict).toEqual({ allowed: true });
    });

    it('is case-sensitive: exact match required', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['Danger'] });
      expect(filter.evaluate(makeContent('danger')).allowed).toBe(true);
      expect(filter.evaluate(makeContent('Danger')).allowed).toBe(false);
    });
  });

  describe('name-glob patterns', () => {
    it('rejects skills matching a name glob and carries the pattern', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['wiki-*'] });
      expect(filter.evaluate(makeContent('wiki-foo'))).toEqual({
        allowed: false,
        reason: 'manual',
        pattern: 'wiki-*',
      });
      expect(filter.evaluate(makeContent('other')).allowed).toBe(true);
    });

    it('? matches exactly one char', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['cs-?'] });
      expect(filter.evaluate(makeContent('cs-a')).allowed).toBe(false);
      expect(filter.evaluate(makeContent('cs-ab')).allowed).toBe(true);
    });
  });

  describe('path-glob patterns', () => {
    function makePathContent(name: string, sourcePath: string, folder: string) {
      return { ...makeContent(name), sourcePath, folder };
    }

    it('matches a ** path glob against the folder-relative source path', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['**/agenthub/**'] });
      const hit = makePathContent('x', '/skills/agenthub/x/SKILL.md', '/skills');
      expect(filter.evaluate(hit)).toEqual({
        allowed: false,
        reason: 'manual',
        pattern: '**/agenthub/**',
      });
      const miss = makePathContent('y', '/skills/other/y/SKILL.md', '/skills');
      expect(filter.evaluate(miss).allowed).toBe(true);
    });

    it('matches a precise path prefix glob', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['engineering/llm-wiki/**'] });
      const hit = makePathContent('w', '/root/engineering/llm-wiki/w/SKILL.md', '/root');
      expect(filter.evaluate(hit).allowed).toBe(false);
      const miss = makePathContent('w', '/root/engineering/other/SKILL.md', '/root');
      expect(filter.evaluate(miss).allowed).toBe(true);
    });

    it('exact name takes precedence over an overlapping glob', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['wiki-foo', 'wiki-*'] });
      expect(filter.evaluate(makeContent('wiki-foo'))).toEqual({
        allowed: false,
        reason: 'manual',
        pattern: 'wiki-foo',
      });
    });
  });

  describe('auto-audit via scanner', () => {
    it('allows a skill with safe body when scanner finds no matches', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('] });
      const filter = new BlacklistFilter({ patternScanner: scanner });
      const verdict = filter.evaluate(makeContent('my-skill', 'print("hello")'));
      expect(verdict).toEqual({ allowed: true });
    });

    it('rejects a skill whose executable code matches a pattern, returning first match pattern source', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\(', 'exec\\('] });
      const filter = new BlacklistFilter({ patternScanner: scanner });
      // Default auditTarget is 'scripts' — the match must live in a fenced code block.
      const body = ['```js', 'eval(user_input)', '```'].join('\n');
      const verdict = filter.evaluate(makeContent('evil-skill', body));
      expect(verdict).toEqual({ allowed: false, reason: 'audit', pattern: 'eval\\(' });
    });
  });

  describe('short-circuit: manual hit skips scanner', () => {
    it('does not call scanner.scan when name is blacklisted', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('] });
      const scanSpy = vi.spyOn(scanner, 'scan');
      const filter = new BlacklistFilter({
        manualBlacklist: ['blocked'],
        patternScanner: scanner,
      });
      const verdict = filter.evaluate(makeContent('blocked', 'eval(x)'));
      expect(verdict).toEqual({ allowed: false, reason: 'manual', pattern: 'blocked' });
      expect(scanSpy).not.toHaveBeenCalled();
    });
  });

  describe('setManualBlacklist()', () => {
    it('after setManualBlacklist([x]), evaluate({name:x,...}) returns manual rejection', () => {
      const filter = new BlacklistFilter();
      filter.setManualBlacklist(['x']);
      expect(filter.evaluate(makeContent('x'))).toEqual({
        allowed: false,
        reason: 'manual',
        pattern: 'x',
      });
    });

    it('after setManualBlacklist([]), a previously-blacklisted name is now allowed', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['was-blocked'] });
      expect(filter.evaluate(makeContent('was-blocked')).allowed).toBe(false);
      filter.setManualBlacklist([]);
      expect(filter.evaluate(makeContent('was-blocked')).allowed).toBe(true);
    });
  });

  describe('manual list normalization', () => {
    it('trims whitespace from entries', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['  foo  ', '  bar  '] });
      expect(filter.evaluate(makeContent('foo')).allowed).toBe(false);
      expect(filter.evaluate(makeContent('bar')).allowed).toBe(false);
    });

    it('drops empty strings after trim', () => {
      const filter = new BlacklistFilter({ manualBlacklist: ['  ', '', 'real'] });
      // empty string never matches any non-empty name
      expect(filter.evaluate(makeContent('')).allowed).toBe(true);
      expect(filter.evaluate(makeContent('real')).allowed).toBe(false);
    });

    it('deduplicates entries: foo appears twice but only one rejection slot', () => {
      // Construct with ['  foo  ', 'foo', '  ', 'bar'] — only 'foo' and 'bar' should reject
      const filter = new BlacklistFilter({ manualBlacklist: ['  foo  ', 'foo', '  ', 'bar'] });
      expect(filter.evaluate(makeContent('foo')).allowed).toBe(false);
      expect(filter.evaluate(makeContent('bar')).allowed).toBe(false);
      expect(filter.evaluate(makeContent('baz')).allowed).toBe(true);
      // isNoop is false (2 real entries)
      expect(filter.isNoop()).toBe(false);
    });
  });

  describe('auditExceptions', () => {
    it('exempts a named skill from the auto-audit', () => {
      const scanner = new PatternScanner({ patterns: ['exec\\('] });
      const filter = new BlacklistFilter({
        patternScanner: scanner,
        auditExceptions: ['skill-security-auditor'],
        auditTarget: 'all',
      });
      // body would normally trip the audit
      const exempt = filter.evaluate(makeContent('skill-security-auditor', 'exec(x)'));
      expect(exempt).toEqual({ allowed: true });
      // a different skill with the same body is still rejected
      const other = filter.evaluate(makeContent('other', 'exec(x)'));
      expect(other).toEqual({ allowed: false, reason: 'audit', pattern: 'exec\\(' });
    });

    it('manual blacklist still applies to an audit-exempt name', () => {
      const scanner = new PatternScanner({ patterns: ['exec\\('] });
      const filter = new BlacklistFilter({
        patternScanner: scanner,
        manualBlacklist: ['both'],
        auditExceptions: ['both'],
      });
      expect(filter.evaluate(makeContent('both', 'exec(x)'))).toEqual({
        allowed: false,
        reason: 'manual',
        pattern: 'both',
      });
    });
  });

  describe('auditTarget', () => {
    const proseOnly = '| `exec(`, `execSync(` | Substring | command injection |';

    it('scripts mode (default) ignores a pattern that only appears in prose', () => {
      const scanner = new PatternScanner({ patterns: ['exec\\('] });
      const filter = new BlacklistFilter({ patternScanner: scanner });
      expect(filter.evaluate(makeContent('docs-skill', proseOnly))).toEqual({ allowed: true });
    });

    it('all mode flags the same prose pattern', () => {
      const scanner = new PatternScanner({ patterns: ['exec\\('] });
      const filter = new BlacklistFilter({ patternScanner: scanner, auditTarget: 'all' });
      expect(filter.evaluate(makeContent('docs-skill', proseOnly))).toEqual({
        allowed: false,
        reason: 'audit',
        pattern: 'exec\\(',
      });
    });

    it('scripts mode still flags a pattern inside a fenced executable block', () => {
      const scanner = new PatternScanner({ patterns: ['shell=True'] });
      const filter = new BlacklistFilter({ patternScanner: scanner });
      const body = ['```python', 'run(cmd, shell=True)', '```'].join('\n');
      expect(filter.evaluate(makeContent('runs-code', body))).toEqual({
        allowed: false,
        reason: 'audit',
        pattern: 'shell=True',
      });
    });
  });
});
