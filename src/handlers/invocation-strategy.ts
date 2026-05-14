import type {
  InvocationContext,
  InvocationResult,
  SkillContent,
  StrategyKind,
} from '../core/types.js';

export interface InvocationStrategy {
  /** Identifier — matches StrategyKind so StrategyFactory can index by kind. */
  readonly kind: StrategyKind;

  /**
   * Returns true if this strategy is capable of executing the given skill.
   * PromptStrategy returns true for any skill (default fallback).
   * ScriptStrategy will require allowScripts + a scripts/ dir.
   */
  canHandle(skill: SkillContent): boolean;

  /**
   * Execute the skill. Implementations MUST catch their own errors and
   * surface them via `InvocationResult { ok: false, error }` — never throw.
   */
  invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult>;
}
