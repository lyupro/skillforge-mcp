# LinkedIn Post — SkillForge MCP v1.0.0 Launch

Professional-flavoured launch post. ~1400 characters. Lead with the problem, end with a call to feedback rather than a hard sell. LinkedIn rewards thoughtful long-form over hype.

---

**Shipped: SkillForge MCP v1.0.0 — a universal Markdown-skills server for any MCP-capable LLM tool.**

Every developer using an LLM coding assistant runs into the same pain at scale: each tool ships its own skill format. Claude Code has SKILL.md. Codex has its own TOML-flavoured shape. Cursor adds a third manifest style. Team-shared skill bundles end up duplicated across `~/.claude/`, `~/.codex/`, project repos, and pastebin gists.

And the tools eagerly auto-load every configured skill on cold start. With 100+ skills installed, that is thousands of tokens burned before the user even types a prompt.

SkillForge MCP solves both pains with one Model Context Protocol server:

— Universal Markdown + YAML frontmatter format. Four dialects auto-detected (Claude / Codex / persona / custom).
— Lazy-by-design loading. `skills__list` returns metadata only. Full body fetched on `skills__invoke`. Cold start stays fast at any skill count.
— Multi-folder cascade with priority, blacklist filter, hot reload via filesystem watcher.
— Three invocation strategies — prompt-only, sandboxed scripts, hybrid (script-enriched prompts).
— Composite skills: `skills: [a, b, c]` walks nested skills sequentially with cycle detection.
— Honest security model: scripts opt-in twice (config + frontmatter), env-whitelisted sandbox, AbortSignal-based kill on timeout. Threat model documents what is NOT covered too.

Engineering snapshot: 370 tests passing, 46 source files all ≤ 400 lines, TypeScript ESM on Node ≥ 20, MIT licensed.

What ships in 1.0.0: five MCP tools, three strategies, three decorators (logging / timeout / cache), 10 production-quality sample skills, 5 worked configs, seven docs files (INSTALL / SKILL_FORMAT / CONFIGURATION / ARCHITECTURE / SECURITY / four INTEGRATION guides).

Install (after npm publish):
`claude mcp add skillforge -- npx -y @lyupro/skillforge-mcp`

Open source, repo on GitHub: github.com/lyupro/skillforge-mcp
Maintainer: Lyu Pro — built solo, alongside an internal autonomous mobile-app pipeline that will be the first dogfood consumer.

Feedback, issues, and PRs welcome. If you maintain a multi-LLM-tool dev workflow and want to consolidate skill bundles, I would love to hear what worked or did not.

#ModelContextProtocol #ClaudeCode #LLMTools #DeveloperTools #OpenSource
