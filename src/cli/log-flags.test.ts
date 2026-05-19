import { describe, it, expect } from 'vitest';
import { extractLogFlags } from './log-flags.js';

describe('extractLogFlags', () => {
  it('returns null logLevel and unchanged argv when no flag is present', () => {
    expect(extractLogFlags(['list', '--json'])).toEqual({
      rest: ['list', '--json'],
      logLevel: null,
    });
  });

  it('maps --verbose to debug and strips the flag', () => {
    expect(extractLogFlags(['list', '--verbose', '--json'])).toEqual({
      rest: ['list', '--json'],
      logLevel: 'debug',
    });
  });

  it('maps short -v to debug', () => {
    expect(extractLogFlags(['-v', 'list'])).toEqual({
      rest: ['list'],
      logLevel: 'debug',
    });
  });

  it('maps --quiet to warn and strips the flag', () => {
    expect(extractLogFlags(['reload', '--quiet'])).toEqual({
      rest: ['reload'],
      logLevel: 'warn',
    });
  });

  it('maps short -q to warn', () => {
    expect(extractLogFlags(['-q', 'list'])).toEqual({
      rest: ['list'],
      logLevel: 'warn',
    });
  });

  it('last flag wins when --verbose and --quiet both appear', () => {
    expect(extractLogFlags(['--verbose', 'list', '--quiet']).logLevel).toBe('warn');
    expect(extractLogFlags(['--quiet', 'list', '--verbose']).logLevel).toBe('debug');
  });

  it('preserves the relative order of non-flag args', () => {
    expect(extractLogFlags(['get', 'code-review', '--verbose', '--json']).rest).toEqual([
      'get',
      'code-review',
      '--json',
    ]);
  });
});
