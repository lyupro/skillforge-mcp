import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { SandboxRunner } from './sandbox-runner.js';
import type { SandboxRunnerDeps } from './sandbox-runner.js';

// ---------------------------------------------------------------------------
// Fake spawn infrastructure
// ---------------------------------------------------------------------------

interface FakeProcess {
  pushStdout(data: string | Buffer): void;
  pushStderr(data: string | Buffer): void;
  close(exitCode: number | null): void;
  emitError(err: Error): void;
  kill: ReturnType<typeof vi.fn>;
  spawnOpts: { cwd: string; env: Record<string, string>; stdio: unknown };
}

function makeFakeSpawn(): {
  spawnFn: ReturnType<typeof vi.fn>;
  lastProcess: () => FakeProcess;
} {
  let last: FakeProcess | null = null;

  const spawnFn = vi.fn(
    (_cmd: string, _args: string[], opts: { cwd: string; env: Record<string, string>; stdio: unknown }): ChildProcess => {
      const handlers = new Map<string, Array<(...a: unknown[]) => void>>();

      const on = vi.fn((event: string, handler: (...a: unknown[]) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return cp;
      });

      const emit = (event: string, ...args: unknown[]) => {
        for (const h of handlers.get(event) ?? []) h(...args);
      };

      const killFn = vi.fn((_signal?: string) => true);

      function makeStream() {
        const sh = new Map<string, Array<(...a: unknown[]) => void>>();
        return {
          on(event: string, handler: (...a: unknown[]) => void) {
            const list = sh.get(event) ?? [];
            list.push(handler);
            sh.set(event, list);
            return this;
          },
          emit(event: string, ...args: unknown[]) {
            for (const h of sh.get(event) ?? []) h(...args);
          },
        };
      }

      const stdoutStream = makeStream();
      const stderrStream = makeStream();

      const cp = {
        stdout: stdoutStream,
        stderr: stderrStream,
        on,
        kill: killFn,
        stdin: null,
        pid: 12345,
      } as unknown as ChildProcess;

      const fake: FakeProcess = {
        kill: killFn,
        spawnOpts: opts,
        pushStdout(data) {
          const buf = typeof data === 'string' ? Buffer.from(data) : data;
          stdoutStream.emit('data', buf);
        },
        pushStderr(data) {
          const buf = typeof data === 'string' ? Buffer.from(data) : data;
          stderrStream.emit('data', buf);
        },
        close(exitCode) {
          emit('close', exitCode);
        },
        emitError(err) {
          emit('error', err);
        },
      };

      last = fake;
      return cp;
    },
  );

  return {
    spawnFn,
    lastProcess: () => {
      if (!last) throw new Error('spawn not yet called');
      return last;
    },
  };
}

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

const FAKE_TMPDIR = '/tmp/test-root';
const FAKE_CREATED_DIR = '/tmp/test-root/skillforge-abc123';

/** Build runner + deps. fs.mkdtemp and fs.rm are mocked in beforeEach. */
function makeRunner(overrides: Partial<SandboxRunnerDeps> = {}): {
  runner: SandboxRunner;
  spawnFn: ReturnType<typeof vi.fn>;
  lastProcess: () => FakeProcess;
} {
  const { spawnFn, lastProcess } = makeFakeSpawn();
  const deps: SandboxRunnerDeps = {
    spawnFn,
    tmpdir: () => FAKE_TMPDIR,
    ...overrides,
  };
  return { runner: new SandboxRunner(deps), spawnFn, lastProcess };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SandboxRunner', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'mkdtemp').mockResolvedValue(FAKE_CREATED_DIR);
    vi.spyOn(fs, 'rm').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Helper: start a run(), wait one microtask tick so mkdtemp resolves + spawn fires
  async function tick(): Promise<void> {
    await Promise.resolve();
  }

  // 1. happy path stdout capture
  it('captures stdout and resolves exitCode 0', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('node', ['-e', '']);
    await tick();
    const proc = lastProcess();
    proc.pushStdout('hello');
    proc.close(0);
    const result = await resultP;
    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  // 2. stderr captured separately
  it('captures stderr and reflects non-zero exit code', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('node', []);
    await tick();
    const proc = lastProcess();
    proc.pushStderr('oops');
    proc.close(1);
    const result = await resultP;
    expect(result.stderr).toBe('oops');
    expect(result.exitCode).toBe(1);
  });

  // 3. env whitelist enforced (POSIX only — Windows keeps full PATH)
  it.skipIf(process.platform === 'win32')(
    'env contains only PATH when no overrides passed',
    async () => {
      const { runner, lastProcess } = makeRunner();
      const resultP = runner.run('echo', []);
      await tick();
      const proc = lastProcess();
      const envKeys = Object.keys(proc.spawnOpts.env);
      proc.close(0);
      await resultP;
      expect(envKeys).toEqual(['PATH']);
      expect(proc.spawnOpts.env['PATH']).toBe('/usr/bin:/bin');
    },
  );

  // 4. env overrides merged in
  it('merges env overrides into whitelist', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('echo', [], { env: { SKILLFORGE_INPUT: 'foo' } });
    await tick();
    const proc = lastProcess();
    proc.close(0);
    await resultP;
    expect(proc.spawnOpts.env['SKILLFORGE_INPUT']).toBe('foo');
    expect('PATH' in proc.spawnOpts.env).toBe(true);
  });

  // 5. no HOME/USER/SSH_AUTH_SOCK leak
  it('does not leak HOME, USER, SSH_AUTH_SOCK into subprocess env', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('echo', []);
    await tick();
    const proc = lastProcess();
    proc.close(0);
    await resultP;
    expect(proc.spawnOpts.env['HOME']).toBeUndefined();
    expect(proc.spawnOpts.env['USER']).toBeUndefined();
    expect(proc.spawnOpts.env['SSH_AUTH_SOCK']).toBeUndefined();
  });

  // 6. cwd is fresh temp dir under tmpdir prefix with 'skillforge-'
  it('sets cwd to a temp dir under tmpdir prefix containing skillforge-', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('echo', []);
    await tick();
    const proc = lastProcess();
    proc.close(0);
    await resultP;
    expect(proc.spawnOpts.cwd).toContain('skillforge-');
    expect(proc.spawnOpts.cwd).toContain(FAKE_TMPDIR);
  });

  // 7. temp dir cleaned up on success
  it('cleans up temp dir after successful run', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('echo', []);
    await tick();
    lastProcess().close(0);
    await resultP;
    expect(fs.rm).toHaveBeenCalledOnce();
    expect(fs.rm).toHaveBeenCalledWith(FAKE_CREATED_DIR, { recursive: true, force: true });
  });

  // 8. temp dir cleaned up even on subprocess error
  it('cleans up temp dir even when subprocess emits error', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('bad-cmd', []);
    await tick();
    lastProcess().emitError(new Error('spawn ENOENT'));
    await expect(resultP).rejects.toThrow('spawn ENOENT');
    expect(fs.rm).toHaveBeenCalledOnce();
    expect(fs.rm).toHaveBeenCalledWith(FAKE_CREATED_DIR, { recursive: true, force: true });
  });

  // 9. pre-aborted signal triggers SIGTERM immediately
  it('sends SIGTERM immediately when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('echo', [], { signal: controller.signal });
    await tick();
    const proc = lastProcess();
    proc.close(null);
    await resultP;
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  // 10. mid-run abort triggers SIGTERM
  it('sends SIGTERM when signal is aborted mid-run', async () => {
    const controller = new AbortController();
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('sleep', ['10'], { signal: controller.signal });
    await tick();
    const proc = lastProcess();
    controller.abort();
    proc.close(null);
    await resultP;
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  // 11. timedOut flag set after abort
  it('sets timedOut=true when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('echo', [], { signal: controller.signal });
    await tick();
    lastProcess().close(null);
    const result = await resultP;
    expect(result.timedOut).toBe(true);
  });

  // 12. SIGKILL sent after 5s grace
  it('sends SIGKILL after 5s grace period when aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('sleep', ['60'], { signal: controller.signal });
    // Flush microtasks so mkdtemp mock resolves and spawn fires
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const proc = lastProcess();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(5500);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    proc.close(null);
    await resultP;
  });

  // 13. stdout tail-truncated at 1MB
  it('truncates stdout at 1MB', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('echo', []);
    await tick();
    const proc = lastProcess();
    proc.pushStdout(Buffer.alloc(1_000_000, 'a'));
    proc.pushStdout(Buffer.alloc(1_000_000, 'a'));
    proc.close(0);
    const result = await resultP;
    expect(result.stdout.length).toBe(1_000_000);
  });

  // 14. stderr tail-truncated at 1MB
  it('truncates stderr at 1MB', async () => {
    const { runner, lastProcess } = makeRunner();
    const resultP = runner.run('echo', []);
    await tick();
    const proc = lastProcess();
    proc.pushStderr(Buffer.alloc(1_000_000, 'b'));
    proc.pushStderr(Buffer.alloc(1_000_000, 'b'));
    proc.close(0);
    const result = await resultP;
    expect(result.stderr.length).toBe(1_000_000);
  });

  // 15. durationMs uses injected clock
  it('computes durationMs from injected clock values', async () => {
    let callCount = 0;
    const clock = () => {
      callCount++;
      return callCount === 1 ? 100 : 350;
    };
    const { runner, lastProcess } = makeRunner({ clock });
    const resultP = runner.run('echo', []);
    await tick();
    lastProcess().close(0);
    const result = await resultP;
    expect(result.durationMs).toBe(250);
  });
});
