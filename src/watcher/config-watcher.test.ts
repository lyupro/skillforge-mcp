import { describe, it, expect, vi } from 'vitest';
import { ConfigWatcher } from './config-watcher.js';
import type { ChokidarLike, ChokidarWatcher, ChokidarOptions } from './chokidar-types.js';

// ---------------------------------------------------------------------------
// Fake chokidar infrastructure
// ---------------------------------------------------------------------------

interface FakeWatcher {
  instance: ChokidarWatcher;
  simulate(event: 'add' | 'change' | 'unlink' | 'error', path: unknown): void;
  watchedPaths: Array<string | readonly string[]>;
  closeCalls: number;
}

function makeFakeChokidar(): { chokidar: ChokidarLike; watchers: FakeWatcher[] } {
  const watchers: FakeWatcher[] = [];

  const chokidar: ChokidarLike = {
    watch(paths: string | readonly string[], _options?: ChokidarOptions): ChokidarWatcher {
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      const fake: FakeWatcher = {
        watchedPaths: [paths],
        closeCalls: 0,
        simulate(event, path) {
          for (const h of handlers.get(event) ?? []) h(path);
        },
        instance: null as unknown as ChokidarWatcher,
      };

      const instance: ChokidarWatcher = {
        on(event, handler) {
          const list = handlers.get(event) ?? [];
          list.push(handler);
          handlers.set(event, list);
          return instance;
        },
        close: async () => { fake.closeCalls++; },
        add() {},
        unwatch() {},
      };

      fake.instance = instance;
      watchers.push(fake);
      return instance;
    },
  };

  return { chokidar, watchers };
}

// ---------------------------------------------------------------------------
// Timer injection helpers
// ---------------------------------------------------------------------------

function makeTimers() {
  let id = 0;
  const pending = new Map<number, () => void>();

  const setTimeoutFn = (cb: () => void, _ms: number): ReturnType<typeof setTimeout> => {
    const tid = ++id;
    pending.set(tid, cb);
    return tid as unknown as ReturnType<typeof setTimeout>;
  };

  const clearTimeoutFn = (tid: ReturnType<typeof setTimeout>): void => {
    pending.delete(tid as unknown as number);
  };

  const flush = () => {
    const cbs = [...pending.values()];
    pending.clear();
    for (const cb of cbs) cb();
  };

  return { setTimeoutFn, clearTimeoutFn, flush };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG_DIR = '/home/user/.lyupro/.skillforge';
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;

function makeWatcher(opts: {
  chokidar: ChokidarLike;
  onChange?: () => void | Promise<void>;
  timers?: ReturnType<typeof makeTimers>;
  configPath?: string;
}) {
  const timers = opts.timers ?? makeTimers();
  const calls: number[] = [];
  const onChange = opts.onChange ?? (() => { calls.push(Date.now()); });
  const watcher = new ConfigWatcher({
    configPath: opts.configPath ?? CONFIG_PATH,
    debounceMs: 50,
    onChange,
    chokidar: opts.chokidar,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  return { watcher, calls, timers };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigWatcher — lifecycle', () => {
  it('start() is idempotent — second call does not create a second chokidar watcher', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher } = makeWatcher({ chokidar });

    await watcher.start();
    await watcher.start();

    expect(watchers).toHaveLength(1);
  });

  it('isRunning() reflects start/stop', async () => {
    const { chokidar } = makeFakeChokidar();
    const { watcher } = makeWatcher({ chokidar });

    expect(watcher.isRunning()).toBe(false);
    await watcher.start();
    expect(watcher.isRunning()).toBe(true);
    await watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });

  it('stop() is idempotent before start()', async () => {
    const { chokidar } = makeFakeChokidar();
    const { watcher } = makeWatcher({ chokidar });
    await expect(watcher.stop()).resolves.not.toThrow();
  });

  it('stop() is idempotent after stop()', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher } = makeWatcher({ chokidar });
    await watcher.start();
    await watcher.stop();
    await watcher.stop();
    expect(watchers[0]!.closeCalls).toBe(1);
  });

  it('watches the parent directory, not the config file itself', async () => {
    // Atomic save (temp+rename) changes the file inode — a direct file watch
    // would go dead, so the watcher must target dirname(configPath).
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher } = makeWatcher({ chokidar });
    await watcher.start();
    expect(watchers[0]!.watchedPaths).toEqual([CONFIG_DIR]);
  });
});

describe('ConfigWatcher — events', () => {
  it('change to config.json fires onChange', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher, calls, timers } = makeWatcher({ chokidar });
    await watcher.start();

    watchers[0]!.simulate('change', CONFIG_PATH);
    timers.flush();

    expect(calls).toHaveLength(1);
  });

  it('add of config.json fires onChange (first-time write)', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher, calls, timers } = makeWatcher({ chokidar });
    await watcher.start();

    watchers[0]!.simulate('add', CONFIG_PATH);
    timers.flush();

    expect(calls).toHaveLength(1);
  });

  it('events for a sibling file in the same dir are ignored', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher, calls, timers } = makeWatcher({ chokidar });
    await watcher.start();

    watchers[0]!.simulate('change', `${CONFIG_DIR}/other-file.json`);
    watchers[0]!.simulate('add', `${CONFIG_DIR}/config.json.tmp`);
    timers.flush();

    expect(calls).toHaveLength(0);
  });

  it('burst of 3 events within debounce window → single onChange', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher, calls, timers } = makeWatcher({ chokidar });
    await watcher.start();

    watchers[0]!.simulate('add', CONFIG_PATH);
    watchers[0]!.simulate('change', CONFIG_PATH);
    watchers[0]!.simulate('change', CONFIG_PATH);
    timers.flush();

    expect(calls).toHaveLength(1);
  });

  it('events across two debounce windows → onChange fires twice', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher, calls, timers } = makeWatcher({ chokidar });
    await watcher.start();

    watchers[0]!.simulate('change', CONFIG_PATH);
    timers.flush();
    watchers[0]!.simulate('change', CONFIG_PATH);
    timers.flush();

    expect(calls).toHaveLength(2);
  });

  it('stop() cancels a pending debounced onChange', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher, calls, timers } = makeWatcher({ chokidar });
    await watcher.start();

    watchers[0]!.simulate('change', CONFIG_PATH);
    await watcher.stop();
    timers.flush();

    expect(calls).toHaveLength(0);
  });

  it('error event writes to stderr and does not crash', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher } = makeWatcher({ chokidar });
    await watcher.start();

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    watchers[0]!.simulate('error', new Error('disk failure'));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[skillforge:config-watcher] error:'),
    );
    spy.mockRestore();
  });

  it('an onChange that throws does not crash the watcher', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const timers = makeTimers();
    const onChange = vi.fn(async () => {
      throw new Error('reconcile blew up');
    });
    const watcher = new ConfigWatcher({
      configPath: CONFIG_PATH,
      debounceMs: 50,
      onChange,
      chokidar,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    await watcher.start();

    watchers[0]!.simulate('change', CONFIG_PATH);
    expect(() => timers.flush()).not.toThrow();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
