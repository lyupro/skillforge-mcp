import { z } from 'zod';
import type { ServerDeps } from '../server-deps.js';
import type { InvocationContext, InvocationResult } from '../core/types.js';
import { handleGet } from './get.js';
import { resolveComposite } from '../handlers/composite-resolver.js';

export const invokeInputSchema = {
  name: z.string(),
  input: z.string().default(''),
} as const;

export async function handleInvoke(
  deps: ServerDeps,
  args: { name: string; input?: string },
): Promise<InvocationResult> {
  const content = await handleGet(deps, { name: args.name });
  const context: InvocationContext = {
    callerTool: 'invoke',
    input: args.input ?? '',
  };

  // Composite branch: skills[] non-empty → resolve via composite-resolver.
  if (content.skills && content.skills.length > 0) {
    const loadSkill = async (name: string) => {
      try {
        return await handleGet(deps, { name });
      } catch {
        return undefined;
      }
    };
    const invokeNested = (skill: Parameters<typeof resolveComposite>[0], ctx: InvocationContext): Promise<InvocationResult> => {
      const strategy = deps.factory.create(skill);
      const wrapped = deps.decoratorChain.wrap(strategy);
      return wrapped.invoke(skill, ctx);
    };
    return resolveComposite(content, context, loadSkill, invokeNested);
  }

  // Single-skill: factory + decorator chain.
  const strategy = deps.factory.create(content);
  const wrapped = deps.decoratorChain.wrap(strategy);
  return wrapped.invoke(content, context);
}
