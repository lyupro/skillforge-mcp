# LinkedIn Post — SkillForge MCP v1.3.0 Launch

Professional-flavoured launch post. ~1500 characters. Lead with the problem, end with a call to feedback rather than a hard sell. LinkedIn rewards thoughtful long-form over hype.

---

**Shipped: SkillForge MCP v1.3.0 — a universal Markdown-skills server for any MCP-capable LLM tool.**

Every developer using an LLM coding assistant runs into the same pain at scale: each tool ships its own skill format. Claude Code has SKILL.md. Codex has its own TOML-flavoured shape. Cursor adds a third manifest style. Team-shared skill bundles end up duplicated across `~/.claude/`, `~/.codex/`, project repos, and pastebin gists.

And the tools eagerly auto-load every configured skill on cold start. With 100+ skills installed, that is thousands of tokens burned before the user even types a prompt.

SkillForge MCP solves both pains with one Model Context Protocol server:

— Universal Markdown + YAML frontmatter format. Four dialects auto-detected (Claude / Codex / persona / custom).
— Lazy-by-design loading. `skills__list` returns metadata only. Full body fetched on `skills__invoke`. Cold start stays fast at any skill count.
— Multi-folder cascade with priority, blacklist filter, hot reload via filesystem watcher.
— Three invocation strategies — prompt-only, sandboxed scripts, hybrid (script-enriched prompts).
— Composite skills: `skills: [a, b, c]` walks nested skills sequentially with cycle detection.
— Honest security model: scripts opt-in twice (config + frontmatter), env-whitelisted sandbox, AbortSignal-based kill on timeout. Threat model documents what is NOT covered too.

What has landed across v1.1–v1.3:

— One-command cross-tool installer: `npx -y @lyupro/skillforge-mcp install --all` wires Claude Code, Codex CLI, and Cursor (`~/.cursor/mcp.json`) in a single shot.
— Terminal `skillforge folders` CLI — manage skill folders from the shell without opening an LLM session: add, remove, enable/disable, set aliases, filter by tag.
— Claude Code plugin packaging — installable via `claude plugin install` or the `/plugins` UI.
— Folder ergonomics: short kebab-case aliases (`--alias work`), an enable/disable toggle, and a tag filter (`skills__list folderTag`, `folders list --tag`) for grouping folders by category.

Engineering snapshot: 561 tests passing, 61 source files all ≤ 400 lines, TypeScript ESM on Node ≥ 20, MIT licensed.

Install (after npm publish):
`npx -y @lyupro/skillforge-mcp install --all`

Then register a folder from the terminal:
`skillforge folders add /abs/path/to/skills --alias core`

Open source, repo on GitHub: github.com/lyupro/skillforge-mcp
Maintainer: Lyu Pro — built solo, alongside an internal autonomous mobile-app pipeline that is the first dogfood consumer.

Feedback, issues, and PRs welcome. If you maintain a multi-LLM-tool dev workflow and want to consolidate skill bundles, I would love to hear what worked or did not.

#ModelContextProtocol #ClaudeCode #LLMTools #DeveloperTools #OpenSource
