import { BaseDecorator } from './base-decorator.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { InvocationContext, InvocationResult, SkillContent } from '../core/types.js';

export interface TimeoutDecoratorDeps {
  /** Default timeout ms applied when skill.metadata.timeoutMs absent. */
  defaultMs: number;
  /** Injectable setTimeout for deterministic tests. */
  setTimeoutFn?: typeof setTimeout;
  /** Injectable clearTimeout for deterministic tests. */
  clearTimeoutFn?: typeof clearTimeout;
  /** Injectable clock for durationMs measurement. */
  clock?: () => number;
}

export class TimeoutDecorator extends BaseDecorator {
  readonly #defaultMs: number;
  readonly #setTimeout: typeof setTimeout;
  readonly #clearTimeout: typeof clearTimeout;
  readonly #clock: () => number;

  constructor(inner: InvocationStrategy, deps: TimeoutDecoratorDeps) {
    super(inner);
    this.#defaultMs = deps.defaultMs;
    this.#setTimeout = deps.setTimeoutFn ?? setTimeout;
    this.#clearTimeout = deps.clearTimeoutFn ?? clearTimeout;
    this.#clock = deps.clock ?? (() => performance.now());
  }

  async invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult> {
    const timeoutMs = skill.timeoutMs ?? this.#defaultMs;
    if (timeoutMs <= 0) {
      // 0 / negative = disabled; pass through without timeout
      return await this.inner.invoke(skill, context);
    }

    const controller = new AbortController();
    const start = this.#clock();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<InvocationResult>((resolve) => {
      timer = this.#setTimeout(() => {
        controller.abort();
        resolve({
          ok: false,
          output: '',
          error: 'timeout',
          durationMs: Math.round(this.#clock() - start),
        });
      }, timeoutMs);
      // Allow Node.js process to exit even if timer is pending
      if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
        (timer as unknown as { unref: () => void }).unref();
      }
    });

    // If caller passed a parent signal, link it: parent abort → child abort
    if (context.signal) {
      if (context.signal.aborted) {
        controller.abort();
      } else {
        context.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const innerPromise = this.inner.invoke(skill, { ...context, signal: controller.signal });

    try {
      const result = await Promise.race([innerPromise, timeoutPromise]);
      return result;
    } finally {
      if (timer !== undefined) {
        this.#clearTimeout(timer);
      }
    }
  }
}
