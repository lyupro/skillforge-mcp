import { describe, it, expect, vi, afterEach } from 'vitest';
import { BaseDecorator } from './base-decorator.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { InvocationContext, InvocationResult, StrategyKind, SkillContent } from '../core/types.js';

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

function makeContext(input = 'hello input'): InvocationContext {
  return { callerTool: 'invoke', input };
}

function makeInner(kind: StrategyKind = 'prompt'): InvocationStrategy {
  return {
    kind,
    canHandle: vi.fn().mockReturnValue(true),
    invoke: vi.fn().mockResolvedValue({ ok: true, output: 'inner result', durationMs: 1 }),
  };
}

/** Minimal concrete subclass to allow testing BaseDecorator delegation. */
class ConcreteDecorator extends BaseDecorator {
  async invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult> {
    return this.inner.invoke(skill, context);
  }
}

describe('BaseDecorator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('kind returns inner.kind (prompt)', () => {
    const inner = makeInner('prompt');
    const decorator = new ConcreteDecorator(inner);
    expect(decorator.kind).toBe('prompt');
  });

  it('kind returns inner.kind (script)', () => {
    const inner = makeInner('script');
    const decorator = new ConcreteDecorator(inner);
    expect(decorator.kind).toBe('script');
  });

  it('canHandle proxies to inner.canHandle — returns true', () => {
    const inner = makeInner();
    (inner.canHandle as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const decorator = new ConcreteDecorator(inner);
    const skill = makeSkill();
    expect(decorator.canHandle(skill)).toBe(true);
    expect(inner.canHandle).toHaveBeenCalledWith(skill);
  });

  it('canHandle proxies to inner.canHandle — returns false', () => {
    const inner = makeInner();
    (inner.canHandle as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const decorator = new ConcreteDecorator(inner);
    expect(decorator.canHandle(makeSkill({ name: 'other' }))).toBe(false);
  });
});
