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
      expect(verdict).toEqual({ allowed: false, reason: 'manual' });
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

  describe('auto-audit via scanner', () => {
    it('allows a skill with safe body when scanner finds no matches', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('] });
      const filter = new BlacklistFilter({ patternScanner: scanner });
      const verdict = filter.evaluate(makeContent('my-skill', 'print("hello")'));
      expect(verdict).toEqual({ allowed: true });
    });

    it('rejects a skill whose body matches a pattern, returning first match pattern source', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\(', 'exec\\('] });
      const filter = new BlacklistFilter({ patternScanner: scanner });
      const verdict = filter.evaluate(makeContent('evil-skill', 'eval(user_input)'));
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
      expect(verdict).toEqual({ allowed: false, reason: 'manual' });
      expect(scanSpy).not.toHaveBeenCalled();
    });
  });

  describe('setManualBlacklist()', () => {
    it('after setManualBlacklist([x]), evaluate({name:x,...}) returns manual rejection', () => {
      const filter = new BlacklistFilter();
      filter.setManualBlacklist(['x']);
      expect(filter.evaluate(makeContent('x'))).toEqual({ allowed: false, reason: 'manual' });
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
});
