import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  LoggingDecorator,
  stderrLogger,
  createLeveledLogger,
  envDebugOverride,
} from './logging-decorator.js';
import type { Logger } from './logging-decorator.js';
import type { InvocationStrategy } from '../handlers/invocation-strategy.js';
import type { InvocationContext, InvocationResult, StrategyKind, SkillContent } from '../core/types.js';

function makeSkill(overrides: Partial<SkillContent> = {}): SkillContent {
  return {
    name: 'foo',
    sourcePath: '/skills/foo.md',
    folder: '/skills',
    format: 'claude',
    body: 'Do the thing.',
    raw: '---\nname: foo\n---\nDo the thing.',
    ...overrides,
  };
}

function makeContext(input = 'hello'): InvocationContext {
  return { callerTool: 'invoke', input };
}

function makeInner(
  kind: StrategyKind = 'prompt',
  result: InvocationResult = { ok: true, output: 'x', durationMs: 5 },
): InvocationStrategy {
  return {
    kind,
    canHandle: vi.fn().mockReturnValue(true),
    invoke: vi.fn().mockResolvedValue(result),
  };
}

function makeThrowingInner(message: string, kind: StrategyKind = 'prompt'): InvocationStrategy {
  return {
    kind,
    canHandle: vi.fn().mockReturnValue(true),
    invoke: vi.fn().mockRejectedValue(new Error(message)),
  };
}

function fakeLogger(): { logger: Logger; lines: { level: string; message: string }[] } {
  const lines: { level: string; message: string }[] = [];
  const logger: Logger = {
    debug: (m) => { lines.push({ level: 'debug', message: m }); },
    info: (m) => { lines.push({ level: 'info', message: m }); },
    warn: (m) => { lines.push({ level: 'warn', message: m }); },
    error: (m) => { lines.push({ level: 'error', message: m }); },
  };
  return { logger, lines };
}

describe('LoggingDecorator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs 2 info lines on success with correct format', async () => {
    const { logger, lines } = fakeLogger();
    let tick = 0;
    const clock = () => { tick += 10; return tick; };
    const inner = makeInner('prompt', { ok: true, output: 'x', durationMs: 5 });
    const decorator = new LoggingDecorator(inner, logger, clock);

    await decorator.invoke(makeSkill({ name: 'foo' }), makeContext());

    expect(lines).toHaveLength(2);
    expect(lines[0].level).toBe('info');
    expect(lines[0].message).toBe('[skillforge] invoke skill=foo kind=prompt');
    expect(lines[1].level).toBe('info');
    expect(lines[1].message).toMatch(/^\[skillforge\] result skill=foo ok=true ms=\d+$/);
  });

  it('logs error line and rethrows on inner throw', async () => {
    const { logger, lines } = fakeLogger();
    const clock = () => 0;
    const inner = makeThrowingInner('boom');
    const decorator = new LoggingDecorator(inner, logger, clock);

    await expect(decorator.invoke(makeSkill({ name: 'foo' }), makeContext())).rejects.toThrow('boom');

    expect(lines).toHaveLength(2);
    expect(lines[0].message).toBe('[skillforge] invoke skill=foo kind=prompt');
    expect(lines[1].level).toBe('error');
    expect(lines[1].message).toMatch(/^\[skillforge\] error skill=foo ms=\d+ reason=boom$/);
  });

  it('returns inner result unchanged (no mutation)', async () => {
    const { logger } = fakeLogger();
    const expected: InvocationResult = { ok: true, output: 'x', durationMs: 5 };
    const inner = makeInner('prompt', expected);
    const decorator = new LoggingDecorator(inner, logger);

    const result = await decorator.invoke(makeSkill(), makeContext());

    expect(result).toBe(expected);
  });

  it('uses injectable clock to compute ms delta', async () => {
    const { logger, lines } = fakeLogger();
    let call = 0;
    const clock = () => { call++; return call === 1 ? 100 : 250; };
    const inner = makeInner('prompt', { ok: true, output: '', durationMs: 0 });
    const decorator = new LoggingDecorator(inner, logger, clock);

    await decorator.invoke(makeSkill({ name: 'foo' }), makeContext());

    // delta = 250 - 100 = 150ms
    expect(lines[1].message).toBe('[skillforge] result skill=foo ok=true ms=150');
  });

  it('uses <unknown> when skill name is absent', async () => {
    const { logger, lines } = fakeLogger();
    const inner = makeInner('prompt');
    const decorator = new LoggingDecorator(inner, logger, () => 0);
    // Cast to bypass TS required field — simulates a skill with missing name at runtime
    const skillWithoutName = makeSkill({ name: undefined as unknown as string });

    await decorator.invoke(skillWithoutName, makeContext());

    expect(lines[0].message).toBe('[skillforge] invoke skill=<unknown> kind=prompt');
    expect(lines[1].message).toMatch(/skill=<unknown>/);
  });

  it('stderrLogger default — process.stderr.write called twice on success', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const inner = makeInner('prompt');
    const decorator = new LoggingDecorator(inner);

    await decorator.invoke(makeSkill(), makeContext());

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('mirrors inner.kind dynamically for different strategies', () => {
    const { logger } = fakeLogger();
    const promptInner = makeInner('prompt');
    const scriptInner = makeInner('script');

    const promptDecorator = new LoggingDecorator(promptInner, logger);
    const scriptDecorator = new LoggingDecorator(scriptInner, logger);

    expect(promptDecorator.kind).toBe('prompt');
    expect(scriptDecorator.kind).toBe('script');
  });
});

describe('createLeveledLogger', () => {
  it('default level is info — debug calls are dropped, info/warn/error pass through', () => {
    const { logger: sink, lines } = fakeLogger();
    const leveled = createLeveledLogger({ sink });

    leveled.debug('d');
    leveled.info('i');
    leveled.warn('w');
    leveled.error('e');

    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error']);
  });

  it('level=debug forwards every call', () => {
    const { logger: sink, lines } = fakeLogger();
    const leveled = createLeveledLogger({ level: 'debug', sink });

    leveled.debug('d');
    leveled.info('i');
    leveled.warn('w');
    leveled.error('e');

    expect(lines.map((l) => l.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('level=warn drops debug + info, keeps warn + error', () => {
    const { logger: sink, lines } = fakeLogger();
    const leveled = createLeveledLogger({ level: 'warn', sink });

    leveled.debug('d');
    leveled.info('i');
    leveled.warn('w');
    leveled.error('e');

    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('level=error keeps only error', () => {
    const { logger: sink, lines } = fakeLogger();
    const leveled = createLeveledLogger({ level: 'error', sink });

    leveled.debug('d');
    leveled.info('i');
    leveled.warn('w');
    leveled.error('e');

    expect(lines.map((l) => l.level)).toEqual(['error']);
  });

  it('falls back to the stderrLogger sink when none supplied', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const leveled = createLeveledLogger({ level: 'debug' });

    leveled.debug('hello');

    expect(spy).toHaveBeenCalledWith('hello\n');
    spy.mockRestore();
  });
});

describe('envDebugOverride', () => {
  it('returns null when neither var is set', () => {
    expect(envDebugOverride({})).toBeNull();
  });

  it('returns "debug" when SKILLFORGE_DEBUG=1', () => {
    expect(envDebugOverride({ SKILLFORGE_DEBUG: '1' })).toBe('debug');
  });

  it('returns "debug" when DEBUG=true', () => {
    expect(envDebugOverride({ DEBUG: 'true' })).toBe('debug');
  });

  it('returns null when SKILLFORGE_DEBUG=0 / false / empty', () => {
    expect(envDebugOverride({ SKILLFORGE_DEBUG: '0' })).toBeNull();
    expect(envDebugOverride({ SKILLFORGE_DEBUG: 'false' })).toBeNull();
    expect(envDebugOverride({ SKILLFORGE_DEBUG: '' })).toBeNull();
  });

  it('prefers SKILLFORGE_DEBUG over DEBUG when both are set', () => {
    // Either path returns "debug" when truthy — the test confirms a SF-specific
    // truthy value wins over DEBUG=0 (no silent regression to off).
    expect(envDebugOverride({ SKILLFORGE_DEBUG: '1', DEBUG: '0' })).toBe('debug');
  });

  it('stderrLogger debug method writes to stderr (1.7.1 schema gap fix)', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stderrLogger.debug('dbg');
    expect(spy).toHaveBeenCalledWith('dbg\n');
    spy.mockRestore();
  });
});
