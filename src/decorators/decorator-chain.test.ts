import { describe, it, expect, vi } from 'vitest';
import { DecoratorChain } from './decorator-chain.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { InvocationContext, InvocationResult, SkillContent } from '../core/types.js';

function makeSkill(name = 'test-skill'): SkillContent {
  return {
    name,
    sourcePath: `/skills/${name}.md`,
    folder: '/skills',
    format: 'claude',
    allowScripts: false,
    allowNetwork: false,
    body: `Body of ${name}`,
    raw: `---\nname: ${name}\n---\n`,
  };
}

const makeCtx = (): InvocationContext => ({ callerTool: 'invoke', input: 'hello' });

function makeSpyStrategy(result: InvocationResult): InvocationStrategy & { calls: number } {
  let calls = 0;
  return {
    kind: 'prompt',
    canHandle: () => true,
    invoke: async (_skill, _ctx) => {
      calls++;
      return result;
    },
    get calls() { return calls; },
  } as unknown as InvocationStrategy & { calls: number };
}

describe('DecoratorChain', () => {
  it('wrap() returns an InvocationStrategy', () => {
    const chain = new DecoratorChain({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      defaultTimeoutMs: 5_000,
      cacheTtlMs: 10_000,
      cacheMaxEntries: 10,
    });
    const inner = makeSpyStrategy({ ok: true, output: 'ok', durationMs: 1 });
    const wrapped = chain.wrap(inner);
    expect(typeof wrapped.invoke).toBe('function');
    expect(typeof wrapped.canHandle).toBe('function');
  });

  it('wrap() chains Logging → Timeout → Cache → inner (inner strategy is called)', async () => {
    const infoSpy = vi.fn();
    const chain = new DecoratorChain({
      logger: { debug: vi.fn(), info: infoSpy, warn: vi.fn(), error: vi.fn() },
      defaultTimeoutMs: 5_000,
      cacheTtlMs: 10_000,
      cacheMaxEntries: 10,
    });
    const inner = makeSpyStrategy({ ok: true, output: 'result', durationMs: 2 });
    const wrapped = chain.wrap(inner);

    const result = await wrapped.invoke(makeSkill(), makeCtx());

    // Inner strategy was called.
    expect(inner.calls).toBe(1);
    // LoggingDecorator emitted at least one info log.
    expect(infoSpy).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.output).toBe('result');
  });

  it('wrap() preserves the inner strategy at the innermost position (cache hit skips inner call)', async () => {
    const fixedClock = (() => {
      let t = 0;
      return () => t++;
    })();

    const chain = new DecoratorChain({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      defaultTimeoutMs: 5_000,
      cacheTtlMs: 60_000,
      cacheMaxEntries: 10,
      clock: fixedClock,
    });
    const inner = makeSpyStrategy({ ok: true, output: 'cached-result', durationMs: 1 });
    const wrapped = chain.wrap(inner);
    const skill = makeSkill('cacheable-skill');
    // Mark skill as cacheable so CacheDecorator stores result.
    (skill as SkillContent & { cacheable: boolean }).cacheable = true;

    await wrapped.invoke(skill, makeCtx());
    await wrapped.invoke(skill, makeCtx());

    // Second call served from cache — inner called only once.
    expect(inner.calls).toBe(1);
  });
});
