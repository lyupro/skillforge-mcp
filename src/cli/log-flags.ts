/**
 * Parse global verbosity flags out of a CLI argv.
 *
 * `--verbose` / `-v` → debug, `--quiet` / `-q` → warn. These flags are global —
 * every subcommand surface (skills / folders / formats) supports them and
 * strips them before the per-action parser sees them. Mutually exclusive: when
 * both appear the last one wins, matching common CLI conventions (gcc, ssh).
 */

import type { LogLevel } from '../decorators/index.js';

export interface LogFlagResult {
  /** Argv with the consumed verbosity flags removed. */
  rest: string[];
  /** Explicit level override when a flag was present, otherwise null. */
  logLevel: LogLevel | null;
}

export function extractLogFlags(argv: string[]): LogFlagResult {
  const rest: string[] = [];
  let logLevel: LogLevel | null = null;
  for (const arg of argv) {
    if (arg === '--verbose' || arg === '-v') {
      logLevel = 'debug';
      continue;
    }
    if (arg === '--quiet' || arg === '-q') {
      logLevel = 'warn';
      continue;
    }
    rest.push(arg);
  }
  return { rest, logLevel };
}
