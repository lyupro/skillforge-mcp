# CLAUDE.md — SkillForge MCP

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project overview

**SkillForge MCP** — universal Model Context Protocol server that exposes Markdown skills from arbitrary user-configured folders to any MCP-capable LLM tool (Claude Code, OpenAI Codex CLI, Cursor, custom clients via `@modelcontextprotocol/sdk`).

Goals: replace per-tool auto-loading of 100+ skills with lazy-by-design MCP discovery, save ~4380 tokens per session init, work across LLM tools through a single config.

**Strategic context:** standalone open-source product under the Lyu Pro brand. Branded GitHub repo `lyupro/skillforge-mcp` + npm package `@lyupro/skillforge-mcp` + listing in `lyupro/llm-plugins-marketplace` (own marketplace, Variant B). v1.0.0 prep ✅ landed on `master` — **v1.0.0** version stamped across `package.json` / `plugin.json` / `manifest.json`, CHANGELOG.md + RELEASE_NOTES.md + docs/PUBLISHING.md runbook + `marketing/landing/` (WordPress-ready HTML) + `marketing/copy/` (Twitter / LinkedIn / Reddit / Show HN drafts). Sibling marketplace repo `lyupro/llm-plugins-marketplace` (scaffolded locally, separate git history) lists SkillForge in `marketplace.json`. External publish actions (GitHub release + npm publish + marketplace push + landing paste + social posts) await operator hand-off.

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
├── server.ts                # MCP stdio entry point — buildServer/buildDeps
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
pnpm dev                # tsx watch src/server.ts (development)
pnpm test               # vitest run (one-shot)
pnpm test:watch         # vitest in watch mode
pnpm test:coverage      # coverage with 80% gate
pnpm lint               # tsc --noEmit (type-check)
pnpm check:size         # file-size gate (<=400 lines)
pnpm build              # emit dist/ (tsc -p tsconfig.json)
pnpm smoke              # subprocess smoke test against dist/server.js
```

## Verification protocol

After meaningful changes:

1. `pnpm lint` — type-check passes.
2. `pnpm test` — all tests pass (currently 370 + 1 win32-skip, including in-process integration via InMemoryTransport covering composite invocation, cycle detection, and the real-frontmatter promotion path for `scripts:` / `cacheable:` / `cacheTtlMs:`).
3. `pnpm check:size` — no file over 400 lines.
4. For MCP-protocol or `src/server.ts` / `src/tools/` changes: `pnpm build && pnpm smoke` — spawns the actual `dist/server.js` binary and exercises all three tools via a real `StdioClientTransport`. This catches build / module-resolution / shebang issues that the in-process integration test cannot.

## Git policy

- Commits in **English**, short imperative subjects, focus on the "why".
- One commit per logical step. **No push without explicit user request.**
- Never `--amend`, never `--force`, never `--no-verify`.

## Out of scope here

- Parent-project pipeline integration happens in the parent project's repo. This repo stays MCP-only.
- Marketplace catalog lives in the sibling `llm-plugins-marketplace/` repo (scaffolded locally, separate git history). Listing entry already populated; push to GitHub is operator-side.
- Marketing surface — landing-page HTML lives at `marketing/landing/index.html` (WordPress paste-ready) and launch copy at `marketing/copy/` (Twitter / LinkedIn / Reddit / Show HN drafts). Deploy to `lyupro.com/skillforge-mcp` + social posting is operator-side.
- npm publish + GitHub release — fully prepped (CHANGELOG.md, RELEASE_NOTES.md, package.json files whitelist, `prepublishOnly: pnpm build`, `npm pack --dry-run` verified at 58 KB / 189 entries). Runbook in [`docs/PUBLISHING.md`](./docs/PUBLISHING.md). Execution requires npm credentials + `npm publish --access public` operator-side.

## Language

Plans, decisions, and discussion: Russian. Code, comments, commit messages, and public docs (README, marketplace listing): English.
