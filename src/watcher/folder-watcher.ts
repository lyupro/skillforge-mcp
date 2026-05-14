import type { ChokidarLike, ChokidarWatcher } from './chokidar-types.js';

export type WatcherEventType = 'add' | 'remove' | 'modify';

export interface WatcherEvent {
  type: WatcherEventType;
  /** Absolute path of the .md file that triggered the event. */
  path: string;
  /** Absolute path of the configured root folder that contains this file. */
  folder: string;
}

export interface FolderWatcherOptions {
  folders: readonly string[];
  debounceMs?: number;
  onBatch: (events: readonly WatcherEvent[]) => void;
  chokidar?: ChokidarLike;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

const IGNORED_PATTERNS = [/(^|[/\\])\..+/, /node_modules/, /[/\\]dist[/\\]/] as const;

const CHOKIDAR_OPTS = {
  ignored: IGNORED_PATTERNS,
  ignoreInitial: true,
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  depth: 10,
} as const;

async function loadDefaultChokidar(): Promise<ChokidarLike> {
  const mod = await import('chokidar');
  return {
    watch: (paths, options) =>
      mod.watch(
        paths as string | string[],
        options as Parameters<typeof mod.watch>[1],
      ) as unknown as ChokidarWatcher,
  };
}

export class FolderWatcher {
  readonly #onBatch: (events: readonly WatcherEvent[]) => void;
  readonly #debounceMs: number;
  readonly #setTimeoutFn: typeof setTimeout;
  readonly #clearTimeoutFn: typeof clearTimeout;
  readonly #injectedChokidar: ChokidarLike | undefined;

  #folders: string[];
  #watcher: ChokidarWatcher | null = null;
  #resolvedChokidar: ChokidarLike | null = null;
  #pendingTimer: ReturnType<typeof setTimeout> | null = null;
  #buffer: WatcherEvent[] = [];

  constructor(opts: FolderWatcherOptions) {
    this.#folders = [...opts.folders];
    this.#debounceMs = opts.debounceMs ?? 500;
    this.#onBatch = opts.onBatch;
    this.#injectedChokidar = opts.chokidar;
    this.#setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
    this.#clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  }

  isRunning(): boolean {
    return this.#watcher !== null;
  }

  getFolders(): string[] {
    return [...this.#folders];
  }

  async start(): Promise<void> {
    if (this.#watcher !== null) return;

    const chokidar = this.#injectedChokidar ?? (await this.#getResolvedChokidar());

    // Watch at least one path; chokidar requires a non-empty target.
    const targets = this.#folders.length > 0 ? this.#folders : [];
    if (targets.length === 0) {
      // No folders configured — keep watcher null, stay no-op.
      return;
    }

    this.#watcher = chokidar.watch(targets, CHOKIDAR_OPTS);
    this.#watcher.on('add', (path) => this.#handleRaw('add', path as string));
    this.#watcher.on('change', (path) => this.#handleRaw('modify', path as string));
    this.#watcher.on('unlink', (path) => this.#handleRaw('remove', path as string));
    this.#watcher.on('error', (err) => {
      console.error(`[skillforge:watcher] error: ${String(err)}`);
    });
  }

  async stop(): Promise<void> {
    if (this.#watcher === null) return;

    if (this.#pendingTimer !== null) {
      this.#clearTimeoutFn(this.#pendingTimer);
      this.#pendingTimer = null;
    }
    this.#buffer = [];

    await this.#watcher.close();
    this.#watcher = null;
  }

  async setFolders(folders: readonly string[]): Promise<void> {
    const newSet = new Set(folders);
    const currentSet = new Set(this.#folders);

    const added = [...newSet].filter((f) => !currentSet.has(f));
    const removed = [...currentSet].filter((f) => !newSet.has(f));

    this.#folders = [...folders];

    if (this.#watcher === null) return;

    if (removed.length > 0) {
      this.#watcher.unwatch(removed);
    }
    if (added.length > 0) {
      this.#watcher.add(added);
    }
  }

  async #getResolvedChokidar(): Promise<ChokidarLike> {
    if (this.#resolvedChokidar === null) {
      this.#resolvedChokidar = await loadDefaultChokidar();
    }
    return this.#resolvedChokidar;
  }

  #handleRaw(type: WatcherEventType, path: string): void {
    if (!path.toLowerCase().endsWith('.md')) return;

    const folder = this.#findFolder(path);
    if (folder === null) return;

    this.#buffer.push({ type, path, folder });

    if (this.#pendingTimer !== null) {
      this.#clearTimeoutFn(this.#pendingTimer);
    }
    this.#pendingTimer = this.#setTimeoutFn(() => {
      const batch = this.#buffer;
      this.#buffer = [];
      this.#pendingTimer = null;
      this.#onBatch(batch);
    }, this.#debounceMs);
  }

  #findFolder(filePath: string): string | null {
    // Pick the longest configured folder that is a prefix of filePath.
    let best: string | null = null;
    for (const folder of this.#folders) {
      const normalized = folder.endsWith('/') || folder.endsWith('\\') ? folder : folder + '/';
      if (
        filePath.startsWith(normalized) ||
        filePath.startsWith(folder + '\\') ||
        filePath === folder
      ) {
        if (best === null || folder.length > best.length) {
          best = folder;
        }
      }
    }
    return best;
  }
}
