# Reddit Posts — SkillForge MCP v1.3.0 Launch

One post per subreddit. Tone tuned per audience. Each variant has its own title + body so they can be posted independently without coming across as cross-post spam.

---

## r/ClaudeAI

**Title:** SkillForge MCP — universal Markdown skills server for Claude Code (lazy-by-design, cross-tool, MIT)

**Body:**

I just shipped v1.3.0 of SkillForge MCP and wanted to share it with the Claude Code community since most early dogfooding will happen here.

**The pain I ran into:** Claude Code auto-loads every skill in `~/.claude/skills/` on every cold start. With 100+ skills, that's thousands of tokens burned on metadata before the user types a prompt. Codex CLI, Cursor, and other MCP-capable tools have their own skill formats — so team-shared bundles end up duplicated across multiple folder structures.

**What SkillForge MCP does:** One MCP server exposing five tools (`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`). Points at any folder of Markdown skills (frontmatter + body). Returns metadata only on `list`, full body on `invoke`. Universal format with four dialects auto-detected (Claude SKILL.md, Codex, persona, custom).

**Highlights:**
- Three invocation strategies: prompt (default), script (sandboxed), hybrid (script-enriched prompt).
- Composite skills via `skills: [a, b, c]` frontmatter with cycle detection.
- Multi-folder cascade with priority, blacklist filter, hot reload via chokidar.
- Honest security model: scripts double opt-in (config + frontmatter), env-whitelisted sandbox, AbortSignal kill on timeout. `docs/SECURITY.md` documents out-of-scope items too.
- 561/561 tests passing, 61 files all ≤ 400 lines.
- One-command installer wires Claude Code, Codex CLI, and Cursor in a single shot.
- `skillforge folders` CLI — manage folders from the terminal with aliases, enable/disable, and tag filters.
- Installable as a Claude Code plugin via `claude plugin install`.

**Install:**

```
npx -y @lyupro/skillforge-mcp install --all
skillforge folders add /abs/path/to/your/skills --alias core
skills__list
```

Disable Claude Code's native skill auto-load and let SkillForge serve the same folder if you want both worlds (lazy + cross-tool).

Repo: `github.com/lyupro/skillforge-mcp`
Issues / feedback most welcome — solo-built, MIT licensed.

---

## r/LocalLLaMA

**Title:** SkillForge MCP — Model Context Protocol server for Markdown skills, works with any MCP client (open source)

**Body:**

Built and released SkillForge MCP v1.3.0 — a generic MCP server that loads Markdown skills from arbitrary folders. Wanted to share here because the cross-tool angle should be interesting to anyone running local LLM tooling.

**The technical angle:** It's a stdio MCP server (Node ≥ 20, TypeScript ESM) using the official `@modelcontextprotocol/sdk`. Skills are Markdown files with YAML frontmatter. The server exposes five tools (`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`) and works with any client that speaks MCP — Claude Code, Codex CLI, Cursor (`~/.cursor/mcp.json`), or a custom client you build on `@modelcontextprotocol/sdk`.

**Architecture:**
- 9 documented design patterns inline: Registry, Strategy, Factory, Adapter, Decorator, Composite, Observer, OCP, DI.
- Lazy loading via metadata-only enumeration. Cold start independent of skill count.
- Three invocation strategies — prompt-only, sandboxed scripts, hybrid (script-enriched prompts).
- Composite walker with DFS cycle detection.
- Decorator chain: Logging → Timeout → Cache → strategy.
- Multi-folder cascade with priority, automatic conflict resolution.
- Hot reload via `chokidar` filesystem watcher, debounced batches.

**Sandbox for script skills:**
- Double opt-in (config flag + frontmatter flag).
- Env whitelist (`/usr/bin:/bin` POSIX).
- `mkdtemp` cwd per invocation.
- 1 MB stdout/stderr cap.
- AbortSignal kill on timeout.
- PatternScanner audit blocks skills with known-dangerous regex matches before they reach the registry.

**CLI surface (v1.2+):**
- `skillforge install --all` — one command wires Claude Code, Codex CLI, and Cursor in a single shot.
- `skillforge tools` — inspect the MCP tool surface from the terminal.
- `skillforge folders` — manage skill folders without an LLM session: add/remove, enable/disable, set aliases, filter by tag.
- Folder tag filter: `skills__list folderTag` or `folders list --tag` scopes results to folders carrying a given label.

**Engineering:**
- 561 / 561 tests passing + 1 win32-skip.
- 61 source files all ≤ 400 lines, enforced via pre-commit hook.
- TypeScript ESM, MIT licensed.

**Install:**

```
# One-command installer (after npm publish)
npx -y @lyupro/skillforge-mcp install --all

# Or from source
git clone https://github.com/lyupro/skillforge-mcp.git
cd skillforge-mcp && pnpm install && pnpm build
node dist/cli/dispatcher.js serve
```

Repo: `github.com/lyupro/skillforge-mcp`. Docs include INSTALL, SKILL_FORMAT, CONFIGURATION, ARCHITECTURE, SECURITY, and per-tool integration guides.

Happy to answer questions about the MCP server side, the sandbox approach, or how it fits alongside native skill loaders.

---

## r/SaaS

**Title:** Built and shipped a developer-tools MCP server v1.3.0 — open source, solo founder, AMA

**Body:**

I run a one-person studio called Lyu Pro and ship subscription mobile apps via an internal autonomous pipeline. One blocker that kept reappearing: my LLM-based agents needed shared "skills" (prompt templates + small scripts) and every LLM tool has its own format and discovery mechanism.

So I built SkillForge MCP — a single Model Context Protocol server that loads Markdown skills from arbitrary folders, lazy-by-design (no token burn on cold start), works across Claude Code / Codex CLI / Cursor / custom MCP clients.

**Stage gate decisions worth sharing:**

- v1.3.0 is fully open source (MIT). Monetisation is downstream — paid plugins / hosted skill registry come later, only if there's pull. Building reputation first beats building a paywall first.
- Solo dev, zero VC. Shipped from blank repo through v1.3.0 covering install ergonomics, terminal CLI, Claude plugin packaging, and folder management tooling.
- The marketing surface is intentionally narrow: open source first, dogfood on the internal pipeline next, paid surface only after consumer feedback shapes the metering model. CostDecorator is deferred for that reason — no half-finished metering surface ships.

**What has landed across v1.0–v1.3:**
- 5 MCP tools, 3 strategies, 3 decorators, composite skills, multi-folder cascade.
- 10 production-quality sample skills, 7 docs files including a documented threat model.
- One-command cross-tool installer (`skillforge install --all`).
- Terminal `skillforge folders` CLI with aliases, enable/disable, and tag filter.
- Claude Code plugin packaging.
- 561 / 561 tests passing.

**What I'd love feedback on (SaaS angle):**
- Is "free open source MCP server + paid hosted skill registry" a defensible v2 model, or does the open-core dynamic kill it?
- For solo founders shipping dev tools — landing page first, npm publish first, or marketplace listing first?
- Anyone running autonomous LLM-agent pipelines? Curious what your skill/prompt-template surface looks like.

Repo: `github.com/lyupro/skillforge-mcp`. AMA in comments.
