import { basename, dirname } from 'node:path';
import type { ChokidarLike, ChokidarWatcher } from './chokidar-types.js';

export interface ConfigWatcherOptions {
  /** Absolute path of the config file to watch (e.g. defaultConfigPath()). */
  configPath: string;
  debounceMs?: number;
  /** Invoked (debounced) after the watched config file changes on disk. */
  onChange: () => void | Promise<void>;
  chokidar?: ChokidarLike;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

// The config CLI writes via temp+rename (atomic), so a direct file watch goes
// dead after the first save. We watch the parent directory instead and filter
// raw events down to the config file's basename. Hidden-file ignore patterns
// must NOT be applied — config.json lives in a dotted dir (~/.lyupro/.skillforge).
const CHOKIDAR_OPTS = {
  ignoreInitial: true,
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  depth: 0,
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

/**
 * Watches a single config file for out-of-process edits (e.g. the
 * `skillforge folders` CLI rewriting config.json). Debounced — a burst of
 * raw filesystem events coalesces into one onChange call.
 */
export class ConfigWatcher {
  readonly #configPath: string;
  readonly #configDir: string;
  readonly #configBasename: string;
  readonly #onChange: () => void | Promise<void>;
  readonly #debounceMs: number;
  readonly #setTimeoutFn: typeof setTimeout;
  readonly #clearTimeoutFn: typeof clearTimeout;
  readonly #injectedChokidar: ChokidarLike | undefined;

  #watcher: ChokidarWatcher | null = null;
  #resolvedChokidar: ChokidarLike | null = null;
  #pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ConfigWatcherOptions) {
    this.#configPath = opts.configPath;
    this.#configDir = dirname(opts.configPath);
    this.#configBasename = basename(opts.configPath);
    this.#onChange = opts.onChange;
    this.#debounceMs = opts.debounceMs ?? 400;
    this.#injectedChokidar = opts.chokidar;
    this.#setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
    this.#clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  }

  isRunning(): boolean {
    return this.#watcher !== null;
  }

  getConfigPath(): string {
    return this.#configPath;
  }

  async start(): Promise<void> {
    if (this.#watcher !== null) return;

    const chokidar = this.#injectedChokidar ?? (await this.#getResolvedChokidar());

    this.#watcher = chokidar.watch(this.#configDir, CHOKIDAR_OPTS);
    this.#watcher.on('add', (path) => this.#handleRaw(path as string));
    this.#watcher.on('change', (path) => this.#handleRaw(path as string));
    this.#watcher.on('unlink', (path) => this.#handleRaw(path as string));
    this.#watcher.on('error', (err) => {
      console.error(`[skillforge:config-watcher] error: ${String(err)}`);
    });
  }

  async stop(): Promise<void> {
    if (this.#watcher === null) return;

    if (this.#pendingTimer !== null) {
      this.#clearTimeoutFn(this.#pendingTimer);
      this.#pendingTimer = null;
    }

    await this.#watcher.close();
    this.#watcher = null;
  }

  async #getResolvedChokidar(): Promise<ChokidarLike> {
    if (this.#resolvedChokidar === null) {
      this.#resolvedChokidar = await loadDefaultChokidar();
    }
    return this.#resolvedChokidar;
  }

  #handleRaw(path: string): void {
    // Only react to the config file itself — the parent dir may hold siblings.
    if (basename(path) !== this.#configBasename) return;

    if (this.#pendingTimer !== null) {
      this.#clearTimeoutFn(this.#pendingTimer);
    }
    this.#pendingTimer = this.#setTimeoutFn(() => {
      this.#pendingTimer = null;
      void this.#onChange();
    }, this.#debounceMs);
  }
}
