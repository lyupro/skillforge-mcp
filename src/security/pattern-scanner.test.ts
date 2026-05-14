import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PatternScanner } from './pattern-scanner.js';

describe('PatternScanner', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('basic safe cases', () => {
    it('empty patterns list + nonempty input → safe', () => {
      const scanner = new PatternScanner({ patterns: [] });
      const result = scanner.scan('subprocess.Popen(shell=True)');
      expect(result.safe).toBe(true);
      expect(result.matches).toEqual([]);
    });

    it('empty input → safe', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('] });
      const result = scanner.scan('');
      expect(result.safe).toBe(true);
      expect(result.matches).toEqual([]);
    });
  });

  describe('default audit patterns', () => {
    const defaultPatterns = ['shell=True', 'eval\\(', 'exec\\(', 'base64\\.b64decode'];

    it('detects shell=True', () => {
      const scanner = new PatternScanner({ patterns: defaultPatterns });
      const result = scanner.scan('subprocess.Popen(["ls"], shell=True)');
      expect(result.safe).toBe(false);
      expect(result.matches.some((m) => m.pattern === 'shell=True')).toBe(true);
    });

    it('detects eval(', () => {
      const scanner = new PatternScanner({ patterns: defaultPatterns });
      const result = scanner.scan('eval(user_input)');
      expect(result.safe).toBe(false);
      expect(result.matches.some((m) => m.pattern === 'eval\\(')).toBe(true);
    });

    it('detects exec(', () => {
      const scanner = new PatternScanner({ patterns: defaultPatterns });
      const result = scanner.scan('exec(cmd)');
      expect(result.safe).toBe(false);
      expect(result.matches.some((m) => m.pattern === 'exec\\(')).toBe(true);
    });

    it('detects base64.b64decode', () => {
      const scanner = new PatternScanner({ patterns: defaultPatterns });
      const result = scanner.scan('data = base64.b64decode(payload)');
      expect(result.safe).toBe(false);
      expect(result.matches.some((m) => m.pattern === 'base64\\.b64decode')).toBe(true);
    });
  });

  describe('multiple matches', () => {
    it('collects all occurrences of one pattern with correct index values', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('] });
      const input = 'eval(a) + eval(b)';
      const result = scanner.scan(input);
      expect(result.safe).toBe(false);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]!.index).toBe(0);
      expect(result.matches[0]!.match).toBe('eval(');
      expect(result.matches[1]!.index).toBe(input.indexOf('eval(', 1));
      expect(result.matches[1]!.match).toBe('eval(');
    });

    it('combines matches from multiple patterns sorted by index', () => {
      const scanner = new PatternScanner({ patterns: ['exec\\(', 'eval\\('] });
      const input = 'eval(a); exec(b)';
      const result = scanner.scan(input);
      expect(result.safe).toBe(false);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]!.pattern).toBe('eval\\(');
      expect(result.matches[0]!.index).toBe(0);
      expect(result.matches[1]!.pattern).toBe('exec\\(');
      expect(result.matches[1]!.index).toBe(input.indexOf('exec('));
    });
  });

  describe('case sensitivity', () => {
    it('does not match EVAL( with eval\\( by default (case-sensitive)', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('] });
      const result = scanner.scan('EVAL(x)');
      expect(result.safe).toBe(true);
    });

    it('matches EVAL( with eval\\( when flags: i', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('], flags: 'i' });
      const result = scanner.scan('EVAL(x)');
      expect(result.safe).toBe(false);
      expect(result.matches[0]!.match).toBe('EVAL(');
    });
  });

  describe('invalid and empty patterns', () => {
    it('drops invalid regex and emits stderr warning, remaining patterns still work', () => {
      const scanner = new PatternScanner({ patterns: ['[', 'eval\\('] });
      expect(stderrSpy).toHaveBeenCalledOnce();
      const warning = (stderrSpy.mock.calls[0]![0] as string);
      expect(warning).toContain('[skillforge:pattern-scanner]');
      expect(warning).toContain('"["');

      const result = scanner.scan('eval(x)');
      expect(result.safe).toBe(false);
      expect(result.matches[0]!.pattern).toBe('eval\\(');
    });

    it('drops empty-string pattern and emits stderr warning', () => {
      const scanner = new PatternScanner({ patterns: ['', 'exec\\('] });
      expect(stderrSpy).toHaveBeenCalledOnce();
      const warning = (stderrSpy.mock.calls[0]![0] as string);
      expect(warning).toContain('[skillforge:pattern-scanner]');
      expect(warning).toContain('""');

      expect(scanner.getPatterns()).toEqual(['exec\\(']);
    });
  });

  describe('deduplication', () => {
    it('duplicate source patterns produce only one match per occurrence in input', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\(', 'eval\\('] });
      const result = scanner.scan('eval(x)');
      expect(result.matches).toHaveLength(1);
    });

    it('getPatterns() reflects deduplicated insertion order', () => {
      const scanner = new PatternScanner({ patterns: ['exec\\(', 'eval\\(', 'exec\\('] });
      expect(scanner.getPatterns()).toEqual(['exec\\(', 'eval\\(']);
    });
  });

  describe('zero-width matches', () => {
    it('zero-width lookahead does not cause infinite loop', () => {
      const scanner = new PatternScanner({ patterns: ['(?=a)'] });
      const input = 'banana and avocado are amazing';
      // Should return quickly without hanging; zero-width matches are skipped
      const result = scanner.scan(input);
      expect(result.safe).toBe(true);
      expect(result.matches).toEqual([]);
    });
  });

  describe('getPatterns()', () => {
    it('returns shallow copy in insertion order minus dropped entries', () => {
      const scanner = new PatternScanner({ patterns: ['shell=True', '[', 'eval\\('] });
      const patterns = scanner.getPatterns();
      expect(patterns).toEqual(['shell=True', 'eval\\(']);
    });

    it('mutating returned array does not affect scanner', () => {
      const scanner = new PatternScanner({ patterns: ['eval\\('] });
      const patterns = scanner.getPatterns();
      patterns.push('injected');
      expect(scanner.getPatterns()).toEqual(['eval\\(']);
    });
  });
});
