import { LoggingDecorator } from './logging-decorator.js';
import { TimeoutDecorator } from './timeout-decorator.js';
import { CacheDecorator } from './cache-decorator.js';
import type { Logger } from './logging-decorator.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';

export interface DecoratorChainDeps {
  logger: Logger;
  defaultTimeoutMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  clock?: () => number;
}

/** Composes Logging → Timeout → Cache → strategy (outermost-in). */
export class DecoratorChain {
  readonly #logger: Logger;
  readonly #defaultTimeoutMs: number;
  readonly #cacheTtlMs: number;
  readonly #cacheMaxEntries: number;
  readonly #clock?: () => number;

  constructor(deps: DecoratorChainDeps) {
    this.#logger = deps.logger;
    this.#defaultTimeoutMs = deps.defaultTimeoutMs;
    this.#cacheTtlMs = deps.cacheTtlMs;
    this.#cacheMaxEntries = deps.cacheMaxEntries;
    this.#clock = deps.clock;
  }

  wrap(strategy: InvocationStrategy): InvocationStrategy {
    const cached = new CacheDecorator(strategy, {
      ttlMs: this.#cacheTtlMs,
      maxEntries: this.#cacheMaxEntries,
      clock: this.#clock,
    });
    const timed = new TimeoutDecorator(cached, {
      defaultMs: this.#defaultTimeoutMs,
      clock: this.#clock,
    });
    return new LoggingDecorator(timed, this.#logger, this.#clock);
  }
}
