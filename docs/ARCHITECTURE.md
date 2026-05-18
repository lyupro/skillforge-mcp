# Architecture

SkillForge MCP is intentionally small — one stdio server, one in-memory registry, one strategy/decorator pipeline. This document maps every module to its responsibility, explains the design patterns used, and documents the extension points where contributors can plug in new behavior without touching the core.

For the user-facing field contract, see [SKILL_FORMAT.md](./SKILL_FORMAT.md). For deployment knobs, see [CONFIGURATION.md](./CONFIGURATION.md).

---

## One-paragraph overview

Every MCP tool call follows the same path: the tool handler in `src/tools/` reads from `ServerDeps`, calls `ensureRegistryFresh` to gate-keep the lazy scan, looks up the requested skill in `SkillRegistry`, then invokes the `DecoratorChain.wrap(strategy)` against the skill. The chain is composed outermost-in as `Logging → Timeout → Cache → strategy`. Strategies (`PromptStrategy` / `ScriptStrategy` / `HybridStrategy`) produce `InvocationResult` either by returning the prompt body verbatim, by spawning a sandboxed subprocess, or by composing both. Composite skills (`metadata.skills: [a, b]`) walk each nested skill through the same full chain via `resolveComposite`, with DFS cycle detection. Hot reload is observer-pattern: `FolderWatcher` (chokidar) emits batched events that invalidate `SkillMetadataCache`, causing the next `skills__list` to rescan.

---

## Module map

```
src/
├── server.ts                    ← MCP server module — buildServer / buildDeps / startServer
├── server-deps.ts               ← ServerDeps interface (the DI surface)
├── config.ts                    ← loadResolvedConfig + buildPatternScanner (env + persisted merge)
│
├── config/                      ← Persisted JSON layer
│   ├── config-schema.ts         ← Zod schema + PersistedConfig type + defaultConfig()
│   └── config-store.ts          ← ConfigStore: atomic tmp+rename writes, FsAdapter injectable
│
├── core/                        ← Registry + caches + types + errors
│   ├── types.ts                 ← SkillSummary / SkillMetadata / SkillContent / InvocationContext / InvocationResult
│   ├── errors.ts                ← CyclicSkillDependencyError
│   ├── skill-registry.ts        ← Map-backed name → SkillMetadata
│   ├── skill-resolver.ts        ← priority-based conflict resolution across folders
│   ├── skill-metadata-cache.ts  ← single-value freshness flag (TTL gate for the registry)
│   └── skill-content-cache.ts   ← per-skill body LRU + TTL
│
├── parser/                      ← Skill-file → SkillContent
│   ├── file-scanner.ts          ← recursive readdir, prunes node_modules/.git/dist
│   ├── format-detector.ts       ← Claude / Codex / persona / custom dialect
│   ├── frontmatter-parser.ts    ← gray-matter wrapper + field promotion + validation
│   └── scripts-dir-detector.ts  ← sibling scripts/ dir detection
│
├── handlers/                    ← InvocationStrategy implementations + composite resolver
│   ├── invocation-strategy.ts   ← interface (kind, canHandle, invoke)
│   ├── prompt-strategy.ts       ← universal fallback — returns body + input as a prompt blob
│   ├── script-strategy.ts       ← two-gate + interpreter dispatch → SandboxRunner.run
│   ├── hybrid-strategy.ts       ← composes ScriptStrategy + body+script+input prompt blend
│   └── composite-resolver.ts    ← async DFS collectChain + sequential resolveComposite
│
├── factory/                     ← Strategy selection
│   └── strategy-factory.ts      ← explicit skill.strategy OR canHandle() priority order
│
├── decorators/                  ← Cross-cutting concerns
│   ├── base-decorator.ts        ← abstract delegation base
│   ├── logging-decorator.ts     ← stderr trace (invoke / result with wall-clock ms)
│   ├── timeout-decorator.ts     ← Promise.race vs setTimeout, AbortSignal propagation
│   ├── cache-decorator.ts       ← per-(name+input) sha256 key, Map-insertion LRU + TTL
│   └── decorator-chain.ts       ← composes Logging→Timeout→Cache→strategy, .wrap()
│
├── watcher/                     ← Observer pattern hot reload
│   ├── chokidar-types.ts        ← minimal ChokidarLike interface (decouples public API)
│   └── folder-watcher.ts        ← .md filter + longest-prefix attribution + debounce + setFolders diff
│
├── security/                    ← Audit + sandbox
│   ├── pattern-scanner.ts       ← compile + dedupe + zero-width loop guard regex primitive
│   ├── blacklist-filter.ts      ← manual + auto-audit composition; evaluate() returns verdict
│   └── sandbox-runner.ts        ← child_process spawn with env whitelist + cwd=mkdtemp
│
└── tools/                       ← MCP tool handlers
    ├── loader.ts                ← rebuildRegistry + ensureRegistryFresh
    ├── list.ts                  ← skills__list — registry snapshot, optional filters
    ├── get.ts                   ← skills__get — full SkillContent
    ├── invoke.ts                ← skills__invoke — composite branch OR factory.create + chain.wrap
    ├── configure.ts             ← skills__configure — five actions + reconciliation
    └── reload.ts                ← skills__reload — manual rescan with errorSink
```

Every `*.ts` has a colocated `*.test.ts` (or its tests live in a parent `*.test.ts`). Integration tests run via `InMemoryTransport` in `tests/integration/server.test.ts`. The subprocess smoke test lives in `scripts/smoke-test.mjs` and spawns the real `dist/cli/dispatcher.js serve` via `StdioClientTransport`.

---

## Design patterns

| Pattern | Where | Why |
|---------|-------|-----|
| **Registry** | `core/skill-registry.ts` | One source of truth for name → metadata. Tool handlers read; loader writes. |
| **Strategy** | `handlers/*-strategy.ts` | Three different ways to produce an `InvocationResult` from a `SkillContent`. Adding a fourth is a one-file change (see [Extension points](#extension-points)). |
| **Factory** | `factory/strategy-factory.ts` | Decides which strategy handles a given skill via explicit hint OR `canHandle()` priority. |
| **Adapter** | `parser/frontmatter-parser.ts` + `parser/format-detector.ts` | Different on-disk dialects (Claude `SKILL.md`, Codex `AGENTS.md`, persona, custom) all normalize to the same `SkillContent` shape. |
| **Decorator** | `decorators/*.ts` | Logging, timeout, cache layered onto any strategy without modifying strategy code. Chain composition via `DecoratorChain.wrap`. |
| **Composite** | `handlers/composite-resolver.ts` | `metadata.skills: [a, b]` triggers nested invocation. Each nested call goes through the full decorator chain — consistent observability + cancellation + caching. |
| **Observer** | `watcher/folder-watcher.ts` | `chokidar` events emit hot-reload signals that invalidate the metadata cache. Watcher does not parse — single responsibility. |
| **Open-Closed Principle** | `factory/strategy-factory.ts`, `decorators/decorator-chain.ts` | Both accept arbitrary `InvocationStrategy[]` / decorator configurations. New behavior plugs in via constructor injection; existing code unchanged. |
| **Dependency Injection** | `server-deps.ts` + every constructor | Every collaborator is passed in, never `new`'d inside business logic. Enables deterministic tests without `vi.mock`. |

---

## Request flow — `skills__invoke`

```
┌─────────────────┐
│ MCP client      │  callTool({ name: 'skills__invoke', arguments: {...} })
└────────┬────────┘
         │ stdio
         ▼
┌─────────────────┐
│ server.ts       │  → handleInvoke(deps, args)
└────────┬────────┘
         ▼
┌─────────────────┐
│ tools/invoke.ts │
└────────┬────────┘
         │
         ├──► ensureRegistryFresh(deps)        ─► (rebuild if metadataCache.isValid() is false)
         │       │
         │       ├──► FileScanner.scan(folder)
         │       ├──► FrontmatterParser.parseFile(path, folder)
         │       ├──► BlacklistFilter.evaluate(content)
         │       ├──► SkillResolver.resolve(group, folders)   (cross-folder priority)
         │       └──► SkillRegistry.register(winner)
         │
         ├──► registry.get(name)               ─► SkillMetadata
         ├──► contentCache.get(name)           ─► SkillContent (or re-parse if cache miss)
         │
         ├──► branch on skill.skills?.length > 0
         │       ├── YES: resolveComposite(skill, ctx, depsLookup)
         │       │         ├─ collectChain(name, visited)     (async DFS, cycle detection)
         │       │         └─ for each nested name:
         │       │              decoratorChain.wrap(factory.create(nested)).invoke(...)
         │       │              accumulate output under "## Skill: <name>" heading
         │       └── NO:  decoratorChain.wrap(factory.create(skill)).invoke(skill, ctx)
         │
         ▼
┌─────────────────────────────────────┐
│ DecoratorChain (outermost-in)       │
│                                     │
│   LoggingDecorator.invoke(...)      │  → stderr "invoke skill=N kind=K"
│      └─ TimeoutDecorator.invoke()   │  → Promise.race vs setTimeout
│            └─ CacheDecorator.invoke()│ → (name+input)-keyed lookup
│                  └─ strategy.invoke()│  → real work
│                                     │
│   ← stderr "result skill=N ok=B ms=…"│
└─────────────────────────────────────┘
         │
         ▼
   InvocationResult { ok, output, error?, durationMs }
```

The factory + chain are constructed once at boot in `buildDeps()`. Each invocation reuses the same chain instance — there is no per-call object churn beyond the `AbortController` that `TimeoutDecorator` creates.

---

## State + caches

| Cache | Stores | Invalidation |
|-------|--------|--------------|
| `SkillMetadataCache` | Single freshness flag for the registry as a whole | `TTL` expiry + manual `.invalidate()` (called by `FolderWatcher` on batched events and by `skills__reload`). |
| `SkillContentCache` | `name → SkillContent` LRU | TTL per entry. Cleared at the start of every `rebuildRegistry`. |
| `CacheDecorator.#store` | `sha256(name + '\x00' + input) → {result, expiresAt}` | TTL per entry. Per-skill `cacheTtlMs` override falls back to global `invocation.cacheTtlMs`. LRU eviction at `cacheMaxEntries`. |

All three are in-memory only. SkillForge persists nothing about runtime state to disk — only the user-facing JSON config (folder list, blacklist, security gates).

---

## Strategy contract

```ts
interface InvocationStrategy {
  readonly kind: StrategyKind;                                    // 'prompt' | 'script' | 'hybrid'
  canHandle(skill: SkillContent): boolean;                        // selected when explicit skill.strategy hint is absent
  invoke(skill: SkillContent, ctx: InvocationContext): Promise<InvocationResult>;
}
```

- `kind` is informational — surfaces in logging traces and `skills__list` filter.
- `canHandle` is consulted by `StrategyFactory` when frontmatter omits `strategy:`. The factory tries strategies in registration order; first true wins.
- `invoke` returns a structured result. Failures populate `error` and set `ok: false` — never throws unless something truly invariant-breaking happens (in which case the tool handler wraps it).

### `PromptStrategy`

Universal fallback. `canHandle` returns `true` for any skill. Output is the body trimmed + the user input concatenated with a separator.

### `ScriptStrategy`

`canHandle` returns true when explicit `strategy: 'script'` OR when `scripts[]` is non-empty and no other strategy claimed first. `invoke` checks two gates (global `config.security.allowScripts` then per-skill `metadata.allowScripts`), resolves the interpreter from the script's extension (`.py` → python3, `.sh` → bash, `.js`/`.mjs` → node), then delegates to `SandboxRunner.run(cmd, [scriptPath], {env, signal, allowNetwork})`. stdout is the success output. Non-zero exit becomes `error`.

### `HybridStrategy`

`canHandle` is **explicit only** — returns true iff `skill.strategy === 'hybrid'`. `invoke` runs `ScriptStrategy` first; on success it composes:

```
<body trimmed>

## Script output

<script stdout trimmed>

## User input

<user input trimmed>
```

On script failure, the failure result short-circuits unchanged — no prompt blend.

---

## Decorator chain composition

`DecoratorChain.wrap(strategy)` returns a new `InvocationStrategy` whose `.invoke()` walks the outer-to-inner order:

```
Logging → Timeout → Cache → strategy
```

Rationale (outermost-in):

- **Logging outermost** so the stderr trace captures full wall-clock — including time spent in cache lookup, timeout setup, and the inner work.
- **Timeout before Cache** because cache lookup is microseconds; a cache hit on a long-running skill would otherwise still wait on the inner timer to be created and cleared.
- **Cache before strategy** so a hit skips the actual work entirely. The cache stores the InvocationResult that the strategy produced — including its `durationMs` from the original computation. This is intentional: cached responses show their original cost, not zero.

Adding a new decorator: subclass `BaseDecorator`, implement `invoke`, then either modify `DecoratorChain.wrap` to insert it at the correct position, or build a custom chain inline at the call site. See [Extension points](#extension-points).

---

## Composite skill resolution

`resolveComposite(skill, ctx, lookup)` walks `skill.skills` sequentially. Pseudocode:

```ts
const chain = await collectChain(skill.name, new Set());  // DFS, throws CyclicSkillDependencyError

const sections: string[] = [];
for (const nestedName of skill.skills) {
  const nested = lookup(nestedName);
  if (!nested) return { ok: false, error: `nested skill ${nestedName} not found`, ... };

  const nestedStrategy = factory.create(nested);
  const wrapped = decoratorChain.wrap(nestedStrategy);
  const result = await wrapped.invoke(nested, { ...ctx });

  if (!result.ok) {
    return { ok: false, error: `nested skill ${nestedName} failed: ${result.error}`, ... };
  }

  sections.push(`## Skill: ${nestedName}\n\n${result.output}`);
}

sections.push(skill.body.trim());           // parent body last
return { ok: true, output: sections.join('\n\n---\n\n'), ... };
```

The key invariant: every nested invocation goes through the **full DecoratorChain** — same observability, same cancellation propagation, same caching opportunity as a top-level invocation. There is no "inner mode" with a different chain shape.

`collectChain` walks references with a visited set per-call. It is intentionally aggressive: it traverses all reachable subtrees even when a node is already memoized, so cycles through shared subtrees (`a → [b, c]; b → d; c → a`) still surface. The cost is bounded by the skill graph size, which is small in practice.

---

## Watcher mechanics

`FolderWatcher` wraps `chokidar` behind a minimal `ChokidarLike` interface (`watch(folder)`, `add(folder)`, `unwatch(folder)`, `on('add'|'change'|'unlink', fn)`, `close()`). The real `chokidar` package is dynamically imported only when `start()` is first called — tests inject a deterministic fake without touching the real `chokidar` module.

Key behaviors:

- **`.md` filter** — events for any other extension are ignored before the debounce.
- **Longest-prefix folder attribution** — when the same path is reachable through nested watched folders, the deepest one owns the event.
- **Debounced batches** — events within `debounceMs` (default 500 ms) coalesce. The callback fires once per batch with `onBatch()` → `metadataCache.invalidate()`. The next `skills__list` triggers a rescan.
- **`setFolders` diff** — when configured folders change (via `skills__configure`), the watcher computes added/removed sets and calls `add()` / `unwatch()` respectively. There is no whole-watcher teardown — no race window between stop and start.
- **Idempotent `start`/`stop`** — calling twice is a no-op.

The watcher emits cache-invalidation signals only. It never parses skills, never updates the registry directly. Rescanning is the loader's job.

---

## Configuration surface

`loadResolvedConfig(env, store)` produces a `ResolvedConfig`:

```ts
{
  folders: string[];          // env > persisted enabled (priority desc) > built-in default
  ttlMs: number;              // SKILLFORGE_TTL_MS or default 300000
  persisted: PersistedConfig; // Zod-parsed full schema
}
```

`buildDeps()` then constructs every collaborator with the resolved values. Some fields are captured at boot and require a restart to change:

| Field | Live-reload via `skills__configure`? |
|-------|--------------------------------------|
| `folders` (env) | No — requires server restart |
| `folders` (persisted) | **Yes** |
| `blacklist` | **Yes** |
| `security.allowScripts` | Read live on every `ScriptStrategy.invoke` (gate-1 calls `isGloballyAllowed()` which reads `securityRef.allowScripts` — but `securityRef` is captured at boot, so flipping the persisted value requires a restart) |
| `security.autoAudit` / `auditPatterns` | No — `PatternScanner` is constructed at boot |
| `watcher.debounceMs` / `watcher.enabled` | No — `FolderWatcher` is constructed at boot |
| `invocation.*` | No — `DecoratorChain` is constructed at boot |

When in doubt, restart. See [CONFIGURATION.md](./CONFIGURATION.md#editing-configjson-directly).

---

## Extension points

### 1. New strategy

```ts
// src/handlers/my-strategy.ts
import type { InvocationStrategy } from './invocation-strategy.js';
import type { InvocationContext, InvocationResult, SkillContent, StrategyKind } from '../core/types.js';

export class MyStrategy implements InvocationStrategy {
  readonly kind: StrategyKind = 'prompt'; // reuse an existing kind or extend StrategyKind in types.ts

  canHandle(skill: SkillContent): boolean {
    // Decide when this strategy claims the skill. Earlier registration order wins on auto-detect.
    return skill.extra?.['myCustomFlag'] === true;
  }

  async invoke(skill: SkillContent, ctx: InvocationContext): Promise<InvocationResult> {
    // ... your logic
    return { ok: true, output: '...', durationMs: 0 };
  }
}
```

Then register in `buildDeps()` ahead of the universal-fallback `PromptStrategy`:

```ts
const factory = new StrategyFactory([
  hybridStrategy,
  scriptStrategy,
  new MyStrategy(),
  new PromptStrategy(),  // always last
]);
```

### 2. New decorator

```ts
// src/decorators/my-decorator.ts
import { BaseDecorator } from './base-decorator.js';
import type { InvocationContext, InvocationResult, SkillContent } from '../core/types.js';

export class MyDecorator extends BaseDecorator {
  async invoke(skill: SkillContent, ctx: InvocationContext): Promise<InvocationResult> {
    const result = await this.inner.invoke(skill, ctx);
    // ... pre/post hook logic
    return result;
  }
}
```

Insert into the chain in `DecoratorChain.wrap` (preferred — preserves the standard chain shape everywhere) or build a custom chain inline at a specific call site. Order matters — see [Decorator chain composition](#decorator-chain-composition).

### 3. Custom sandbox

```ts
// e.g. Docker-backed sandbox
class DockerSandboxRunner implements SandboxRunner {
  async run(cmd: string, args: string[], opts: SandboxRunOpts): Promise<SandboxResult> {
    // shell out to docker run --rm with stricter constraints
  }
}
```

Wire it into `buildDeps()` in place of the default `new SandboxRunner({ logger })`. `ScriptStrategy` and `HybridStrategy` only depend on the interface, not the concrete class.

### 4. Custom format detection / scripts-dir layout

```ts
// e.g. scripts live in `bin/` not `scripts/`
class BinDirDetector implements ScriptsDirDetector {
  async detect(skillPath: string): Promise<string | undefined> {
    // ... check for sibling bin/ dir
  }
}
```

Pass it to `FrontmatterParser` via the `scriptsDirDetector` option. Same pattern for `FormatDetector` if you want to recognize a new dialect.

### 5. Custom blacklist source

```ts
// e.g. fetch blacklist from a corporate API at boot
class RemoteBlacklistFilter extends BlacklistFilter {
  // override evaluate() — or just preload setManualBlacklist() with the fetched list
}
```

---

## Why these choices

- **In-memory registry, no DB.** SkillForge is a process-local server; the universe of skills fits in RAM (current dogfood: ~100 skills, ~3 MB total). A DB would add a deployment surface for zero benefit. Persistence is for **user config** (folder list, blacklist), not runtime state.
- **No template engine.** Skill bodies pass through verbatim. Template engines would create a runtime dependency for a feature that the consuming LLM is already good at (variable substitution via system prompt).
- **Per-call decorator chain, not per-strategy.** A single chain instance is reused across all invocations. Strategies have no decorator awareness — they just produce results. New decorators don't require touching strategy code, and new strategies inherit logging/timeout/cache for free.
- **`InMemoryTransport` integration tests + subprocess smoke test.** The in-process tests catch handler bugs without spawning Node. The subprocess smoke test catches build / module-resolution / shebang issues the in-process tests cannot. Both are cheap, both run on every CI pass.
- **DI everywhere, `vi.mock` nowhere.** Every collaborator is constructor-injected. Tests pass fakes directly. This keeps test setup explicit and the ESM `vi.mock` quirks out of the codebase.

---

## File-size budget

Hard gate at 400 lines per `*.ts` file, enforced by `simple-git-hooks` pre-commit running `node scripts/check-file-size.mjs --error`. Exceptions get an entry in `.file-size-limit.json#exclusionRationale`. As of v1.0.0 there are 0 exceptions — the modularity gate is intact across all 46 source files.
