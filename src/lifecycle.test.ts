import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerDeps } from './server-deps.js';
import {
  createLifecycle,
  registerTransportShutdown,
  type LifecycleConfig,
  type LifecycleController,
} from './lifecycle.js';

const deps = {} as ServerDeps;
const config: LifecycleConfig = {
  shutdownGraceMs: 2_000,
  parentCheck: false,
  idleTimeoutMs: 0,
  supervisorIntervalMs: 30_000,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createLifecycle', () => {
  it('runs shutdown once and exits once when duplicate events arrive', async () => {
    let releaseStop!: () => void;
    const stopRuntimeFn = vi.fn(
      () => new Promise<void>((resolve) => {
        releaseStop = resolve;
      }),
    );
    const exitFn = vi.fn();
    const lifecycle = createLifecycle({ deps, config, stopRuntimeFn, exitFn });

    const first = lifecycle.shutdown();
    const second = lifecycle.shutdown();
    await Promise.resolve();
    releaseStop();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(stopRuntimeFn).toHaveBeenCalledTimes(1);
    expect(exitFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('forces exit when stopRuntime never resolves', async () => {
    vi.useFakeTimers();
    const exitFn = vi.fn();
    const lifecycle = createLifecycle({
      deps,
      config,
      stopRuntimeFn: () => new Promise<void>(() => undefined),
      exitFn,
    });

    const shutdown = lifecycle.shutdown();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(exitFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await shutdown;

    expect(exitFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('does not expire idle watchdog when idleTimeoutMs is zero', async () => {
    let tick!: () => void;
    const setIntervalFn = vi.fn((callback: () => void) => {
      tick = callback;
      return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    const stopRuntimeFn = vi.fn(async () => undefined);
    const exitFn = vi.fn();
    const lifecycle = createLifecycle({
      deps,
      config: { ...config, parentCheck: true },
      stopRuntimeFn,
      exitFn,
      isProcessAlive: () => true,
      timers: { setIntervalFn },
    });

    lifecycle.startSupervisor();
    tick();
    await Promise.resolve();

    expect(stopRuntimeFn).not.toHaveBeenCalled();
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('does not create a supervisor tick when every check is disabled', () => {
    const setIntervalFn = vi.fn() as unknown as typeof setInterval;
    const lifecycle = createLifecycle({ deps, config, exitFn: vi.fn(), timers: { setIntervalFn } });

    lifecycle.startSupervisor();

    expect(setIntervalFn).not.toHaveBeenCalled();
  });
});

describe('registerTransportShutdown', () => {
  it('preserves transport close handling and routes all close signals to shutdown', () => {
    const previousOnClose = vi.fn();
    const transport = { onclose: previousOnClose };
    const input = new EventEmitter();
    const lifecycle: LifecycleController = {
      markActivity: vi.fn(),
      shutdown: vi.fn(async () => undefined),
      startSupervisor: vi.fn(),
    };

    registerTransportShutdown({ transport, lifecycle, input });
    transport.onclose();
    input.emit('end');
    input.emit('close');

    expect(previousOnClose).toHaveBeenCalledOnce();
    expect(lifecycle.shutdown).toHaveBeenCalledTimes(3);
    expect(lifecycle.startSupervisor).toHaveBeenCalledOnce();
  });
});
