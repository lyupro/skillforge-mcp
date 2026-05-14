import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FolderWatcher } from './folder-watcher.js';
import type { ChokidarLike, ChokidarWatcher, ChokidarOptions } from './chokidar-types.js';
import type { WatcherEvent } from './folder-watcher.js';

// ---------------------------------------------------------------------------
// Fake chokidar infrastructure
// ---------------------------------------------------------------------------

interface FakeWatcher {
  instance: ChokidarWatcher;
  simulate(event: 'add' | 'change' | 'unlink' | 'error', path: unknown): void;
  addCalls: Array<string | readonly string[]>;
  unwatchCalls: Array<string | readonly string[]>;
  closeCalls: number;
}

function makeFakeChokidar(): { chokidar: ChokidarLike; watchers: FakeWatcher[] } {
  const watchers: FakeWatcher[] = [];

  const chokidar: ChokidarLike = {
    watch(_paths: string | readonly string[], _options?: ChokidarOptions): ChokidarWatcher {
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      const fake: FakeWatcher = {
        addCalls: [],
        unwatchCalls: [],
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
        add(paths) { fake.addCalls.push(paths); },
        unwatch(paths) { fake.unwatchCalls.push(paths); },
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

const FOLDER_A = '/skills/folderA';
const FOLDER_B = '/skills/folderB';

function makeWatcher(opts: {
  folders?: string[];
  chokidar: ChokidarLike;
  onBatch?: (events: readonly WatcherEvent[]) => void;
  timers?: ReturnType<typeof makeTimers>;
}) {
  const timers = opts.timers ?? makeTimers();
  const batches: WatcherEvent[][] = [];
  const onBatch = opts.onBatch ?? ((evs) => batches.push([...evs]));
  const watcher = new FolderWatcher({
    folders: opts.folders ?? [FOLDER_A],
    debounceMs: 50,
    onBatch,
    chokidar: opts.chokidar,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  return { watcher, batches, timers };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FolderWatcher — lifecycle', () => {
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

  it('no watcher created when folders is empty', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const { watcher } = makeWatcher({ folders: [], chokidar });
    await watcher.start();
    expect(watchers).toHaveLength(0);
    expect(watcher.isRunning()).toBe(false);
  });
});

describe('FolderWatcher — events', () => {
  let fake: ReturnType<typeof makeFakeChokidar>;
  let batches: WatcherEvent[][];
  let watcher: FolderWatcher;
  let timers: ReturnType<typeof makeTimers>;

  beforeEach(async () => {
    fake = makeFakeChokidar();
    const result = makeWatcher({ chokidar: fake.chokidar });
    watcher = result.watcher;
    batches = result.batches;
    timers = result.timers;
    await watcher.start();
  });

  it('add event for .md file fires onBatch with type=add', () => {
    fake.watchers[0]!.simulate('add', `${FOLDER_A}/skill.md`);
    timers.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]![0]).toEqual({ type: 'add', path: `${FOLDER_A}/skill.md`, folder: FOLDER_A });
  });

  it('change event fires onBatch with type=modify', () => {
    fake.watchers[0]!.simulate('change', `${FOLDER_A}/skill.md`);
    timers.flush();
    expect(batches[0]![0]!.type).toBe('modify');
  });

  it('unlink event fires onBatch with type=remove', () => {
    fake.watchers[0]!.simulate('unlink', `${FOLDER_A}/skill.md`);
    timers.flush();
    expect(batches[0]![0]!.type).toBe('remove');
  });

  it('non-.md path is ignored — no onBatch fired', () => {
    fake.watchers[0]!.simulate('add', `${FOLDER_A}/skill.ts`);
    timers.flush();
    expect(batches).toHaveLength(0);
  });

  it('burst of 3 events within debounce window → single onBatch with all 3', () => {
    fake.watchers[0]!.simulate('add', `${FOLDER_A}/a.md`);
    fake.watchers[0]!.simulate('change', `${FOLDER_A}/b.md`);
    fake.watchers[0]!.simulate('unlink', `${FOLDER_A}/c.md`);
    timers.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it('events across two debounce windows → onBatch fires twice', () => {
    fake.watchers[0]!.simulate('add', `${FOLDER_A}/a.md`);
    timers.flush();
    fake.watchers[0]!.simulate('add', `${FOLDER_A}/b.md`);
    timers.flush();
    expect(batches).toHaveLength(2);
  });

  it('folder field is the longest prefix match', async () => {
    const nested = `${FOLDER_A}/sub`;
    const { chokidar: fk2, watchers: wt2 } = makeFakeChokidar();
    const batches2: WatcherEvent[][] = [];
    const timers2 = makeTimers();
    const w2 = new FolderWatcher({
      folders: [FOLDER_A, nested],
      debounceMs: 50,
      onBatch: (evs) => batches2.push([...evs]),
      chokidar: fk2,
      setTimeoutFn: timers2.setTimeoutFn,
      clearTimeoutFn: timers2.clearTimeoutFn,
    });
    await w2.start();
    wt2[0]!.simulate('add', `${nested}/deep.md`);
    timers2.flush();
    expect(batches2[0]![0]!.folder).toBe(nested);
  });

  it('event path with no folder prefix match is dropped silently', () => {
    fake.watchers[0]!.simulate('add', '/other/folder/skill.md');
    timers.flush();
    expect(batches).toHaveLength(0);
  });

  it('error event writes to stderr and does not crash', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.watchers[0]!.simulate('error', new Error('disk failure'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[skillforge:watcher] error:'));
    spy.mockRestore();
  });
});

describe('FolderWatcher — setFolders', () => {
  it('while running: diffs are applied via add/unwatch; snapshot updates', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const timers = makeTimers();
    const watcher = new FolderWatcher({
      folders: [FOLDER_A],
      debounceMs: 50,
      onBatch: () => {},
      chokidar,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    await watcher.start();

    await watcher.setFolders([FOLDER_A, FOLDER_B]);

    // addCalls stores the argument passed to watcher.add() — may be string or array
    const addedPaths = watchers[0]!.addCalls.flat();
    expect(addedPaths).toContain(FOLDER_B);
    expect(watcher.getFolders()).toEqual([FOLDER_A, FOLDER_B]);
  });

  it('while running: removed folders are unwatched', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const timers = makeTimers();
    const watcher = new FolderWatcher({
      folders: [FOLDER_A, FOLDER_B],
      debounceMs: 50,
      onBatch: () => {},
      chokidar,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    await watcher.start();

    await watcher.setFolders([FOLDER_A]);

    const unwatchedPaths = watchers[0]!.unwatchCalls.flat();
    expect(unwatchedPaths).toContain(FOLDER_B);
    expect(watcher.getFolders()).toEqual([FOLDER_A]);
  });

  it('while stopped: only snapshot updates; chokidar not touched', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const timers = makeTimers();
    const watcher = new FolderWatcher({
      folders: [FOLDER_A],
      debounceMs: 50,
      onBatch: () => {},
      chokidar,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await watcher.setFolders([FOLDER_B]);

    expect(watchers).toHaveLength(0);
    expect(watcher.getFolders()).toEqual([FOLDER_B]);
  });

  it('empty new list while running: unwatches all', async () => {
    const { chokidar, watchers } = makeFakeChokidar();
    const timers = makeTimers();
    const watcher = new FolderWatcher({
      folders: [FOLDER_A, FOLDER_B],
      debounceMs: 50,
      onBatch: () => {},
      chokidar,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    await watcher.start();

    await watcher.setFolders([]);

    expect(watchers[0]!.unwatchCalls.flat()).toContain(FOLDER_A);
    expect(watchers[0]!.unwatchCalls.flat()).toContain(FOLDER_B);
    expect(watcher.getFolders()).toEqual([]);
  });
});
