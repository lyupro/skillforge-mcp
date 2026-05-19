import { BaseDecorator } from './base-decorator.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { InvocationContext, InvocationResult, SkillContent } from '../core/types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const stderrLogger: Logger = {
  debug: (m) => process.stderr.write(m + '\n'),
  info: (m) => process.stderr.write(m + '\n'),
  warn: (m) => process.stderr.write(m + '\n'),
  error: (m) => process.stderr.write(m + '\n'),
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LeveledLoggerOptions {
  /** Threshold — calls at a lower level are dropped. Defaults to `info`. */
  level?: LogLevel;
  /** Underlying logger calls are forwarded to. Defaults to `stderrLogger`. */
  sink?: Logger;
}

/**
 * Build a Logger that drops calls below the configured threshold and forwards
 * the rest to a sink. The threshold is fixed at construction; flip levels by
 * rebuilding a new wrapper. The sink is `stderrLogger` by default — callers
 * inject a fake sink in tests.
 */
export function createLeveledLogger(options: LeveledLoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? stderrLogger;
  const threshold = LEVEL_RANK[level];
  const pass = (lvl: LogLevel): boolean => LEVEL_RANK[lvl] >= threshold;
  return {
    debug: (m) => { if (pass('debug')) sink.debug(m); },
    info: (m) => { if (pass('info')) sink.info(m); },
    warn: (m) => { if (pass('warn')) sink.warn(m); },
    error: (m) => { if (pass('error')) sink.error(m); },
  };
}

/**
 * Inspect the env for a debug override. `SKILLFORGE_DEBUG=1` or `DEBUG=1`
 * (any truthy non-empty value, case-insensitive `false`/`0` opt-out) flips the
 * effective level to `debug`. Returns null when no override is present so the
 * caller falls back to the persisted config knob.
 */
export function envDebugOverride(env: NodeJS.ProcessEnv = process.env): LogLevel | null {
  const candidates = [env['SKILLFORGE_DEBUG'], env['DEBUG']];
  for (const raw of candidates) {
    if (raw === undefined) continue;
    const value = raw.trim().toLowerCase();
    if (value === '' || value === '0' || value === 'false' || value === 'off' || value === 'no') {
      continue;
    }
    return 'debug';
  }
  return null;
}

export class LoggingDecorator extends BaseDecorator {
  readonly #logger: Logger;
  readonly #clock: () => number;

  constructor(inner: InvocationStrategy, logger: Logger = stderrLogger, clock: () => number = () => performance.now()) {
    super(inner);
    this.#logger = logger;
    this.#clock = clock;
  }

  async invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult> {
    const name = skill.name ?? '<unknown>';
    const kind = this.inner.kind;
    this.#logger.info(`[skillforge] invoke skill=${name} kind=${kind}`);
    const start = this.#clock();
    try {
      const result = await this.inner.invoke(skill, context);
      const ms = Math.round(this.#clock() - start);
      this.#logger.info(`[skillforge] result skill=${name} ok=${result.ok} ms=${ms}`);
      return result;
    } catch (err) {
      const ms = Math.round(this.#clock() - start);
      const errMsg = err instanceof Error ? err.message : String(err);
      this.#logger.error(`[skillforge] error skill=${name} ms=${ms} reason=${errMsg}`);
      throw err;
    }
  }
}
