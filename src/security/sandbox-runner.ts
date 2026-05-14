import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Logger } from '../decorators/logging-decorator.js';

const STDOUT_TAIL_LIMIT = 1_000_000; // 1 MB
const STDERR_TAIL_LIMIT = 1_000_000;
const SIGTERM_GRACE_MS = 5_000;

export interface SandboxRunOptions {
  /** Additional env vars overlaid ON TOP of the whitelist (e.g. SKILLFORGE_INPUT=...).
   *  These keys are merged into the env whitelist. */
  env?: Record<string, string>;
  /** AbortSignal from TimeoutDecorator. On abort: SIGTERM → 5s grace → SIGKILL. */
  signal?: AbortSignal;
  /** README signal field — NOT enforced at sandbox level. Node child_process
   *  cannot disable network egress. Pass-through for skill author awareness. */
  allowNetwork?: boolean;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface SandboxRunnerDeps {
  logger?: Logger;
  /** Injectable spawn for testing. Defaults to node:child_process spawn. */
  spawnFn?: typeof spawn;
  /** Injectable clock for testing. Defaults to performance.now. */
  clock?: () => number;
  /** Injectable tmpdir resolver for testing. Defaults to os.tmpdir. */
  tmpdir?: () => string;
}

// On Windows, restricting PATH to POSIX-only breaks subprocess discovery
// (node/python resolved via %PATH%). On Windows we pass through process.env.PATH.
// On POSIX we use a minimal whitelist to prevent env leakage.
const DEFAULT_PATH = process.platform === 'win32'
  ? (process.env.PATH ?? '')
  : '/usr/bin:/bin';

function buildEnv(overrides?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = { PATH: DEFAULT_PATH };
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      base[k] = v;
    }
  }
  return base;
}

/**
 * Spawns a subprocess with env whitelist + temp cwd isolation.
 *
 * Hard-enforced (Node child_process can guarantee):
 * - env: only PATH + opts.env overrides. No ~/.ssh / ~/.aws / USER env propagation.
 * - cwd: fresh fs.mkdtemp(os.tmpdir()/skillforge-xxxxxx/), recursive cleanup on exit.
 *
 * NOT enforced (Node child_process limitation):
 * - Network egress: subprocess inherits host network stack.
 * - Filesystem reads outside cwd: subprocess has OS-user permissions.
 * - CPU / memory limits.
 *
 * Abort handling: opts.signal.aborted → SIGTERM → 5s grace → SIGKILL.
 */
export class SandboxRunner {
  readonly #logger?: Logger;
  readonly #spawn: typeof spawn;
  readonly #clock: () => number;
  readonly #tmpdir: () => string;

  constructor(deps: SandboxRunnerDeps = {}) {
    this.#logger = deps.logger;
    this.#spawn = deps.spawnFn ?? spawn;
    this.#clock = deps.clock ?? (() => performance.now());
    this.#tmpdir = deps.tmpdir ?? (() => os.tmpdir());
  }

  async run(
    cmd: string,
    args: readonly string[],
    opts: SandboxRunOptions = {},
  ): Promise<SandboxResult> {
    const start = this.#clock();
    const tmpDir = await fs.mkdtemp(path.join(this.#tmpdir(), 'skillforge-'));
    try {
      return await this.#runInDir(cmd, args, opts, tmpDir, start);
    } finally {
      // Cleanup must happen even if abort raced.
      // fs.rm with force+recursive swallows ENOENT.
      await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
        this.#logger?.warn(
          `[skillforge] sandbox cleanup failed dir=${tmpDir} err=${(err as Error).message}`,
        );
      });
    }
  }

  async #runInDir(
    cmd: string,
    args: readonly string[],
    opts: SandboxRunOptions,
    tmpDir: string,
    start: number,
  ): Promise<SandboxResult> {
    return new Promise<SandboxResult>((resolve, reject) => {
      const child = this.#spawn(cmd, args as string[], {
        cwd: tmpDir,
        env: buildEnv(opts.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutLen = 0;
      let stderrLen = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;
      let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

      const onAbort = () => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        sigkillTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }, SIGTERM_GRACE_MS);
        if (sigkillTimer.unref) sigkillTimer.unref();
      };

      if (opts.signal) {
        if (opts.signal.aborted) {
          onAbort();
        } else {
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutLen < STDOUT_TAIL_LIMIT) {
          stdoutChunks.push(chunk);
          stdoutLen += chunk.length;
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrLen < STDERR_TAIL_LIMIT) {
          stderrChunks.push(chunk);
          stderrLen += chunk.length;
        }
      });

      child.on('error', (err) => {
        if (sigkillTimer) clearTimeout(sigkillTimer);
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        reject(err);
      });

      child.on('close', (exitCode) => {
        if (sigkillTimer) clearTimeout(sigkillTimer);
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        const stdout = Buffer.concat(stdoutChunks).subarray(0, STDOUT_TAIL_LIMIT).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).subarray(0, STDERR_TAIL_LIMIT).toString('utf8');
        const durationMs = Math.round(this.#clock() - start);
        resolve({ exitCode, stdout, stderr, timedOut, durationMs });
      });
    });
  }
}
