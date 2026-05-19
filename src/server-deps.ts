import type {
  SkillRegistry,
  SkillResolver,
  SkillMetadataCache,
  SkillContentCache,
  SkillIndexStore,
} from './core/index.js';
import type { FrontmatterParser, FileScanner } from './parser/index.js';
import type { StrategyFactory } from './factory/index.js';
import type { BlacklistFilter } from './security/index.js';
import type { ConfigStore } from './config/index.js';
import type { FolderWatcher, ConfigWatcher } from './watcher/index.js';
import type { Logger } from './decorators/index.js';
import type { SandboxRunner } from './security/sandbox-runner.js';
import type { DecoratorChain } from './decorators/index.js';

export interface ServerDeps {
  /** Mutable in-place: configure tool replaces contents via splice. The loader
   *  re-reads on every ensureRegistryFresh call, so swap-in-place propagates. */
  folders: string[];
  configStore: ConfigStore;
  registry: SkillRegistry;
  resolver: SkillResolver;
  metadataCache: SkillMetadataCache;
  contentCache: SkillContentCache;
  /** Persistent on-disk registry index. Lets a fresh CLI process hydrate the
   *  registry from one file read instead of a full cold scan. */
  indexStore: SkillIndexStore;
  /** When false (config `cache.indexEnabled` off or CLI `--no-cache`), the
   *  loader skips the on-disk index entirely and always does a full scan. */
  indexEnabled: boolean;
  scanner: FileScanner;
  parser: FrontmatterParser;
  factory: StrategyFactory;
  blacklistFilter: BlacklistFilter;
  folderWatcher: FolderWatcher;
  /** Watches config.json for out-of-process edits (e.g. the folders CLI). */
  configWatcher: ConfigWatcher;
  logger: Logger;
  sandboxRunner: SandboxRunner;
  decoratorChain: DecoratorChain;
}
