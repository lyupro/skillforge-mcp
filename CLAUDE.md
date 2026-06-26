# CLAUDE.md — SkillForge MCP

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project overview

**SkillForge MCP** — universal Model Context Protocol server that exposes Markdown skills from arbitrary user-configured folders to any MCP-capable LLM tool (Claude Code, OpenAI Codex CLI, Cursor, custom clients via `@modelcontextprotocol/sdk`).

Goals: replace per-tool auto-loading of 100+ skills with lazy-by-design MCP discovery, save ~4380 tokens per session init, work across LLM tools through a single config.

**Strategic context:** standalone open-source product under the Lyu Pro brand. Branded GitHub repo `lyupro/skillforge-mcp` + npm package `@lyupro/skillforge-mcp` + listing in `lyupro/llm-plugins-marketplace` (own marketplace, Variant B). v1.0.0 prep ✅ landed on `master` — **v1.0.0** version stamped across `package.json` / `plugin.json` / `manifest.json`, CHANGELOG.md + RELEASE_NOTES.md + docs/PUBLISHING.md runbook + `marketing/copy/` (Twitter / LinkedIn / Reddit / Show HN drafts). Sibling marketplace repo `lyupro/llm-plugins-marketplace` (scaffolded locally, separate git history) lists SkillForge in `marketplace.json`. External publish actions (GitHub release + npm publish + marketplace push + landing paste + social posts) await operator hand-off.

**Sibling repo, not nested.** This project sits parallel to the parent project's repo on disk; they share no git history.

**Source of truth for the plan:** stored in the parent project's `!Plans/` directory (centralized planning). Always re-read it before non-trivial changes — design rationale, stages, acceptance criteria live there.

## Stack

- **Language:** TypeScript, ESM (`"type": "module"`, `module: NodeNext`).
- **Runtime:** Node.js >= 20.
- **Package manager:** pnpm.
- **MCP SDK:** `@modelcontextprotocol/sdk` (stdio transport).
- **Parsing:** `gray-matter` for YAML frontmatter, Zod for runtime validation.
- **Filesystem watching:** `chokidar`.
- **Tests:** Vitest + `@vitest/coverage-v8`. Coverage gate **80%** on core modules (parser/registry/strategies).
- **Pre-commit:** `simple-git-hooks` runs `node scripts/check-file-size.mjs --error`.

## Architecture

```
src/
├── server.ts                # MCP server module — buildServer/buildDeps/startServer
├── core/                    # SkillRegistry, SkillResolver, caches, errors (CyclicSkillDependencyError), shared types
├── parser/                  # FrontmatterParser, FileScanner, FormatDetector, ScriptsDirDetector
├── handlers/                # invocation-strategy + prompt-strategy + script-strategy + hybrid-strategy + composite-resolver
├── factory/                 # StrategyFactory (priority order: [hybrid, script, prompt])
├── decorators/              # base-decorator + logging-decorator + timeout-decorator + cache-decorator + decorator-chain. CostDecorator deferred
├── watcher/                 # FolderWatcher
├── config/                  # ConfigStore, ConfigSchema (incl. invocation section), BlacklistFilter
├── tools/                   # MCP tool handlers: list, get, invoke (composite branch), configure, reload
└── security/                # PatternScanner + SandboxRunner
```

**Design patterns used:** Registry, Strategy, Factory, Adapter, Decorator (chain composition), Composite (skills: [a, b] recursive invocation), Observer (chokidar), Singleton, Open-Closed Principle.

## Extension points

- **New strategy** — implement `InvocationStrategy` (`kind`, `canHandle`, `invoke`), register in `StrategyFactory` constructor list in `buildDeps()`. Earlier entries win on auto-detect. Universal fallbacks (`canHandle` always true) go last.
- **New decorator** — extend `BaseDecorator`, implement `invoke`. To insert into the chain, either modify `DecoratorChain.wrap` or build a custom chain inline. Order is outermost-in.
- **Custom sandbox** — pass a custom `SandboxRunner` to `ScriptStrategy` via constructor injection. Default `node:child_process` implementation enforces env whitelist + temp cwd; OS-level isolation (Docker/firecracker) is a future enhancement.
- **Custom format detection** — extend `FormatDetector` or pass a custom `ScriptsDirDetector` to `FrontmatterParser` for layouts that put scripts elsewhere than sibling `scripts/`.

## Code standards

- **File size ≤ 400 lines** — hard gate enforced via `simple-git-hooks` pre-commit. Exceptions go in `.file-size-limit.json` with documented rationale.
- **TypeScript strict mode** + `noUnusedLocals`/`noUnusedParameters` + `verbatimModuleSyntax`.
- **2-space indentation**, `camelCase` for variables/functions, `PascalCase` for types/classes, `kebab-case` for filenames (e.g. `skill-registry.ts`).
- **Tests colocated** — `foo.ts` next to `foo.test.ts`. Integration tests in `tests/integration/`.
- **No comments unless they explain the WHY** that the code can't (constraints, invariants, workarounds). No "what" comments.

## Commands

```bash
pnpm install            # install deps
pnpm dev                # tsx watch src/cli/dispatcher.ts serve (development)
pnpm test               # vitest run (one-shot)
pnpm test:watch         # vitest in watch mode
pnpm test:coverage      # coverage with 80% gate
pnpm lint               # tsc --noEmit (type-check)
pnpm check:size         # file-size gate (<=400 lines)
pnpm build              # emit dist/ (tsc -p tsconfig.json)
pnpm smoke              # subprocess smoke test against dist/cli/dispatcher.js
```

## Verification protocol

After meaningful changes:

1. `pnpm lint` — type-check passes.
2. `pnpm test` — all tests pass (currently 901 + 2 skipped, including in-process integration via InMemoryTransport covering composite invocation, cycle detection, and the real-frontmatter promotion path for `scripts:` / `cacheable:` / `cacheTtlMs:`).
3. `pnpm check:size` — no file over 400 lines.
4. For MCP-protocol or `src/server.ts` / `src/tools/` changes: `pnpm build && pnpm smoke` — spawns the actual `dist/cli/dispatcher.js serve` entry point and exercises all three tools via a real `StdioClientTransport`. This catches build / module-resolution / shebang issues that the in-process integration test cannot.

## Documentation sync surfaces — update on EVERY change

**Rule:** after any change, before declaring it done, walk this list and update every surface the change touches. A code change that leaves a doc/manifest stale is incomplete. If a **new** doc or surface appears that is not listed here, update it too **and add it to this list** in the same commit — this checklist is itself a surface to keep current.

Match the change to its trigger and update all listed targets:

- **Any code change** → colocated `*.test.ts` for the changed module; then `pnpm lint` + `pnpm test` + `pnpm check:size`. If `src/server.ts` / `src/tools/**` / `src/cli/dispatcher.ts` changed, also `pnpm build && pnpm smoke`.
- **New / changed CLI command or flag** → [`README.md`](./README.md) CLI command table **and** its behavior subsection; `src/cli/dispatcher.ts` `USAGE` + route; the subcommand's own `USAGE` / `--help`; [`docs/INSTALL_CLI.md`](./docs/INSTALL_CLI.md) only when it concerns `install` / `formats` (that doc is scoped, not a full command index); `CHANGELOG.md` + `RELEASE_NOTES.md`.
- **New / changed MCP tool or tool param** → `manifest.json#tools[]` (authoritative description); `src/cli/tools.ts` `TOOL_REFS` (the `tools.test.ts` drift guard enforces parity); [`README.md`](./README.md) "MCP tool surface" table.
- **New / changed config key** → `src/config/config-schema.ts` (+ its test); [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md); [`README.md`](./README.md) config section.
- **New skill format / parser behavior** → [`docs/SKILL_FORMAT.md`](./docs/SKILL_FORMAT.md).
- **New integration host** → [`docs/INTEGRATION/<host>.md`](./docs/INTEGRATION/); [`docs/INSTALL.md`](./docs/INSTALL.md) + [`docs/INSTALL_CLI.md`](./docs/INSTALL_CLI.md); [`README.md`](./README.md) install section; install logic + tests.
- **Version bump / release** → all **four** manifests in lockstep — `package.json`, `manifest.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`; `CHANGELOG.md` new section; `RELEASE_NOTES.md` new section (this is the body pasted into the GitHub Release per [`docs/PUBLISHING.md`](./docs/PUBLISHING.md) — never let it fall behind CHANGELOG); annotated tag `vX.Y.Z` on the bump commit; [`docs/PUBLISHING.md`](./docs/PUBLISHING.md) if the process itself changed.
- **Stage / plan status** → the plan ledger in the parent repo (`!Plans/Plan_12_SkillForge_MCP_v2.md`); commit in that repo separately.

After updating, commit the docs together with the code (Definition of Done = code + tests + synced docs + commit).

## Git policy

- Commits in **English**, short imperative subjects, focus on the "why".
- One commit per logical step. **No push without explicit user request.**
- Never `--amend`, never `--force`, never `--no-verify`.

## Out of scope here

- Parent-project pipeline integration happens in the parent project's repo. This repo stays MCP-only.
- Marketplace catalog lives in the sibling `llm-plugins-marketplace/` repo (scaffolded locally, separate git history). Listing entry already populated; push to GitHub is operator-side.
- Marketing surface — launch copy (Twitter / LinkedIn / Reddit / Show HN drafts) lives at `marketing/copy/`. The landing-page HTML moved to the brand-site repo `lyupro/lyupro-site` (`pages/tools/skillforge/`); it deploys to `lyupro.com/tools/skillforge` and fetches its changelog live from this repo. Social posting + landing deploy are operator-side.
- npm publish + GitHub release — fully prepped (CHANGELOG.md, RELEASE_NOTES.md, package.json files whitelist, `prepublishOnly: pnpm build`, `npm pack --dry-run` verified at 183 KB / 375 entries). Runbook in [`docs/PUBLISHING.md`](./docs/PUBLISHING.md). Execution requires npm credentials + `npm publish --access public` operator-side.

## Language

Plans, decisions, and discussion: Russian. Code, comments, commit messages, and public docs (README, marketplace listing): English.
