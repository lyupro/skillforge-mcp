import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { InvocationContext, InvocationResult, StrategyKind, SkillContent } from '../core/types.js';

export abstract class BaseDecorator implements InvocationStrategy {
  protected readonly inner: InvocationStrategy;

  constructor(inner: InvocationStrategy) {
    this.inner = inner;
  }

  get kind(): StrategyKind {
    return this.inner.kind;
  }

  canHandle(skill: SkillContent): boolean {
    return this.inner.canHandle(skill);
  }

  abstract invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult>;
}
