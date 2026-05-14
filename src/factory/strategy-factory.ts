import type { SkillContent, StrategyKind } from '../core/types.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';

export class StrategyFactory {
  readonly #store: Map<StrategyKind, InvocationStrategy>;

  constructor(strategies?: InvocationStrategy[]) {
    this.#store = new Map();
    if (strategies !== undefined) {
      for (const strategy of strategies) {
        this.register(strategy);
      }
    }
  }

  register(strategy: InvocationStrategy): void {
    // Set in place so existing keys keep their insertion position for auto-detect order.
    this.#store.set(strategy.kind, strategy);
  }

  create(skill: SkillContent): InvocationStrategy {
    if (this.#store.size === 0) {
      throw new Error('StrategyFactory: no strategies registered');
    }

    if (skill.strategy !== undefined) {
      const found = this.#store.get(skill.strategy);
      if (found === undefined) {
        throw new Error(`Strategy not registered: ${skill.strategy}`);
      }
      return found;
    }

    for (const strategy of this.#store.values()) {
      if (strategy.canHandle(skill)) {
        return strategy;
      }
    }

    throw new Error(`No strategy can handle skill: ${skill.name}`);
  }

  get registeredKinds(): StrategyKind[] {
    return Array.from(this.#store.keys());
  }
}
