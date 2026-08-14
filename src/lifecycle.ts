import type { Readable } from 'node:stream';
import type { ServerDeps } from './server-deps.js';
import { stopRuntime } from './runtime.js';

export interface LifecycleConfig {
  shutdownGraceMs: number;
  parentCheck: boolean;
  idleTimeoutMs: number;
  supervisorIntervalMs: number;
}

export interface LifecycleTimers {
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
}

export interface LifecycleOptions {
  deps: ServerDeps;
  config: LifecycleConfig;
  exitFn?: (code: number) => void;
  timers?: Partial<LifecycleTimers>;
  stopRuntimeFn?: typeof stopRuntime;
  nowFn?: () => number;
  parentPid?: number;
  isProcessAlive?: (pid: number) => boolean;
}

export interface LifecycleController {
  markActivity: () => void;
  shutdown: () => Promise<void>;
  startSupervisor: () => void;
}

function unrefTimer(timer: unknown): void {
  const candidate = timer as { unref?: () => void };
  candidate.unref?.();
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function createLifecycle(options: LifecycleOptions): LifecycleController {
  const timers: LifecycleTimers = {
    setTimeoutFn: options.timers?.setTimeoutFn ?? setTimeout,
    clearTimeoutFn: options.timers?.clearTimeoutFn ?? clearTimeout,
    setIntervalFn: options.timers?.setIntervalFn ?? setInterval,
    clearIntervalFn: options.timers?.clearIntervalFn ?? clearInterval,
  };
  const exitFn = options.exitFn ?? process.exit;
  const stopRuntimeFn = options.stopRuntimeFn ?? stopRuntime;
  const nowFn = options.nowFn ?? Date.now;
  const parentPid = options.parentPid ?? process.ppid;
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  let lastActivityAt = nowFn();
  let shutdownPromise: Promise<void> | undefined;
  let supervisor: ReturnType<typeof setInterval> | undefined;

  const markActivity = (): void => {
    lastActivityAt = nowFn();
  };

  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    shutdownPromise = (async () => {
      if (supervisor !== undefined) {
        timers.clearIntervalFn(supervisor);
        supervisor = undefined;
      }
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const graceElapsed = new Promise<void>((resolve) => {
        graceTimer = timers.setTimeoutFn(resolve, options.config.shutdownGraceMs);
        unrefTimer(graceTimer);
      });
      const stopped = Promise.resolve()
        .then(() => stopRuntimeFn(options.deps))
        .catch(() => undefined);
      await Promise.race([stopped, graceElapsed]);
      if (graceTimer !== undefined) timers.clearTimeoutFn(graceTimer);
      exitFn(0);
    })();
    return shutdownPromise;
  };

  const startSupervisor = (): void => {
    if (supervisor !== undefined) return;
    if (!options.config.parentCheck && options.config.idleTimeoutMs === 0) return;
    supervisor = timers.setIntervalFn(() => {
      const parentDead = options.config.parentCheck && !isProcessAlive(parentPid);
      const idleExpired =
        options.config.idleTimeoutMs > 0 &&
        nowFn() - lastActivityAt >= options.config.idleTimeoutMs;
      if (parentDead || idleExpired) void shutdown();
    }, options.config.supervisorIntervalMs);
    unrefTimer(supervisor);
  };

  return { markActivity, shutdown, startSupervisor };
}

export interface TransportShutdownOptions {
  transport: { onclose?: () => void };
  lifecycle: LifecycleController;
  input?: Pick<Readable, 'once'>;
}

export function registerTransportShutdown(options: TransportShutdownOptions): void {
  const previousOnClose = options.transport.onclose;
  options.transport.onclose = () => {
    previousOnClose?.();
    void options.lifecycle.shutdown();
  };
  const input = options.input ?? process.stdin;
  input.once('end', () => void options.lifecycle.shutdown());
  input.once('close', () => void options.lifecycle.shutdown());
  options.lifecycle.startSupervisor();
}
