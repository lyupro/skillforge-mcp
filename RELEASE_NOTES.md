# SkillForge MCP v1.0.0 — Universal Skills, One Server

**Release date:** 2026-05-13
**License:** MIT
**Maintainer:** [Lyu Pro](https://lyupro.com)

## What is SkillForge MCP?

A Model Context Protocol server that loads Markdown skills from arbitrary folders and exposes them to **any MCP-capable LLM tool** — Claude Code, Codex CLI, Cursor, or your own MCP client. Skills are loaded lazily on demand, so cold start stays fast even when you have hundreds of skills configured.

## Why does this exist?

Every LLM tool ships its own "skill" format and discovery mechanism. Team-shared skill bundles get duplicated across `~/.claude/`, `~/.codex/`, project repos, and a thousand pastebin gists. Tools auto-load 100+ skills on every cold start, burning tokens on metadata the model never uses.

SkillForge solves three pains in one package:

| Pain | SkillForge fix |
|------|----------------|
| Tool-specific skill formats | Single Markdown + YAML frontmatter contract, four dialects auto-detected (Claude / Codex / persona / custom). |
| Eager auto-load on cold start | Metadata-only enumeration via `skills__list`; full body fetched on `skills__invoke`. |
| No team-shared skill registry | Multi-folder cascade with priority, blacklist filter, hot reload via filesystem watcher. |
| Script skills are a security hole | PatternScanner audit + sandbox (env whitelist, mkdtemp cwd, AbortSignal kill) + double opt-in. |

## What ships in 1.0.0?

- **5 MCP tools:** `skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`.
- **3 invocation strategies:** Prompt (default), Script (sandboxed), Hybrid (script-enriched prompt).
- **3 decorators:** Logging, Timeout, Cache (opt-in).
- **Composite skills:** `skills: [a, b, c]` walks nested skills sequentially with DFS cycle detection.
- **10 sample skills** across all three strategies — `apple-hig-check`, `commit-message-writer`, `prompt-optimizer`, `markdown-linter`, `dependency-checker`, `changelog-generator`, and 4 more.
- **5 worked configs** ready to paste — default, team-shared, priority cascade, scripts-enabled, multi-folder cascade.
- **Documentation:** README + INSTALL + SKILL_FORMAT + CONFIGURATION + ARCHITECTURE + SECURITY + 4 INTEGRATION guides.

## Install in 60 seconds

```bash
# Option 1 — npm (after publication)
claude mcp add skillforge -- npx -y @lyupro/skillforge-mcp

# Option 2 — local build (works today)
git clone https://github.com/lyupro/skillforge-mcp.git
cd skillforge-mcp
pnpm install && pnpm build
claude mcp add skillforge -- node ./dist/server.js
```

Then point it at your skills folder:

```bash
# Inside a Claude Code session
skills__configure { action: "add_folder", folder: "/abs/path/to/your/skills" }
skills__list   # → enumerated skills
```

## Engineering snapshot

- 370 / 370 tests passing + 1 win32-skip
- 46 source files all ≤ 400 lines (modular architecture enforced via pre-commit hook)
- TypeScript ESM, Node ≥ 20
- 9 design patterns documented inline (Registry / Strategy / Factory / Adapter / Decorator / Composite / Observer / OCP / DI)
- Honest security model — out-of-scope items called out explicitly (network egress, fs writes outside cwd, CPU/memory, prompt injection)

## Cross-tool support

- **Claude Code** (primary) — install via `claude mcp add`. Disable native skill auto-load to avoid duplicate work.
- **Codex CLI** — `codex mcp add skillforge -- node /path/to/dist/server.js`. TOML config in `~/.codex/config.toml`.
- **Cursor** — `settings.json` MCP block (verify status: pending).
- **Custom MCP client** — `StdioClientTransport` reference client + per-tool argument cookbook in `docs/INTEGRATION/custom-llm-tools.md`.

## What's next (post-1.0)

- Marketplace publication (`lyupro/llm-plugins-marketplace`), npm publish, landing page on `lyupro.com/skillforge-mcp`.
- Internal pipeline integration (dogfood track).
- Cross-tool verification matrix.
- CostDecorator (deferred) — re-evaluate once consumer feedback shapes the metering surface.

## Acknowledgements

SkillForge MCP becomes the first publicly published Lyu Pro plugin and the first real consumer of its own skill registry (dogfood track).

## Links

- Repository: <https://github.com/lyupro/skillforge-mcp>
- Marketplace: <https://github.com/lyupro/llm-plugins-marketplace>
- Issues: <https://github.com/lyupro/skillforge-mcp/issues>
- Security advisories: <https://github.com/lyupro/skillforge-mcp/security/advisories>
- Maintainer: <https://lyupro.com>
