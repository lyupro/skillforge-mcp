import type { InvocationContext, InvocationResult, SkillContent } from '../core/types.js';
import { CyclicSkillDependencyError } from '../core/errors.js';

/**
 * Function provided by caller to load SkillContent by name. Returns undefined
 * if skill not registered. Composite resolver uses this in collectChain phase.
 */
export type SkillLoader = (name: string) => Promise<SkillContent | undefined>;

/**
 * Function provided by caller to actually invoke a non-composite skill,
 * including decorator chain wrapping + strategy factory dispatch. Composite
 * resolver delegates leaf execution to this.
 */
export type SkillInvoker = (skill: SkillContent, context: InvocationContext) => Promise<InvocationResult>;

/**
 * Walk the composite chain depth-first, loading each referenced skill.
 * Returns Map<name, SkillContent> for all reachable nodes plus the root.
 * Throws CyclicSkillDependencyError if a cycle is found during traversal.
 * Throws Error('unknown skill referenced from composite: <name>') if a
 * reference cannot be resolved.
 */
export async function collectChain(
  root: SkillContent,
  loadSkill: SkillLoader,
): Promise<Map<string, SkillContent>> {
  const collected = new Map<string, SkillContent>();
  collected.set(root.name, root);

  const visit = async (current: SkillContent, stack: string[]): Promise<void> => {
    const nested = current.skills ?? [];
    for (const nestedName of nested) {
      if (stack.includes(nestedName)) {
        throw new CyclicSkillDependencyError([...stack, nestedName]);
      }
      if (!collected.has(nestedName)) {
        const loaded = await loadSkill(nestedName);
        if (!loaded) {
          throw new Error(`unknown skill referenced from composite: ${nestedName}`);
        }
        collected.set(nestedName, loaded);
        await visit(loaded, [...stack, nestedName]);
      } else {
        // Already collected — still traverse to detect cycles through this subtree.
        await visit(collected.get(nestedName)!, [...stack, nestedName]);
      }
    }
  };

  await visit(root, [root.name]);
  return collected;
}

/**
 * Resolves a composite skill: cycle-check via collectChain → sequential invoke
 * nested skills → concatenate outputs with separator.
 *
 * Parent body (root.body) is prepended as a leading section if non-empty.
 * Sections are joined with '\n\n---\n\n'.
 * Each nested skill section is prefixed with '## Skill: <name>\n\n'.
 *
 * Failure short-circuits: first failed nested invoke returns its result
 * wrapped in a composite envelope; subsequent skills are NOT invoked.
 * On cycle or unknown-skill errors, returns ok:false immediately.
 */
export async function resolveComposite(
  root: SkillContent,
  context: InvocationContext,
  loadSkill: SkillLoader,
  invokeSkill: SkillInvoker,
  clock: () => number = () => performance.now(),
): Promise<InvocationResult> {
  const start = clock();

  let chain: Map<string, SkillContent>;
  try {
    chain = await collectChain(root, loadSkill);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      output: '',
      error: msg,
      durationMs: Math.round(clock() - start),
    };
  }

  const nestedNames = root.skills ?? [];
  const sections: string[] = [];
  const rootBody = (root.body ?? '').trim();
  if (rootBody.length > 0) sections.push(rootBody);

  for (const name of nestedNames) {
    const skill = chain.get(name);
    if (!skill) {
      return {
        ok: false,
        output: '',
        error: `unknown skill referenced from composite: ${name}`,
        durationMs: Math.round(clock() - start),
      };
    }
    const childResult = await invokeSkill(skill, context);
    if (!childResult.ok) {
      return {
        ok: false,
        output: childResult.output,
        error: `nested skill ${name} failed: ${childResult.error ?? 'unknown error'}`,
        durationMs: Math.round(clock() - start),
      };
    }
    sections.push(`## Skill: ${name}\n\n${childResult.output.trim()}`);
  }

  return {
    ok: true,
    output: sections.join('\n\n---\n\n'),
    durationMs: Math.round(clock() - start),
  };
}
