import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeoutDecorator } from './timeout-decorator.js';
import type { TimeoutDecoratorDeps } from './timeout-decorator.js';
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

function makeHangingInner(): InvocationStrategy & { resolve: (r: InvocationResult) => void } {
  let resolve!: (r: InvocationResult) => void;
  const strategy: InvocationStrategy & { resolve: (r: InvocationResult) => void } = {
    kind: 'prompt',
    canHandle: vi.fn().mockReturnValue(true),
    invoke: vi.fn().mockImplementation(() => new Promise<InvocationResult>((res) => { resolve = res; })),
    resolve: (r) => resolve(r),
  };
  return strategy;
}

function makeDeps(overrides: Partial<TimeoutDecoratorDeps> = {}): TimeoutDecoratorDeps {
  return { defaultMs: 1000, ...overrides };
}

describe('TimeoutDecorator', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('inner resolves before timeout → returns inner result unchanged', async () => {
    vi.useFakeTimers();
    const expected: InvocationResult = { ok: true, output: 'fast', durationMs: 50 };
    const inner = makeStubInner(expected);
    const decorator = new TimeoutDecorator(inner, makeDeps({ defaultMs: 1000 }));

    const promise = decorator.invoke(makeSkill(), makeContext());
    // inner already resolved synchronously (mockResolvedValue microtask)
    const result = await promise;

    expect(result).toBe(expected);
  });

  it('timeout fires first → ok:false, error:timeout, durationMs deterministic', async () => {
    vi.useFakeTimers();
    let clockTick = 0;
    const clock = () => { return clockTick; };
    const inner = makeHangingInner();
    const decorator = new TimeoutDecorator(inner, makeDeps({
      defaultMs: 500,
      clock,
    }));

    const promise = decorator.invoke(makeSkill(), makeContext());
    clockTick = 500; // advance logical clock
    vi.advanceTimersByTime(501);

    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
    expect(result.durationMs).toBe(500);
    expect(result.output).toBe('');
  });

  it('per-skill timeoutMs override: fires after skill.timeoutMs not defaultMs', async () => {
    vi.useFakeTimers();
    const setTimeoutFn = vi.fn().mockImplementation((fn: () => void, ms: number) => {
      return (globalThis.setTimeout as typeof setTimeout)(fn, ms);
    });
    const clearTimeoutFn = vi.fn().mockImplementation((id: ReturnType<typeof setTimeout>) => {
      clearTimeout(id);
    });
    const inner = makeHangingInner();
    const decorator = new TimeoutDecorator(inner, makeDeps({
      defaultMs: 1000,
      setTimeoutFn,
      clearTimeoutFn,
    }));

    const skill = makeSkill({ timeoutMs: 200 });
    decorator.invoke(makeSkill(skill), makeContext());

    // setTimeout was called with 200, not 1000
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 200);
    expect(setTimeoutFn).not.toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('timeoutMs=0 → disabled: inner runs freely, setTimeout never called', async () => {
    const setTimeoutFn = vi.fn();
    const inner = makeStubInner({ ok: true, output: 'ok', durationMs: 5 });
    const decorator = new TimeoutDecorator(inner, makeDeps({
      defaultMs: 1000,
      setTimeoutFn,
    }));

    const result = await decorator.invoke(makeSkill({ timeoutMs: 0 }), makeContext());

    expect(setTimeoutFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('negative timeoutMs → disabled: inner runs freely, setTimeout never called', async () => {
    const setTimeoutFn = vi.fn();
    const inner = makeStubInner({ ok: true, output: 'ok', durationMs: 5 });
    const decorator = new TimeoutDecorator(inner, makeDeps({
      defaultMs: 1000,
      setTimeoutFn,
    }));

    const result = await decorator.invoke(makeSkill({ timeoutMs: -1 }), makeContext());

    expect(setTimeoutFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('AbortSignal propagation: inner.invoke called with non-aborted signal', async () => {
    const inner = makeStubInner();
    const decorator = new TimeoutDecorator(inner, makeDeps({ defaultMs: 1000 }));

    await decorator.invoke(makeSkill(), makeContext());

    const callArgs = (inner.invoke as ReturnType<typeof vi.fn>).mock.calls[0] as [SkillContent, InvocationContext];
    const passedContext = callArgs[1];
    expect(passedContext.signal).toBeDefined();
    expect(passedContext.signal!.aborted).toBe(false);
  });

  it('timeout aborts controller signal: after timeout, signal passed to inner is aborted', async () => {
    vi.useFakeTimers();
    const inner = makeHangingInner();
    const decorator = new TimeoutDecorator(inner, makeDeps({ defaultMs: 300 }));

    const promise = decorator.invoke(makeSkill(), makeContext());
    vi.advanceTimersByTime(301);
    await promise;

    const callArgs = (inner.invoke as ReturnType<typeof vi.fn>).mock.calls[0] as [SkillContent, InvocationContext];
    const signal = callArgs[1].signal!;
    expect(signal.aborted).toBe(true);
  });

  it('parent already-aborted signal → child signal immediately aborted', async () => {
    vi.useFakeTimers();
    const parentController = new AbortController();
    parentController.abort();

    const inner = makeStubInner();
    const decorator = new TimeoutDecorator(inner, makeDeps({ defaultMs: 1000 }));

    await decorator.invoke(makeSkill(), makeContext({ signal: parentController.signal }));

    const callArgs = (inner.invoke as ReturnType<typeof vi.fn>).mock.calls[0] as [SkillContent, InvocationContext];
    const signal = callArgs[1].signal!;
    expect(signal.aborted).toBe(true);
  });

  it('parent signal late-abort mid-call → child signal aborted', async () => {
    const parentController = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    const inner: InvocationStrategy = {
      kind: 'prompt',
      canHandle: vi.fn().mockReturnValue(true),
      invoke: vi.fn().mockImplementation((_skill: SkillContent, ctx: InvocationContext) => {
        capturedSignal = ctx.signal;
        return new Promise<InvocationResult>((resolve) => {
          // Resolve after abort fires
          ctx.signal!.addEventListener('abort', () => {
            resolve({ ok: false, output: '', error: 'aborted', durationMs: 0 });
          });
        });
      }),
    };
    const decorator = new TimeoutDecorator(inner, makeDeps({ defaultMs: 5000 }));

    const promise = decorator.invoke(makeSkill(), makeContext({ signal: parentController.signal }));
    parentController.abort();
    await promise;

    expect(capturedSignal!.aborted).toBe(true);
  });

  it('clearTimeout called after inner resolves so timer does not leak', async () => {
    const timerId = {} as ReturnType<typeof setTimeout>;
    const setTimeoutFn = vi.fn().mockReturnValue(timerId);
    const clearTimeoutFn = vi.fn();
    const inner = makeStubInner({ ok: true, output: 'x', durationMs: 5 });
    const decorator = new TimeoutDecorator(inner, makeDeps({
      defaultMs: 1000,
      setTimeoutFn,
      clearTimeoutFn,
    }));

    await decorator.invoke(makeSkill(), makeContext());

    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledWith(timerId);
  });
});
