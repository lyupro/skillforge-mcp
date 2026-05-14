import { BaseDecorator } from './base-decorator.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { InvocationContext, InvocationResult, SkillContent } from '../core/types.js';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const stderrLogger: Logger = {
  info: (m) => process.stderr.write(m + '\n'),
  warn: (m) => process.stderr.write(m + '\n'),
  error: (m) => process.stderr.write(m + '\n'),
};

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
