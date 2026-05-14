import type { InvocationStrategy } from './invocation-strategy.js';
import type {
  InvocationContext,
  InvocationResult,
  SkillContent,
  StrategyKind,
} from '../core/types.js';

export interface HybridStrategyDeps {
  scriptStrategy: InvocationStrategy;
  clock?: () => number;
}

const SECTION_SEP = '\n\n';

function assembleHybridPrompt(body: string, scriptOutput: string, userInput: string): string {
  const trimmedBody = body.trim();
  const trimmedScript = scriptOutput.trim();
  const trimmedInput = userInput.trim();

  const sections: string[] = [];
  if (trimmedBody.length > 0) sections.push(trimmedBody);
  sections.push(`## Script output${SECTION_SEP}${trimmedScript}`);
  if (trimmedInput.length > 0) {
    sections.push(`## User input${SECTION_SEP}${trimmedInput}`);
  }
  return sections.join(SECTION_SEP);
}

export class HybridStrategy implements InvocationStrategy {
  readonly kind: StrategyKind = 'hybrid';
  readonly #script: InvocationStrategy;
  readonly #clock: () => number;

  constructor(deps: HybridStrategyDeps) {
    this.#script = deps.scriptStrategy;
    this.#clock = deps.clock ?? (() => performance.now());
  }

  canHandle(skill: SkillContent): boolean {
    return skill.strategy === 'hybrid';
  }

  async invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult> {
    const start = this.#clock();
    const scriptResult = await this.#script.invoke(skill, context);

    // Failure short-circuits — no prompt blend on failure.
    if (!scriptResult.ok) {
      return scriptResult;
    }

    const promptBlob = assembleHybridPrompt(skill.body ?? '', scriptResult.output, context.input);
    const durationMs = Math.round(this.#clock() - start);

    return {
      ok: true,
      output: promptBlob,
      durationMs,
    };
  }
}
