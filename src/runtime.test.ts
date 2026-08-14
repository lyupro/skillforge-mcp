import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ServerDeps } from './server-deps.js';
import { registerShutdown, startRuntime, stopRuntime } from './runtime.js';

describe('runtime', () => {
  it('starts and stops both runtime watchers', async () => {
    const folderWatcher = { start: vi.fn(), stop: vi.fn() };
    const configWatcher = { start: vi.fn(), stop: vi.fn() };
    const deps = { folderWatcher, configWatcher } as unknown as ServerDeps;

    await startRuntime(deps);
    await stopRuntime(deps);

    expect(folderWatcher.start).toHaveBeenCalledOnce();
    expect(configWatcher.start).toHaveBeenCalledOnce();
    expect(folderWatcher.stop).toHaveBeenCalledOnce();
    expect(configWatcher.stop).toHaveBeenCalledOnce();
  });

  it('routes SIGTERM and SIGINT through the supplied lifecycle shutdown', () => {
    const signals = new EventEmitter();
    const shutdown = vi.fn(async () => undefined);

    registerShutdown(shutdown, signals);
    signals.emit('SIGTERM');
    signals.emit('SIGINT');

    expect(shutdown).toHaveBeenCalledTimes(2);
  });
});
