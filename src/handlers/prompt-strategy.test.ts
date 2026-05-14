import { describe, it, expect, vi, afterEach } from 'vitest';
import { PromptStrategy } from './prompt-strategy.js';
import type { SkillContent, InvocationContext } from '../core/types.js';

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

describe('PromptStrategy', () => {
  const strategy = new PromptStrategy();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('kind is prompt', () => {
    expect(strategy.kind).toBe('prompt');
  });

  it('canHandle returns true for any skill shape', () => {
    expect(strategy.canHandle(makeSkill())).toBe(true);
    expect(strategy.canHandle(makeSkill({ name: 'other', body: '' }))).toBe(true);
  });

  it('invoke returns ok:true with non-negative finite durationMs', async () => {
    const result = await strategy.invoke(makeSkill(), makeContext());
    expect(result.ok).toBe(true);
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('output contains skill name header', async () => {
    const result = await strategy.invoke(makeSkill({ name: 'my-skill' }), makeContext());
    expect(result.output).toContain('# Skill: my-skill');
  });

  it('output contains description when defined and non-empty', async () => {
    const result = await strategy.invoke(
      makeSkill({ description: 'Converts images to text' }),
      makeContext(),
    );
    expect(result.output).toContain('Converts images to text');
  });

  it('output contains body and input section', async () => {
    const result = await strategy.invoke(
      makeSkill({ body: 'Step 1. Step 2.' }),
      makeContext('user input here'),
    );
    expect(result.output).toContain('Step 1. Step 2.');
    expect(result.output).toContain('## Input');
    expect(result.output).toContain('user input here');
  });

  it('section ordering: name header before body, body before ## Input', async () => {
    const result = await strategy.invoke(
      makeSkill({ body: 'THE_BODY' }),
      makeContext('THE_INPUT'),
    );
    const nameIdx = result.output.indexOf('# Skill:');
    const bodyIdx = result.output.indexOf('THE_BODY');
    const inputIdx = result.output.indexOf('## Input');
    expect(nameIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(inputIdx);
  });

  it('description undefined — no double blank line before body', async () => {
    const skill = makeSkill({ description: undefined, body: 'BODY_CONTENT' });
    const result = await strategy.invoke(skill, makeContext());
    // Without description the output must not have two consecutive blank lines
    // between the header and the body.
    expect(result.output).not.toContain('\n\n\n');
    expect(result.output).toContain('BODY_CONTENT');
  });

  it('empty description string — treated as absent, not emitted', async () => {
    const result = await strategy.invoke(makeSkill({ description: '' }), makeContext());
    // The empty description must not produce a lone blank line where the
    // description text would have been.
    expect(result.output).not.toContain('\n\n\n');
  });

  it('empty input — ## Input section still present', async () => {
    const result = await strategy.invoke(makeSkill(), makeContext(''));
    expect(result.output).toContain('## Input\n');
  });

  it('empty body — still returns ok:true', async () => {
    const result = await strategy.invoke(makeSkill({ body: '' }), makeContext());
    expect(result.ok).toBe(true);
  });

  it('error path — Proxy body getter throws, invoke returns ok:false with error message', async () => {
    // A Proxy whose `body` getter throws is the least invasive way to trigger
    // the catch branch without patching globals or internal implementation details.
    const throwing = new Proxy(makeSkill(), {
      get(target, prop) {
        if (prop === 'body') throw new Error('body access failed');
        return target[prop as keyof SkillContent];
      },
    });

    const result = await strategy.invoke(throwing as SkillContent, makeContext());
    expect(result.ok).toBe(false);
    expect(result.output).toBe('');
    expect(result.error).toBe('body access failed');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
