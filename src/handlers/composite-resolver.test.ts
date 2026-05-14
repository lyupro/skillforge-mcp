import { describe, it, expect, vi } from 'vitest';
import { collectChain, resolveComposite } from './composite-resolver.js';
import { CyclicSkillDependencyError } from '../core/errors.js';
import type { SkillContent, InvocationContext, InvocationResult } from '../core/types.js';

function makeSkill(overrides: Partial<SkillContent> = {}): SkillContent {
  return {
    name: 'test-skill',
    sourcePath: '/skills/test-skill.md',
    folder: '/skills',
    format: 'claude',
    body: '',
    raw: '',
    ...overrides,
  };
}

function makeContext(input = 'test input'): InvocationContext {
  return { callerTool: 'invoke', input };
}

function okResult(output: string): InvocationResult {
  return { ok: true, output, durationMs: 1 };
}

function failResult(output: string, error: string): InvocationResult {
  return { ok: false, output, error, durationMs: 1 };
}

// ─── collectChain tests ───────────────────────────────────────────────────────

describe('collectChain', () => {
  it('no skills[] — only root collected', async () => {
    const root = makeSkill({ name: 'a', skills: undefined });
    const load = vi.fn();
    const chain = await collectChain(root, load);
    expect(chain.size).toBe(1);
    expect(chain.get('a')).toBe(root);
    expect(load).not.toHaveBeenCalled();
  });

  it('empty skills array — only root collected', async () => {
    const root = makeSkill({ name: 'a', skills: [] });
    const load = vi.fn();
    const chain = await collectChain(root, load);
    expect(chain.size).toBe(1);
    expect(load).not.toHaveBeenCalled();
  });

  it('linear chain a→b→c — all three collected', async () => {
    const a = makeSkill({ name: 'a', skills: ['b'] });
    const b = makeSkill({ name: 'b', skills: ['c'] });
    const c = makeSkill({ name: 'c', skills: [] });
    const load = vi.fn(async (name: string) => ({ a, b, c }[name]));
    const chain = await collectChain(a, load);
    expect(chain.size).toBe(3);
    expect(chain.get('a')).toBe(a);
    expect(chain.get('b')).toBe(b);
    expect(chain.get('c')).toBe(c);
  });

  it('diamond a→[b,c], b→d, c→d — d loaded only once', async () => {
    const a = makeSkill({ name: 'a', skills: ['b', 'c'] });
    const b = makeSkill({ name: 'b', skills: ['d'] });
    const c = makeSkill({ name: 'c', skills: ['d'] });
    const d = makeSkill({ name: 'd', skills: [] });
    const load = vi.fn(async (name: string) => ({ b, c, d }[name as 'b' | 'c' | 'd']));
    const chain = await collectChain(a, load);
    expect(chain.size).toBe(4);
    const dCalls = load.mock.calls.filter(([n]) => n === 'd');
    expect(dCalls).toHaveLength(1);
  });

  it('self-reference a→[a] — throws CyclicSkillDependencyError, path [a,a]', async () => {
    const a = makeSkill({ name: 'a', skills: ['a'] });
    const load = vi.fn();
    await expect(collectChain(a, load)).rejects.toThrowError(CyclicSkillDependencyError);
    await expect(collectChain(a, load)).rejects.toMatchObject({ path: ['a', 'a'] });
  });

  it('simple cycle a→[b], b→[a] — throws with path [a,b,a]', async () => {
    const a = makeSkill({ name: 'a', skills: ['b'] });
    const b = makeSkill({ name: 'b', skills: ['a'] });
    const load = vi.fn(async (name: string) => (name === 'b' ? b : undefined));
    await expect(collectChain(a, load)).rejects.toMatchObject({ path: ['a', 'b', 'a'] });
  });

  it('deeper cycle a→b→c→a — throws with path [a,b,c,a]', async () => {
    const a = makeSkill({ name: 'a', skills: ['b'] });
    const b = makeSkill({ name: 'b', skills: ['c'] });
    const c = makeSkill({ name: 'c', skills: ['a'] });
    const load = vi.fn(async (name: string) => ({ b, c }[name as 'b' | 'c']));
    await expect(collectChain(a, load)).rejects.toMatchObject({ path: ['a', 'b', 'c', 'a'] });
  });

  it('cycle through diamond a→[b,c], c→a — throws with path [a,c,a]', async () => {
    const a = makeSkill({ name: 'a', skills: ['b', 'c'] });
    const b = makeSkill({ name: 'b', skills: [] });
    const c = makeSkill({ name: 'c', skills: ['a'] });
    const load = vi.fn(async (name: string) => ({ b, c }[name as 'b' | 'c']));
    await expect(collectChain(a, load)).rejects.toMatchObject({ path: ['a', 'c', 'a'] });
  });

  it('unknown skill reference — throws Error with "unknown skill" message', async () => {
    const a = makeSkill({ name: 'a', skills: ['missing'] });
    const load = vi.fn(async () => undefined);
    await expect(collectChain(a, load)).rejects.toThrow('unknown skill referenced from composite: missing');
  });

  it('empty skills in nested — nested treated as leaf, not traversed further', async () => {
    const a = makeSkill({ name: 'a', skills: ['b'] });
    const b = makeSkill({ name: 'b', skills: [] });
    const load = vi.fn(async () => b);
    const chain = await collectChain(a, load);
    expect(chain.size).toBe(2);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

// ─── resolveComposite tests ───────────────────────────────────────────────────

describe('resolveComposite', () => {
  it('happy path: outputs concatenated with separator', async () => {
    const root = makeSkill({ name: 'a', body: 'Root body', skills: ['b', 'c'] });
    const b = makeSkill({ name: 'b' });
    const c = makeSkill({ name: 'c' });
    const load = vi.fn(async (name: string) => ({ b, c }[name as 'b' | 'c']));
    const invoke = vi.fn(async (skill: SkillContent) =>
      okResult(skill.name === 'b' ? 'B-out' : 'C-out'),
    );
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Root body');
    expect(result.output).toContain('## Skill: b');
    expect(result.output).toContain('B-out');
    expect(result.output).toContain('## Skill: c');
    expect(result.output).toContain('C-out');
    expect(result.output).toContain('\n\n---\n\n');
  });

  it('sequential ordering preserved — b invoked before c', async () => {
    const root = makeSkill({ name: 'a', skills: ['b', 'c'] });
    const b = makeSkill({ name: 'b' });
    const c = makeSkill({ name: 'c' });
    const load = vi.fn(async (name: string) => ({ b, c }[name as 'b' | 'c']));
    const order: string[] = [];
    const invoke = vi.fn(async (skill: SkillContent) => {
      order.push(skill.name);
      return okResult(`${skill.name}-out`);
    });
    await resolveComposite(root, makeContext(), load, invoke);
    expect(order).toEqual(['b', 'c']);
  });

  it('parent body prepended when non-empty', async () => {
    const root = makeSkill({ name: 'a', body: 'Parent preamble', skills: ['b'] });
    const b = makeSkill({ name: 'b' });
    const load = vi.fn(async () => b);
    const invoke = vi.fn(async () => okResult('B-out'));
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.output.startsWith('Parent preamble')).toBe(true);
  });

  it('empty parent body — output starts with ## Skill: b (no leading separator)', async () => {
    const root = makeSkill({ name: 'a', body: '', skills: ['b'] });
    const b = makeSkill({ name: 'b' });
    const load = vi.fn(async () => b);
    const invoke = vi.fn(async () => okResult('B-out'));
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.output.startsWith('## Skill: b')).toBe(true);
  });

  it('cycle returns ok:false with cycle error message', async () => {
    const root = makeSkill({ name: 'root-self', skills: ['root-self'] });
    const load = vi.fn();
    const invoke = vi.fn();
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('composite skill cycle detected');
    expect(result.error).toContain('root-self');
  });

  it('unknown skill reference returns ok:false with unknown skill message', async () => {
    const root = makeSkill({ name: 'a', skills: ['missing'] });
    const load = vi.fn(async () => undefined);
    const invoke = vi.fn();
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unknown skill');
  });

  it('nested failure short-circuits — second skill not invoked', async () => {
    const root = makeSkill({ name: 'a', skills: ['b', 'c'] });
    const b = makeSkill({ name: 'b' });
    const c = makeSkill({ name: 'c' });
    const load = vi.fn(async (name: string) => ({ b, c }[name as 'b' | 'c']));
    const invoke = vi.fn(async (skill: SkillContent) => {
      if (skill.name === 'b') return failResult('partial', 'broke');
      return okResult('C-out');
    });
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('nested skill b failed: broke');
    const cCalls = invoke.mock.calls.filter(([s]) => s.name === 'c');
    expect(cCalls).toHaveLength(0);
  });

  it('nested failure output preserved for diagnosis', async () => {
    const root = makeSkill({ name: 'a', skills: ['b'] });
    const b = makeSkill({ name: 'b' });
    const load = vi.fn(async () => b);
    const invoke = vi.fn(async () => failResult('partial-out', 'broke'));
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.output).toBe('partial-out');
  });

  it('body and output trimmed in sections', async () => {
    const root = makeSkill({ name: 'a', body: '  trimmed body  ', skills: ['b'] });
    const b = makeSkill({ name: 'b' });
    const load = vi.fn(async () => b);
    const invoke = vi.fn(async () => okResult('  trimmed output  '));
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.output).toContain('trimmed body');
    expect(result.output).toContain('trimmed output');
    expect(result.output).not.toMatch(/^\s{2,}/m);
  });

  it('clock injection used for durationMs', async () => {
    const root = makeSkill({ name: 'a', skills: [] });
    const load = vi.fn();
    const invoke = vi.fn();
    let t = 1000;
    const clock = vi.fn(() => t++);
    const result = await resolveComposite(root, makeContext(), load, invoke, clock);
    expect(result.durationMs).toBe(1); // round(1001 - 1000) = 1
    expect(clock).toHaveBeenCalled();
  });

  it('empty skills array — returns root body as output, ok:true, no nested invokes', async () => {
    const root = makeSkill({ name: 'a', body: 'Just root', skills: [] });
    const load = vi.fn();
    const invoke = vi.fn();
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.ok).toBe(true);
    expect(result.output).toBe('Just root');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('invokeSkill receives same context object as parent', async () => {
    const root = makeSkill({ name: 'a', skills: ['b'] });
    const b = makeSkill({ name: 'b' });
    const load = vi.fn(async () => b);
    const ctx = makeContext('my-input');
    let capturedCtx: InvocationContext | undefined;
    const invoke = vi.fn(async (_skill: SkillContent, context: InvocationContext) => {
      capturedCtx = context;
      return okResult('out');
    });
    await resolveComposite(root, ctx, load, invoke);
    expect(capturedCtx).toBe(ctx);
  });

  it('deep chain a→b→c, all succeed — full chain in output', async () => {
    const root = makeSkill({ name: 'a', skills: ['b', 'c'] });
    const b = makeSkill({ name: 'b', skills: [] });
    const c = makeSkill({ name: 'c', skills: [] });
    const load = vi.fn(async (name: string) => ({ b, c }[name as 'b' | 'c']));
    const invoke = vi.fn(async (skill: SkillContent) => okResult(`${skill.name}-result`));
    const result = await resolveComposite(root, makeContext(), load, invoke);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('## Skill: b');
    expect(result.output).toContain('b-result');
    expect(result.output).toContain('## Skill: c');
    expect(result.output).toContain('c-result');
  });
});
