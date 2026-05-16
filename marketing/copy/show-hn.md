# Show HN — SkillForge MCP v1.3.0

Submission format: title (≤ 80 chars) + URL + first comment body. Hacker News rewards understatement and technical specificity; this draft strips hype language and leads with concrete artifacts.

---

## Title

`Show HN: SkillForge MCP – universal Markdown skills server for any LLM tool`

**Length:** 73 chars (HN allows 80).

## URL

`https://github.com/lyupro/skillforge-mcp`

## First comment (post immediately after submission)

Hi HN — author here.

SkillForge MCP is a Model Context Protocol stdio server that loads Markdown skills from arbitrary folders and exposes them to any MCP-capable client (Claude Code, Codex CLI, Cursor, or a custom client built on `@modelcontextprotocol/sdk`). I built it because every LLM tool currently ships its own skill format and eagerly auto-loads every skill on cold start, burning tokens on metadata the model never uses.

Design points worth calling out:

— **Lazy-by-design.** `skills__list` returns metadata only. Full body fetched on `skills__invoke`. Cold start cost is independent of how many skills are configured.

— **Universal format.** Markdown body + YAML frontmatter. Four dialects auto-detected (Claude SKILL.md, Codex, persona, custom). A skill written for one tool runs on all of them.

— **Three invocation strategies.** Prompt-only (default), sandboxed scripts (`scripts/main.sh` next to the skill file, double opt-in), hybrid (script produces a context block prepended to the prompt body). Composite skills via `skills: [a, b, c]` frontmatter with DFS cycle detection.

— **Decorator chain.** Logging → Timeout → Cache → strategy. Cache is opt-in per skill via `metadata.cacheable: true`.

— **Honest security model.** Scripts opt-in twice (`config.security.allowScripts` plus frontmatter `allowScripts`). Sandbox is env whitelist (`/usr/bin:/bin`), `mkdtemp` cwd per invocation, 1 MB stdout/stderr cap, AbortSignal kill on timeout. `docs/SECURITY.md` lists what is NOT covered — network egress, fs writes outside cwd, CPU / memory limits, prompt injection. Threat model is explicit so users can decide whether the boundary fits their use case.

— **Terminal CLI.** `skillforge install --all` wires Claude Code, Codex CLI, and Cursor (`~/.cursor/mcp.json`) in one command. `skillforge folders` manages skill folders without an LLM session: add/remove, enable/disable toggle, kebab-case aliases, and a tag filter (`folders list --tag <name>` / `skills__list folderTag`) for grouping folders by category. `skillforge tools` inspects the MCP tool surface from the shell.

— **Claude Code plugin packaging.** Installable via `claude plugin install` or the `/plugins` UI in addition to the standard `claude mcp add` path.

— **Modular architecture.** 61 source files, all ≤ 400 lines (enforced via pre-commit hook). 9 design patterns documented inline (Registry / Strategy / Factory / Adapter / Decorator / Composite / Observer / OCP / DI). 561 / 561 tests passing.

— **Stack.** TypeScript ESM on Node ≥ 20. Single dependency for the MCP surface (`@modelcontextprotocol/sdk`), `chokidar` for file watching, `gray-matter` for frontmatter, `zod` for config schema validation. MIT licensed.

The repository ships with seven documentation files (INSTALL, SKILL_FORMAT, CONFIGURATION, ARCHITECTURE, SECURITY, plus four per-tool INTEGRATION guides), 10 production-quality sample skills covering all three strategies, and five worked config examples.

This is a solo project; v1.3.0 is the current release. Roadmap from here:

1. Production dogfood — my internal autonomous mobile-app pipeline becomes the first real consumer.
2. Cross-tool verification matrix.
3. CostDecorator — deferred until consumer feedback shapes the metering surface.

I would especially appreciate feedback on:

- The sandbox boundary (`docs/SECURITY.md`) — is the threat model honest enough, or is there an in-scope item I am still missing?
- The frontmatter format (`docs/SKILL_FORMAT.md`) — does the four-dialect auto-detection cover what you would actually paste into the folder?
- The composite walker (`src/composite/`) — DFS cycle detection feels reasonable but I am open to better approaches.
- The folder tag filter (`folderTag` / `--tag`) — useful for per-phase skill scoping or does something simpler serve better?

Repository: `https://github.com/lyupro/skillforge-mcp`
npm (after publish): `@lyupro/skillforge-mcp`
Marketplace: `https://github.com/lyupro/llm-plugins-marketplace`

Happy to answer anything in the thread.
