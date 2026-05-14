import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { ScriptStrategy } from './script-strategy.js';
import type { ScriptStrategyDeps } from './script-strategy.js';
import type { SkillContent, InvocationContext } from '../core/types.js';
import type { SandboxResult } from '../security/sandbox-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_SCRIPTS_DIR = join('/', 'skills', 'test', 'scripts');

function makeSkill(overrides: Partial<SkillContent> = {}): SkillContent {
  return {
    name: 'test-skill',
    sourcePath: join('/', 'skills', 'test', 'SKILL.md'),
    folder: join('/', 'skills'),
    format: 'claude',
    strategy: 'script',
    allowScripts: true,
    allowNetwork: false,
    scripts: ['main.py'],
    scriptsDir: DEFAULT_SCRIPTS_DIR,
    body: '',
    raw: '',
    ...overrides,
  };
}

function makeContext(overrides: Partial<InvocationContext> = {}): InvocationContext {
  return {
    callerTool: 'invoke',
    input: 'input-x',
    ...overrides,
  };
}

function makeSandboxResult(overrides: Partial<SandboxResult> = {}): SandboxResult {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    durationMs: 50,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ScriptStrategyDeps> = {}): ScriptStrategyDeps & { sandboxRunner: { run: ReturnType<typeof vi.fn> } } {
  const defaultSandbox = { run: vi.fn() };
  const { sandboxRunner: overrideSandbox, ...rest } = overrides;
  return {
    sandboxRunner: (overrideSandbox ?? defaultSandbox) as never,
    isGloballyAllowed: () => true,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    clock: (() => {
      let t = 0;
      return () => t++;
    })(),
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptStrategy', () => {
  describe('kind', () => {
    it('kind === "script"', () => {
      const deps = makeDeps();
      const strategy = new ScriptStrategy(deps);
      expect(strategy.kind).toBe('script');
    });
  });

  describe('canHandle', () => {
    it('returns true when strategy is explicitly "script"', () => {
      const strategy = new ScriptStrategy(makeDeps());
      expect(strategy.canHandle(makeSkill({ strategy: 'script' }))).toBe(true);
    });

    it('returns false when strategy is explicitly "prompt" (even if scripts[] non-empty)', () => {
      const strategy = new ScriptStrategy(makeDeps());
      expect(strategy.canHandle(makeSkill({ strategy: 'prompt', scripts: ['main.py'] }))).toBe(false);
    });

    it('returns false when strategy is explicitly "hybrid"', () => {
      const strategy = new ScriptStrategy(makeDeps());
      expect(strategy.canHandle(makeSkill({ strategy: 'hybrid', scripts: ['main.py'] }))).toBe(false);
    });

    it('returns true when strategy undefined and scripts[] non-empty', () => {
      const strategy = new ScriptStrategy(makeDeps());
      expect(strategy.canHandle(makeSkill({ strategy: undefined, scripts: ['main.py'] }))).toBe(true);
    });

    it('returns false when strategy undefined and scripts[] empty', () => {
      const strategy = new ScriptStrategy(makeDeps());
      expect(strategy.canHandle(makeSkill({ strategy: undefined, scripts: [] }))).toBe(false);
    });

    it('returns false when strategy undefined and scripts undefined', () => {
      const strategy = new ScriptStrategy(makeDeps());
      expect(strategy.canHandle(makeSkill({ strategy: undefined, scripts: undefined }))).toBe(false);
    });
  });

  describe('invoke — gate rejections', () => {
    it('global gate: rejects when isGloballyAllowed returns false, sandbox NOT called', async () => {
      const sandbox = { run: vi.fn() };
      const deps = makeDeps({ sandboxRunner: sandbox as never, isGloballyAllowed: () => false });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill(), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/globally/);
      expect(sandbox.run).not.toHaveBeenCalled();
    });

    it('per-skill gate: rejects when allowScripts is false, sandbox NOT called', async () => {
      const sandbox = { run: vi.fn() };
      const deps = makeDeps({ sandboxRunner: sandbox as never, isGloballyAllowed: () => true });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill({ allowScripts: false }), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/this skill/);
      expect(sandbox.run).not.toHaveBeenCalled();
    });

    it('per-skill gate: rejects when allowScripts is undefined, sandbox NOT called', async () => {
      const sandbox = { run: vi.fn() };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill({ allowScripts: undefined }), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/this skill/);
      expect(sandbox.run).not.toHaveBeenCalled();
    });

    it('rejects when scripts[] is empty', async () => {
      const sandbox = { run: vi.fn() };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill({ scripts: [] }), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no script entries/);
      expect(sandbox.run).not.toHaveBeenCalled();
    });

    it('rejects when scriptsDir is undefined', async () => {
      const sandbox = { run: vi.fn() };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill({ scriptsDir: undefined }), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/scripts\/ directory/);
      expect(sandbox.run).not.toHaveBeenCalled();
    });

    it('rejects unsupported extension and mentions it + allowed list', async () => {
      const sandbox = { run: vi.fn() };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill({ scripts: ['main.rb'] }), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/\.rb/);
      expect(result.error).toMatch(/\.py/);
      expect(sandbox.run).not.toHaveBeenCalled();
    });
  });

  describe('invoke — happy paths', () => {
    it('happy path Python: ok=true, output=stdout, sandbox called with correct args', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult({ stdout: 'hello', durationMs: 50 })) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const ctx = makeContext({ input: 'input-x' });
      const scriptsDir = join('/', 'foo');
      const result = await strategy.invoke(makeSkill({ scripts: ['main.py'], scriptsDir }), ctx);
      expect(result.ok).toBe(true);
      expect(result.output).toBe('hello');
      expect(result.durationMs).toBe(50);
      expect(sandbox.run).toHaveBeenCalledWith(
        'python3',
        [join(scriptsDir, 'main.py')],
        { env: { SKILLFORGE_INPUT: 'input-x' }, signal: ctx.signal, allowNetwork: false },
      );
    });

    it('shell script: sandbox called with bash', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult({ stdout: 'ok' })) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const scriptsDir = join('/', 'scripts');
      await strategy.invoke(makeSkill({ scripts: ['build.sh'], scriptsDir }), makeContext());
      expect(sandbox.run).toHaveBeenCalledWith('bash', [join(scriptsDir, 'build.sh')], expect.any(Object));
    });

    it('node .mjs: sandbox called with node', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult()) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const scriptsDir = join('/', 'scripts');
      await strategy.invoke(makeSkill({ scripts: ['app.mjs'], scriptsDir }), makeContext());
      expect(sandbox.run).toHaveBeenCalledWith('node', [join(scriptsDir, 'app.mjs')], expect.any(Object));
    });

    it('node .js: sandbox called with node', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult()) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const scriptsDir = join('/', 'scripts');
      await strategy.invoke(makeSkill({ scripts: ['index.js'], scriptsDir }), makeContext());
      expect(sandbox.run).toHaveBeenCalledWith('node', [join(scriptsDir, 'index.js')], expect.any(Object));
    });
  });

  describe('invoke — error / edge cases', () => {
    it('non-zero exit code with stderr → ok:false, error=stderr', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult({ exitCode: 2, stderr: 'broke', stdout: '' })) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill(), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toBe('broke');
    });

    it('non-zero exit code with empty stderr → error falls back to "exit code N"', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult({ exitCode: 3, stderr: '', stdout: '' })) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill(), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toBe('exit code 3');
    });

    it('timeout: ok=false, error="timeout", output=partial stdout, durationMs from sandbox', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult({ timedOut: true, exitCode: null, stdout: 'partial', durationMs: 1000 })) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill(), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toBe('timeout');
      expect(result.output).toBe('partial');
      expect(result.durationMs).toBe(1000);
    });

    it('sandbox throws → ok:false, error includes thrown message, logger.error called', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockRejectedValue(new Error('spawn failed')) };
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const deps = makeDeps({ sandboxRunner: sandbox as never, logger });
      const strategy = new ScriptStrategy(deps);
      const result = await strategy.invoke(makeSkill(), makeContext());
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/spawn failed/);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('spawn failed'));
    });

    it('AbortSignal propagated to sandbox.run', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult()) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      const controller = new AbortController();
      const ctx = makeContext({ signal: controller.signal });
      await strategy.invoke(makeSkill(), ctx);
      expect(sandbox.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('allowNetwork=true propagated to sandbox.run', async () => {
      const sandbox = { run: vi.fn<() => Promise<SandboxResult>>().mockResolvedValue(makeSandboxResult()) };
      const deps = makeDeps({ sandboxRunner: sandbox as never });
      const strategy = new ScriptStrategy(deps);
      await strategy.invoke(makeSkill({ allowNetwork: true }), makeContext());
      expect(sandbox.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ allowNetwork: true }),
      );
    });
  });
});
