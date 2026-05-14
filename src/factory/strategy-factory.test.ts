import { describe, it, expect } from 'vitest';
import { StrategyFactory } from './strategy-factory.js';
import { PromptStrategy } from '../handlers/prompt-strategy.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { SkillContent, StrategyKind } from '../core/types.js';

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

function makeStub(kind: StrategyKind, canHandleResult: boolean): InvocationStrategy {
  return {
    kind,
    canHandle: () => canHandleResult,
    invoke: async () => ({ ok: true, output: '', durationMs: 0 }),
  };
}

describe('StrategyFactory', () => {
  describe('empty registry', () => {
    it('create() throws the empty-registry error when no strategies registered', () => {
      const factory = new StrategyFactory();
      expect(() => factory.create(makeSkill())).toThrow(
        'StrategyFactory: no strategies registered',
      );
    });

    it('registeredKinds is empty array when constructed with no args', () => {
      const factory = new StrategyFactory();
      expect(factory.registeredKinds).toEqual([]);
    });
  });

  describe('constructor with strategies', () => {
    it('auto-detect: create() returns PromptStrategy instance for skill with strategy undefined', () => {
      const prompt = new PromptStrategy();
      const factory = new StrategyFactory([prompt]);
      const result = factory.create(makeSkill());
      expect(result).toBe(prompt);
    });

    it('registeredKinds reflects constructor-supplied strategies', () => {
      const factory = new StrategyFactory([new PromptStrategy()]);
      expect(factory.registeredKinds).toEqual(['prompt']);
    });
  });

  describe('explicit dispatch', () => {
    it('returns the matching strategy when skill.strategy is set', () => {
      const prompt = new PromptStrategy();
      const factory = new StrategyFactory([prompt]);
      const result = factory.create(makeSkill({ strategy: 'prompt' }));
      expect(result).toBe(prompt);
    });

    it('throws "Strategy not registered: script" when skill.strategy is not registered', () => {
      const factory = new StrategyFactory([new PromptStrategy()]);
      expect(() => factory.create(makeSkill({ strategy: 'script' }))).toThrow(
        'Strategy not registered: script',
      );
    });
  });

  describe('auto-detect dispatch', () => {
    it('returns first strategy whose canHandle returns true', () => {
      const falsy = makeStub('prompt', false);
      const truthy = makeStub('script', true);
      const factory = new StrategyFactory([falsy, truthy]);
      const result = factory.create(makeSkill());
      expect(result).toBe(truthy);
    });

    it('throws "No strategy can handle skill: <name>" when no strategy accepts the skill', () => {
      const stub = makeStub('prompt', false);
      const factory = new StrategyFactory([stub]);
      expect(() => factory.create(makeSkill({ name: 'my-skill' }))).toThrow(
        'No strategy can handle skill: my-skill',
      );
    });
  });

  describe('register()', () => {
    it('adds a new kind to the registry', () => {
      const factory = new StrategyFactory();
      const stub = makeStub('script', true);
      factory.register(stub);
      expect(factory.registeredKinds).toContain('script');
    });

    it('re-registering replaces the value but preserves insertion order', () => {
      // Register 'prompt' (canHandle=false) then 'script' (canHandle=true).
      // Re-register 'prompt' with a new stub (still canHandle=false).
      // Auto-detect must still pick 'script', AND kinds order stays ['prompt', 'script'].
      const factory = new StrategyFactory();
      factory.register(makeStub('prompt', false));
      factory.register(makeStub('script', true));

      const newPrompt = makeStub('prompt', false);
      factory.register(newPrompt);

      expect(factory.registeredKinds).toEqual(['prompt', 'script']);

      const result = factory.create(makeSkill());
      expect(result.kind).toBe('script');
    });

    it('re-registering same kind replaces the stored instance', () => {
      const factory = new StrategyFactory();
      const first = makeStub('prompt', true);
      const second = makeStub('prompt', true);
      factory.register(first);
      factory.register(second);
      const result = factory.create(makeSkill());
      expect(result).toBe(second);
      expect(result).not.toBe(first);
    });
  });

  describe('registeredKinds accessor', () => {
    it('returns kinds in registration order', () => {
      const factory = new StrategyFactory();
      factory.register(makeStub('hybrid', true));
      factory.register(makeStub('script', true));
      factory.register(makeStub('prompt', true));
      expect(factory.registeredKinds).toEqual(['hybrid', 'script', 'prompt']);
    });
  });
});
