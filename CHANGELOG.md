# Changelog

All notable changes to **SkillForge MCP** are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-05-16

Terminal-side tooling — inspect MCP tools and manage skill folders without an LLM session, plus repo-local install scope and Claude Code plugin packaging.

### Added

- `skillforge tools` CLI subcommand — prints the 5 MCP tools the server exposes (`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`) with each tool's description, parameters, and an example invocation. Pass `--json` for machine-readable output. Lets you confirm the tool surface without starting an LLM session.
- `skillforge folders` CLI subcommand — manage skill folders from the terminal: `folders list [--json]`, `folders add <path> [--priority N] [--tags a,b] [--disabled]`, `folders remove <path>`, `folders reset --yes`. Previously folder management was only reachable via the `skills__configure` MCP tool inside an LLM session; both surfaces now read and write the same persisted config.
- `--scope global|project` flag on `skillforge install` / `skillforge uninstall`. The default `global` scope edits each host's home-directory config (unchanged behavior). `--scope project` wires SkillForge into a repo-local config rooted at the current directory — `.mcp.json` (Claude Code), `.codex/config.toml` (Codex CLI), `.cursor/mcp.json` (Cursor).
- Skill-source conflict detection. Registering a folder that already lives inside another tool's native skill store (a Claude Code plugin cache or a Gemini CLI extension) now surfaces a hint to disable the duplicate source — otherwise the same skills load twice and skill names collide. The `folders add` CLI prints the hint; the `skills__configure` `add_folder` action returns it as a `conflictHint` field. The conflict is informational only — it never blocks the folder from being added, and SkillForge never edits another tool's config.
- Claude Code plugin packaging — `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. SkillForge can now be installed via `claude plugin install` (rich `/plugins` UI card) in addition to `claude mcp add` and `skillforge install`.

### Verified

- 535 / 535 tests passing + 1 win32-skip.
- `pnpm lint` (`tsc --noEmit`) clean.
- `pnpm build` clean.
- `pnpm check:size` — all source files ≤ 400 lines.

## [1.1.1] — 2026-05-15

Single-bin dispatcher — fixes `npx @lyupro/skillforge-mcp install --all` hanging on stdin.

### Fixed

- `npx @lyupro/skillforge-mcp install ...` previously hung because the package shipped two bins (`skillforge-mcp` → server, `skillforge` → install CLI), and `npx` matched the package's unscoped basename to the server bin, which silently waited on stdio. Both bins now resolve to a unified dispatcher that routes by the first positional argument.

### Added

- `src/cli/dispatcher.ts` — single CLI entry point that routes between `serve`, `install`, `uninstall`, `--help`, and `--version`.
- `skillforge-mcp serve` subcommand — explicit invocation of the MCP stdio server (default when no command is supplied).
- `skillforge-mcp --version` — prints the package version.
- Dispatcher unit tests covering help, version, serve routing, install/uninstall delegation, and unknown-command rejection.

### Changed

- `package.json#bin` — both `skillforge-mcp` and `skillforge` now point at `dist/cli/dispatcher.js`.
- `manifest.json#runtime.entry` — `dist/cli/dispatcher.js`. MCP host configs that auto-detect the entry pick up the dispatcher and fall through to `serve` when invoked with no args.
- Installer-generated host config entries now write `args: ['-y', '@lyupro/skillforge-mcp', 'serve']` explicitly. Older `['-y', '@lyupro/skillforge-mcp']` entries still work — the default subcommand resolves to `serve`.

### Verified

- All existing tests passing + dispatcher suite added.
- `pnpm lint` (`tsc --noEmit`) clean.
- `pnpm build` clean.
- Manual smoke test from a fresh shell: `npx --yes @lyupro/skillforge-mcp@1.1.1 install --all --dry-run` outputs planned edits and exits cleanly.

## [1.1.0] — 2026-05-14

One-command install across Claude Code, Codex CLI, and Cursor.

### Added

- `skillforge install` CLI — wires SkillForge MCP into host tools by editing each host's config file directly.
- Three installers — Claude Code (`~/.claude.json`), Codex CLI (`~/.codex/config.toml`), Cursor (OS-specific `settings.json`).
- Flags — `--claude`, `--codex`, `--cursor`, `--all`, `--dry-run`, `--uninstall`, `--force`, `--entry npx|local`, `--binary-path <path>`.
- Atomic-write helper with `.backup` snapshot — failed write never leaves the host config in a broken state.
- OS-specific path detection for Cursor (Windows `%APPDATA%`, macOS `Library/Application Support`, Linux `~/.config`).
- Second package bin — `skillforge` → `./dist/cli/install.js` alongside the existing `skillforge-mcp` stdio server entry.
- New documentation — [docs/INSTALL_CLI.md](./docs/INSTALL_CLI.md) (flag table, examples, host edit shapes, troubleshooting).

### Verified

- 451 / 451 tests passing + 1 win32-skip (+81 new tests for the install CLI).
- `pnpm lint` (`tsc --noEmit`) clean.
- `pnpm build` clean.
- `pnpm check:size` — all 54 source files ≤ 400 lines.

## [1.0.0] — 2026-05-13

First public release. Universal Skills MCP server: load Markdown skills from arbitrary folders, lazy-by-design, cross-tool (Claude Code / Codex CLI / Cursor / custom MCP clients).

### Added — MCP tool surface (5 tools)

- `skills__list` — enumerate available skills with metadata-only response (filters: `folder`, `search`, `source`).
- `skills__get` — retrieve full content (body + metadata) of a named skill.
- `skills__invoke` — invoke a skill by name, forwarding optional input. Composite skills walk nested skills sequentially with DFS cycle detection. Pipeline: Logging → Timeout → Cache → strategy (Prompt / Script / Hybrid).
- `skills__configure` — manage configured folders, blacklist, reset (actions: `add_folder`, `remove_folder`, `list_folders`, `set_blacklist`, `get_blacklist`, `reset`). Persists to platform config path.
- `skills__reload` — force a full rescan of all configured folders. Returns `{ loaded, added, removed, errors }` diff.

### Added — Strategies

- **PromptStrategy** — default for skills without `scripts` metadata. Returns Markdown body as MCP text content.
- **ScriptStrategy** — sibling `scripts/` directory + manifest `scripts: [...]` entry. Opt-in via both `config.security.allowScripts = true` and frontmatter `allowScripts: true`. Sandboxed: env whitelist, mkdtemp cwd, AbortSignal kill.
- **HybridStrategy** — script produces context block prepended to the prompt body. Useful for `git log --since=last-tag` style enrichment.
- **CompositeResolver** — `skills: [a, b, c]` frontmatter walks nested skills sequentially. DFS cycle detection. Combined output returned.

### Added — Decorators

- **LoggingDecorator** — stderr trace of invocation lifecycle. Includes strategy name + ms duration.
- **TimeoutDecorator** — wraps `InvocationContext.signal` to enforce per-invocation timeout. Default 30s, override via `metadata.timeoutMs`.
- **CacheDecorator** — opt-in via `metadata.cacheable = true`. Returns identical `InvocationResult` instance (frozen `durationMs`) for repeat invocations within TTL.

### Added — Universal skill format

- Markdown body + YAML frontmatter contract.
- Canonical camelCase frontmatter + 4 snake_case aliases (`allow_scripts` / `allow_network` / `timeout_ms` / `cache_ttl_ms`).
- Four format dialects auto-detected: Claude (Anthropic), Codex (TOML-flavored), persona (character-style), custom (anything with frontmatter).
- Strategy decision tree: explicit `kind` field → metadata signals → default Prompt.

### Added — Configuration

- Persistent JSON config at the canonical Lyu Pro brand path `~/.lyupro/.skillforge/config.json`, resolved cross-platform via `os.homedir()`. Skills shared content lives under `~/.lyupro/skills/`.
- Folder cascade with priority — higher priority wins on name conflicts.
- Blacklist (manual + automatic via `PatternScanner` security audit).
- Hot reload via `chokidar` `FolderWatcher` — debounced batches, content-cache invalidation.
- Five worked configs in `examples/configs/`: `default.json`, `team-shared-folder.json`, `team-priority-with-default-fallback.json`, `scripts-enabled.json`, `multifolder-cascade.json`.

### Added — Security

- `PatternScanner` audit primitive — regex-based detection of dangerous patterns (`subprocess`, `os.system`, `pickle`, `__import__`, etc.).
- `BlacklistFilter` — manual entries + auto-flagged via audit. Loader gates skills before registry insertion.
- `SandboxRunner` for ScriptStrategy — env whitelist (`/usr/bin:/bin` POSIX), `mkdtemp` cwd, stdout/stderr cap (1 MB), AbortSignal kill on timeout, exit-code propagation.
- `Composite cycle detection` — DFS visited-set throws `CompositeCycleError` on loops.

### Added — Documentation

- `README.md` v1.0 — Pain/solution matrix, 60-second Quick Start, badges, status banner.
- `docs/INSTALL.md` — 4 wiring tracks (Claude Code / Codex CLI / Cursor / manual MCP client), folder-config 3 ways, verify checklist, upgrade/uninstall, 8-row troubleshooting matrix.
- `docs/SKILL_FORMAT.md` — field-level frontmatter contract, 4 dialects, strategy decision tree, 5 worked examples (prompt / script / hybrid / composite / persona), conflict resolution, validation rules.
- `docs/CONFIGURATION.md` — env vars + persisted JSON layers, annotated schema (live vs reserved fields), 5 `skills__configure` actions, `skills__reload` semantics, 4 worked configs.
- `docs/ARCHITECTURE.md` — module map (11 directories), 9 design patterns with local references, full `skills__invoke` request flow trace, 3 cache surfaces, 5 extension points with snippets, rationale for anchor decisions.
- `docs/SECURITY.md` — threat model (8 in-scope + 5 out-of-scope rows), 5-step SandboxRunner contract, defence-in-depth layers, Windows PATH compromise documentation, operator checklist, responsible-disclosure policy.
- `docs/INTEGRATION/` — per-tool wiring: claude-code.md, codex.md, cursor.md, custom-llm-tools.md.

### Added — Sample skills

10 production-quality skills in `skills/`:

- **6 prompt** — `apple-hig-check`, `refactor-suggester`, `commit-message-writer`, `prompt-optimizer`, `idea-onepager`, `obsidian-resume`.
- **2 script** — `dependency-checker` (npm audit summariser, `scripts/main.sh`), `markdown-linter` (stdlib-only Python, `scripts/main.py`).
- **2 hybrid** — `changelog-generator` (git log since last semver tag), `git-blame-summary` (blame + recent commits enriched prompt).

All 10 verified through real parse pipeline + `StrategyFactory.create()` correct-kind assertion.

### Added — Marketplace artifacts

- `manifest.json` (upstream MCP schema) — 5 tools, env vars, doc pointers, verification commands.
- `plugin.json` (Claude Code marketplace schema) — install command, exposedTools, honest permissions block (subprocess opt-in, network none, filesystem write = platform config + tmpdir sandbox).

### Fixed — Real-frontmatter promotion (commit `a38e2c4`)

- `FrontmatterParser.CONSUMED_KEYS` now promotes `scripts`, `cacheable`, `cache_ttl_ms`, `cacheTtlMs` from real frontmatter. Earlier these fields fell into `extra` because `CONSUMED_KEYS` whitelist was opt-in; `ScriptStrategy.canHandle()` always returned false in the real subprocess pipeline.
- Defensive extraction: array-of-strings for `scripts`, boolean literal for `cacheable`, finite positive for `cacheTtlMs`.
- +6 unit tests (promotion, snake_case alias, defensive drops, extra-isolation).
- +2 integration tests verifying `script-promo` skill triggers `ScriptStrategy` and `cached-prompt` skill activates `CacheDecorator` (second invoke returns identical instance with frozen `durationMs`).

### Verified

- **370 / 370** tests passing + 1 win32-skip.
- **46** source files all ≤ 400 lines (`pnpm check:size`).
- **`pnpm lint`** (`tsc --noEmit`) clean.
- **`pnpm build`** clean.
- **`pnpm smoke`** end-to-end via subprocess `dist/server.js` — LoggingDecorator trace visible.

[1.2.0]: https://github.com/lyupro/skillforge-mcp/releases/tag/v1.2.0
[1.1.1]: https://github.com/lyupro/skillforge-mcp/releases/tag/v1.1.1
[1.1.0]: https://github.com/lyupro/skillforge-mcp/releases/tag/v1.1.0
[1.0.0]: https://github.com/lyupro/skillforge-mcp/releases/tag/v1.0.0
