import { readFile, writeFile, rename, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { configSchema, defaultConfig } from './config-schema.js';
import type { PersistedConfig } from './config-schema.js';

interface FsAdapter {
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, contents: string) => Promise<void>;
  rename: (oldP: string, newP: string) => Promise<void>;
  mkdir: (p: string, opts: { recursive: boolean }) => Promise<void>;
  access: (p: string) => Promise<void>;
}

export interface ConfigStoreOptions {
  filePath: string;
  fs?: FsAdapter;
}

function buildDefaultFs(): FsAdapter {
  return {
    readFile: (p) => readFile(p, 'utf8'),
    writeFile: (p, contents) => writeFile(p, contents),
    rename: (oldP, newP) => rename(oldP, newP),
    mkdir: (p, opts) => mkdir(p, opts).then(() => undefined),
    access: (p) => access(p).then(() => undefined),
  };
}

export class ConfigStore {
  readonly #filePath: string;
  readonly #fs: FsAdapter;

  constructor(opts: ConfigStoreOptions) {
    this.#filePath = opts.filePath;
    this.#fs = opts.fs ?? buildDefaultFs();
  }

  async load(): Promise<PersistedConfig> {
    let raw: string;
    try {
      await this.#fs.access(this.#filePath);
    } catch {
      return defaultConfig();
    }

    try {
      raw = await this.#fs.readFile(this.#filePath);
    } catch (err) {
      throw new Error(
        `ConfigStore: failed to read "${this.#filePath}": ${String(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `ConfigStore: invalid JSON in "${this.#filePath}": ${String(err)}`,
      );
    }

    const result = configSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `ConfigStore: schema validation failed for "${this.#filePath}": ${result.error.message}`,
      );
    }

    return result.data;
  }

  async save(config: PersistedConfig): Promise<void> {
    const result = configSchema.safeParse(config);
    if (!result.success) {
      throw new Error(
        `ConfigStore: cannot save invalid config: ${result.error.message}`,
      );
    }

    const dir = dirname(this.#filePath);
    await this.#fs.mkdir(dir, { recursive: true });

    const tmpPath = `${this.#filePath}.tmp`;
    const contents = JSON.stringify(result.data, null, 2);
    await this.#fs.writeFile(tmpPath, contents);
    await this.#fs.rename(tmpPath, this.#filePath);
  }

  getFilePath(): string {
    return this.#filePath;
  }
}

export function defaultConfigPath(): string {
  return join(homedir(), '.lyupro', '.skillforge', 'config.json');
}

/**
 * Default location of the persistent registry index, derived from the config
 * directory: `<configDir>/cache/registry-index.json`. Pass an explicit config
 * path to keep the index alongside a non-default config (used by tests).
 */
export function defaultIndexPath(configPath: string = defaultConfigPath()): string {
  return join(dirname(configPath), 'cache', 'registry-index.json');
}
