export interface ChokidarOptions {
  ignored?: RegExp | readonly RegExp[];
  ignoreInitial?: boolean;
  persistent?: boolean;
  awaitWriteFinish?: boolean | { stabilityThreshold?: number; pollInterval?: number };
  depth?: number;
}

export interface ChokidarWatcher {
  on(event: 'add' | 'change' | 'unlink' | 'error', handler: (...args: unknown[]) => void): this;
  close(): Promise<void>;
  add(paths: string | readonly string[]): void;
  unwatch(paths: string | readonly string[]): void;
}

export interface ChokidarLike {
  watch(paths: string | readonly string[], options?: ChokidarOptions): ChokidarWatcher;
}
