import { describe, it, expect, vi } from 'vitest';
import { HybridStrategy } from './hybrid-strategy.js';
import type { HybridStrategyDeps } from './hybrid-strategy.js';
import type { SkillContent, InvocationContext, InvocationResult } from '../core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillContent> = {}): SkillContent {
  return {
    name: 'test-skill',
    sourcePath: '/skills/test/SKILL.md',
    folder: '/skills',
    format: 'claude',
    strategy: 'hybrid',
    allowScripts: true,
    scripts: ['main.py'],
    body: 'do the thing.',
    raw: '---\nstrategy: hybrid\n---\ndo the thing.',
    ...overrides,
  };
}

function makeContext(overrides: Partial<InvocationContext> = {}): InvocationContext {
  return {
    callerTool: 'invoke',
    input: 'arg-1',
    ...overrides,
  };
}

function makeScriptStub(result: InvocationResult) {
  return {
    kind: 'script' as const,
    canHandle: vi.fn(),
    invoke: vi.fn().mockResolvedValue(result),
  };
}

function makeDeps(overrides: Partial<HybridStrategyDeps> = {}): HybridStrategyDeps {
  return {
    scriptStrategy: makeScriptStub({ ok: true, output: 'hello world', durationMs: 50 }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HybridStrategy', () => {
  it('kind === "hybrid"', () => {
    const strategy = new HybridStrategy(makeDeps());
    expect(strategy.kind).toBe('hybrid');
  });

  it('canHandle: strategy="hybrid" → true', () => {
    const strategy = new HybridStrategy(makeDeps());
    expect(strategy.canHandle(makeSkill({ strategy: 'hybrid' }))).toBe(true);
  });

  it('canHandle: strategy="script" → false', () => {
    const strategy = new HybridStrategy(makeDeps());
    expect(strategy.canHandle(makeSkill({ strategy: 'script' }))).toBe(false);
  });

  it('canHandle: strategy undefined → false (no auto-detect)', () => {
    const strategy = new HybridStrategy(makeDeps());
    expect(strategy.canHandle(makeSkill({ strategy: undefined }))).toBe(false);
  });

  it('canHandle: strategy="prompt" → false', () => {
    const strategy = new HybridStrategy(makeDeps());
    expect(strategy.canHandle(makeSkill({ strategy: 'prompt' }))).toBe(false);
  });

  it('happy path: script ok=true → prompt blob assembled with all three sections in order', async () => {
    const scriptStub = makeScriptStub({ ok: true, output: 'hello world', durationMs: 50 });
    const strategy = new HybridStrategy({ scriptStrategy: scriptStub });
    const skill = makeSkill({ body: 'do the thing.' });
    const ctx = makeContext({ input: 'arg-1' });

    const result = await strategy.invoke(skill, ctx);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('do the thing.');
    expect(result.output).toContain('## Script output\n\nhello world');
    expect(result.output).toContain('## User input\n\narg-1');
    // Order: body → script → user input
    const bodyIdx = result.output.indexOf('do the thing.');
    const scriptIdx = result.output.indexOf('## Script output');
    const inputIdx = result.output.indexOf('## User input');
    expect(bodyIdx).toBeLessThan(scriptIdx);
    expect(scriptIdx).toBeLessThan(inputIdx);
  });

  it('script ok=false → returned as-is, no prompt blend', async () => {
    const failResult: InvocationResult = { ok: false, error: 'boom', output: 'partial', durationMs: 25 };
    const scriptStub = makeScriptStub(failResult);
    const strategy = new HybridStrategy({ scriptStrategy: scriptStub });

    const result = await strategy.invoke(makeSkill(), makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.output).toBe('partial');
    expect(result.output).not.toContain('## Script output');
    expect(result.durationMs).toBe(25);
  });

  it('empty body — section omitted, output starts with ## Script output', async () => {
    const scriptStub = makeScriptStub({ ok: true, output: 'result', durationMs: 10 });
    const strategy = new HybridStrategy({ scriptStrategy: scriptStub });

    const result = await strategy.invoke(makeSkill({ body: '' }), makeContext({ input: 'x' }));

    expect(result.ok).toBe(true);
    expect(result.output.startsWith('## Script output')).toBe(true);
    expect(result.output).toContain('## User input\n\nx');
  });

  it('empty input — ## User input section omitted', async () => {
    const scriptStub = makeScriptStub({ ok: true, output: 'result', durationMs: 10 });
    const strategy = new HybridStrategy({ scriptStrategy: scriptStub });

    const result = await strategy.invoke(makeSkill({ body: 'body text' }), makeContext({ input: '' }));

    expect(result.ok).toBe(true);
    expect(result.output).toContain('## Script output\n\nresult');
    expect(result.output).not.toContain('## User input');
  });

  it('durationMs uses injected clock, not scriptResult.durationMs', async () => {
    const clockValues = [100, 350];
    let callCount = 0;
    const clock = () => clockValues[callCount++] ?? 350;

    const scriptStub = makeScriptStub({ ok: true, output: 'out', durationMs: 999 });
    const strategy = new HybridStrategy({ scriptStrategy: scriptStub, clock });

    const result = await strategy.invoke(makeSkill(), makeContext());

    expect(result.ok).toBe(true);
    expect(result.durationMs).toBe(250); // 350 - 100
  });

  it('script invoke receives the exact same skill and context objects (no mutation)', async () => {
    const scriptStub = makeScriptStub({ ok: true, output: 'out', durationMs: 10 });
    const strategy = new HybridStrategy({ scriptStrategy: scriptStub });
    const skill = makeSkill();
    const ctx = makeContext();

    await strategy.invoke(skill, ctx);

    expect(scriptStub.invoke).toHaveBeenCalledWith(skill, ctx);
  });

  it('trim behaviour — padded body, script output, and input are trimmed in assembled sections', async () => {
    const scriptStub = makeScriptStub({ ok: true, output: '\n  word\n', durationMs: 10 });
    const strategy = new HybridStrategy({ scriptStrategy: scriptStub });

    const result = await strategy.invoke(
      makeSkill({ body: ' padded \n\n' }),
      makeContext({ input: '\t  in  ' }),
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain('padded');
    expect(result.output).not.toMatch(/^ /m); // no section starts with a space
    expect(result.output).toContain('## Script output\n\nword');
    expect(result.output).toContain('## User input\n\nin');
    // No leading/trailing whitespace artifacts inside section bodies
    expect(result.output).not.toContain('\n  word');
    expect(result.output).not.toContain('\t  in');
  });
});
