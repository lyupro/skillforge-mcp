# Twitter / X Thread — SkillForge MCP v1.3.0 Launch

Draft for `@lyupro` (or whichever Lyu Pro brand handle ships). 8 tweets, each ≤ 280 characters. Plain text — Twitter strips Markdown. Hashtag block kept short to leave room for body.

---

## Tweet 1 / 8 — Hook

> Just shipped SkillForge MCP v1.3.0.
>
> One MCP server. Markdown skills from any folder. Cross-tool: Claude Code, Codex CLI, Cursor, custom clients.
>
> Lazy-by-design — 0 tokens burned on cold start, even with 100+ skills configured.
>
> Open source, MIT. Thread 🧵

**Length:** 253 chars.

---

## Tweet 2 / 8 — Pain

> Why I built it: every LLM tool ships its own skill format and discovery mechanism. Team-shared bundles end up duplicated across `~/.claude/`, `~/.codex/`, project repos, gists.
>
> And the tools eagerly auto-load 100+ skills on every cold start. Tokens burn before you type.

**Length:** 274 chars.

---

## Tweet 3 / 8 — Solution

> SkillForge solves it with one MCP server exposing 5 tools:
>
> • skills__list — metadata only, lazy
> • skills__get — fetch full body when needed
> • skills__invoke — run a skill (prompt / script / hybrid)
> • skills__configure — manage folders + blacklist
> • skills__reload — hot rescan

**Length:** 268 chars.

---

## Tweet 4 / 8 — Format

> Universal skill format: Markdown body + YAML frontmatter. Four dialects auto-detected (Claude, Codex, persona, custom).
>
> Want to invoke a script? Drop `scripts/main.sh` next to SKILL.md and add `scripts: [main.sh]` to frontmatter. Same path for Python.

**Length:** 263 chars.

---

## Tweet 5 / 8 — Composite

> Composite skills: `skills: [a, b, c]` in frontmatter walks nested skills sequentially. DFS cycle detection. Combined output.
>
> Useful when you want one tool call to run "lint + format + summary" without orchestrating it from the host LLM side.

**Length:** 246 chars.

---

## Tweet 6 / 8 — Security

> Honest security model.
>
> Scripts opt-in twice (config + frontmatter). Sandbox: env whitelist (`/usr/bin:/bin`), mkdtemp cwd, AbortSignal kill, 1 MB stdout/stderr cap.
>
> Threat model documents what's NOT covered too (CPU/memory, network egress, prompt injection).

**Length:** 261 chars.

---

## Tweet 7 / 8 — Install

> Install in 60 seconds:
>
> npx -y @lyupro/skillforge-mcp install --all
>
> Wires Claude Code, Codex CLI, and Cursor (~/.cursor/mcp.json) in one shot. Then add a folder:
>
> skillforge folders add ~/skills --alias core
> skills__list

**Length:** 221 chars.

---

## Tweet 8 / 8 — CTA

> v1.3.0: 561/561 tests, 10 sample skills, 7 docs. v1.1: one-command install --all. v1.2: terminal folders CLI + Claude plugin. v1.3: folder aliases, enable/disable, tag filter.
>
> 🔗 github.com/lyupro/skillforge-mcp
> 📦 @lyupro/skillforge-mcp
>
> Built solo by Lyu Pro. Issues open.

**Length:** 273 chars.

---

## Hashtags (append to final tweet OR as standalone reply)

`#MCP #ClaudeCode #LLMTools #DeveloperTools #OpenSource`

---

## Reply-ready Q&A

Pre-canned answers for common replies. Drop into thread as one-off replies when asked.

**Q: How does this compare to native Claude Code skill auto-load?**
A: Native auto-loads everything in ~/.claude/skills/ on cold start (eager). SkillForge stays lazy — metadata-only via skills__list, body on skills__invoke. Disable native auto-load when SkillForge serves the same folder to avoid double-work.

**Q: Does it work without Anthropic CLI?**
A: Yes — it's a generic MCP server. Works with Codex CLI, Cursor (~/.cursor/mcp.json mcpServers block), and any custom client built on @modelcontextprotocol/sdk.

**Q: Scripts seem scary — what stops malicious skills?**
A: Three layers: (1) config.security.allowScripts is false by default; (2) frontmatter must opt in too (`allowScripts: true`); (3) PatternScanner audits skill content against a configurable regex list before loading. See docs/SECURITY.md.

**Q: Can I share skills across a team?**
A: Yes — point SkillForge at a shared folder (Dropbox / Git submodule / SMB / network drive). Multi-folder cascade with priority handles conflicts. Use `--alias` to give each folder a short name.

**Q: What's in v1.3?**
A: Folder aliases (address a folder by short name in all CLI commands), enable/disable toggle (no need to remove + re-add), and a tag filter — `skills__list folderTag` or `folders list --tag` to scope skills to a labelled group.

**Q: Roadmap?**
A: Production dogfood on an internal autonomous pipeline. Cross-tool verification matrix. Future: CostDecorator once consumer feedback shapes the metering surface. PRs welcome.
