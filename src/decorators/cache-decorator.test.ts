import { describe, it, expect, vi } from 'vitest';
import { CacheDecorator } from './cache-decorator.js';
import type { CacheDecoratorDeps } from './cache-decorator.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { InvocationContext, InvocationResult, SkillContent } from '../core/types.js';

function makeSkill(overrides: Partial<SkillContent> = {}): SkillContent {
  return {
    name: 'test-skill',
    sourcePath: '/skills/test-skill.md',
    folder: '/skills',
    format: 'claude',
    body: 'Do the thing.',
    raw: '---\nname: test-skill\n---\nDo the thing.',
    ...overrides,
  };
}

function makeContext(overrides: Partial<InvocationContext> = {}): InvocationContext {
  return { callerTool: 'invoke', input: 'hello', ...overrides };
}

function makeStubInner(result: InvocationResult = { ok: true, output: 'done', durationMs: 10 }): InvocationStrategy {
  return {
    kind: 'prompt',
    canHandle: vi.fn().mockReturnValue(true),
    invoke: vi.fn().mockResolvedValue(result),
  };
}

function makeDeps(overrides: Partial<CacheDecoratorDeps> = {}): CacheDecoratorDeps {
  return { ttlMs: 5000, maxEntries: 100, ...overrides };
}

describe('CacheDecorator', () => {
  it('disabled by default → passthrough, inner called both times, size=0', async () => {
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps());
    const skill = makeSkill(); // no cacheable, no cacheTtlMs

    await decorator.invoke(skill, makeContext());
    await decorator.invoke(skill, makeContext());

    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(decorator.size()).toBe(0);
  });

  it('cacheable=true → second hit returns cached, inner called once', async () => {
    const expected: InvocationResult = { ok: true, output: 'cached-output', durationMs: 10 };
    const inner = makeStubInner(expected);
    const decorator = new CacheDecorator(inner, makeDeps());
    const skill = makeSkill({ cacheable: true });

    const r1 = await decorator.invoke(skill, makeContext());
    const r2 = await decorator.invoke(skill, makeContext());

    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(r1).toBe(expected);
    expect(r2).toBe(expected);
  });

  it('cacheTtlMs > 0 implies cacheable even without cacheable flag', async () => {
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps());
    const skill = makeSkill({ cacheTtlMs: 5000 }); // no cacheable field

    await decorator.invoke(skill, makeContext());
    await decorator.invoke(skill, makeContext());

    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(decorator.size()).toBe(1);
  });

  it('TTL expiry → second invoke after TTL triggers inner again', async () => {
    let now = 0;
    const clock = () => now;
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps({ ttlMs: 1000, clock }));
    const skill = makeSkill({ cacheable: true });

    now = 0;
    await decorator.invoke(skill, makeContext());
    now = 1500; // past TTL of 1000
    await decorator.invoke(skill, makeContext());

    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('per-skill cacheTtlMs override: uses skill TTL not global', async () => {
    let now = 0;
    const clock = () => now;
    const inner = makeStubInner();
    // global ttlMs=10000 but skill sets cacheTtlMs=500
    const decorator = new CacheDecorator(inner, makeDeps({ ttlMs: 10000, clock }));
    const skill = makeSkill({ cacheable: true, cacheTtlMs: 500 });

    now = 0;
    await decorator.invoke(skill, makeContext());
    now = 600; // past skill TTL of 500, but within global 10000
    await decorator.invoke(skill, makeContext());

    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('different inputs → different cache entries, both run inner', async () => {
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps());
    const skill = makeSkill({ cacheable: true });

    await decorator.invoke(skill, makeContext({ input: 'a' }));
    await decorator.invoke(skill, makeContext({ input: 'b' }));

    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(decorator.size()).toBe(2);
  });

  it('LRU eviction at maxEntries: oldest entry evicted on overflow', async () => {
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps({ maxEntries: 2 }));
    const skill = makeSkill({ cacheable: true });

    await decorator.invoke(skill, makeContext({ input: 'a' }));
    await decorator.invoke(skill, makeContext({ input: 'b' }));
    await decorator.invoke(skill, makeContext({ input: 'c' }));

    // Size should still be 2 after eviction
    expect(decorator.size()).toBe(2);

    // 'a' was evicted (oldest), so invoking 'a' should call inner again
    const invokeCount = (inner.invoke as ReturnType<typeof vi.fn>).mock.calls.length;
    await decorator.invoke(skill, makeContext({ input: 'a' }));
    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(invokeCount + 1);
  });

  it('LRU refresh on hit: hitting old entry prevents its eviction', async () => {
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps({ maxEntries: 2 }));
    const skill = makeSkill({ cacheable: true });

    // Fill: a=oldest, b=newest
    await decorator.invoke(skill, makeContext({ input: 'a' }));
    await decorator.invoke(skill, makeContext({ input: 'b' }));
    expect(decorator.size()).toBe(2);

    // Hit 'a' → refreshes 'a' to newest position; 'b' becomes oldest
    const r_a = await decorator.invoke(skill, makeContext({ input: 'a' }));
    expect(r_a.ok).toBe(true);
    // inner still only called twice (two unique populates)
    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);

    // Add 'c' → evicts 'b' (oldest), leaving a=old and c=newest
    await decorator.invoke(skill, makeContext({ input: 'c' }));
    expect(decorator.size()).toBe(2);
    // inner called for 'c' (third unique)
    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);

    // 'b' was evicted — invoking 'b' triggers inner again (4th call)
    await decorator.invoke(skill, makeContext({ input: 'b' }));
    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
  });

  it('failed result NOT cached: second call with same input triggers inner again', async () => {
    const failResult: InvocationResult = { ok: false, output: '', error: 'boom', durationMs: 5 };
    const inner = makeStubInner(failResult);
    const decorator = new CacheDecorator(inner, makeDeps());
    const skill = makeSkill({ cacheable: true });

    await decorator.invoke(skill, makeContext());
    await decorator.invoke(skill, makeContext());

    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(decorator.size()).toBe(0);
  });

  it('different skill names with same input → different cache entries', async () => {
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps());

    const skillA = makeSkill({ name: 'skill-alpha', cacheable: true });
    const skillB = makeSkill({ name: 'skill-beta', cacheable: true });
    const ctx = makeContext({ input: 'same-input' });

    await decorator.invoke(skillA, ctx);
    await decorator.invoke(skillB, ctx);

    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(decorator.size()).toBe(2);
  });

  it('clear() empties store, next invoke triggers inner', async () => {
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps());
    const skill = makeSkill({ cacheable: true });

    await decorator.invoke(skill, makeContext());
    expect(decorator.size()).toBe(1);

    decorator.clear();
    expect(decorator.size()).toBe(0);

    await decorator.invoke(skill, makeContext());
    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('injectable clock used for TTL: advancing clock past TTL causes miss', async () => {
    let now = 1000;
    const clock = () => now;
    const inner = makeStubInner();
    const decorator = new CacheDecorator(inner, makeDeps({ ttlMs: 500, clock }));
    const skill = makeSkill({ cacheable: true });

    // t=1000: populate cache, expiresAt = 1000 + 500 = 1500
    await decorator.invoke(skill, makeContext());

    // t=1499: still valid
    now = 1499;
    await decorator.invoke(skill, makeContext());
    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);

    // t=1500: exactly expired (expiresAt > now is false when equal)
    now = 1500;
    await decorator.invoke(skill, makeContext());
    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('ok:true after ok:false: failure not cached, success on retry is cached', async () => {
    const failResult: InvocationResult = { ok: false, output: '', error: 'transient', durationMs: 5 };
    const okResult: InvocationResult = { ok: true, output: 'recovered', durationMs: 10 };
    const inner: InvocationStrategy = {
      kind: 'prompt',
      canHandle: vi.fn().mockReturnValue(true),
      invoke: vi.fn()
        .mockResolvedValueOnce(failResult)
        .mockResolvedValueOnce(okResult),
    };
    const decorator = new CacheDecorator(inner, makeDeps());
    const skill = makeSkill({ cacheable: true });

    const r1 = await decorator.invoke(skill, makeContext()); // fail, not cached
    const r2 = await decorator.invoke(skill, makeContext()); // ok, cached
    const r3 = await decorator.invoke(skill, makeContext()); // hit from cache

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
    expect(r3).toBe(r2);
    expect((inner.invoke as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
