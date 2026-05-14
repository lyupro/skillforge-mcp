import { performance } from 'node:perf_hooks';
import type {
  InvocationContext,
  InvocationResult,
  SkillContent,
  StrategyKind,
} from '../core/types.js';
import type { InvocationStrategy } from './invocation-strategy.js';

export class PromptStrategy implements InvocationStrategy {
  readonly kind: StrategyKind = 'prompt';

  canHandle(_skill: SkillContent): boolean {
    return true;
  }

  async invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult> {
    const start = performance.now();
    try {
      const parts: string[] = [];
      parts.push(`# Skill: ${skill.name}`);
      if (skill.description !== undefined && skill.description !== '') {
        parts.push(skill.description);
      }
      parts.push('');
      parts.push(skill.body);
      parts.push('');
      parts.push('## Input');
      parts.push(context.input);

      const output = parts.join('\n');
      const durationMs = Math.max(0, Math.round(performance.now() - start));
      return { ok: true, output, durationMs };
    } catch (err) {
      const durationMs = Math.max(0, Math.round(performance.now() - start));
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, output: '', error, durationMs };
    }
  }
}
