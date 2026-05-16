# SkillForge MCP — Release Notes

**License:** MIT
**Maintainer:** [Lyu Pro](https://lyupro.com)

Per-release notes, newest first. For the terse machine-style changelog see [CHANGELOG.md](./CHANGELOG.md).

---

## v1.3.0 — Folder ergonomics

**Release date:** 2026-05-16

Folders became easier to address, toggle, and group.

- **Folder alias.** A folder can now carry a short kebab-case `alias`. Register it with `skillforge folders add <path> --alias <name>`, then `folders remove`, `folders enable`, `folders disable`, and the new `folders alias` command all accept the alias in place of the full absolute path. The full path keeps working everywhere — the alias is an additional shorthand, not a replacement. Aliases are unique across registered folders; a collision fails cleanly and leaves the config untouched. `folders list` shows an `ALIAS` column, and the `skills__configure` `add_folder` tool accepts an `alias` field.
- **Enable / disable toggle.** `skillforge folders enable <path|alias>` and `skillforge folders disable <path|alias>` flip a folder's `enabled` flag both ways. Previously `folders add --disabled` had no inverse and re-activating a folder meant hand-editing the config file. A disabled folder stays registered but is skipped on scan.
- **Folder-tag filter.** Folder `tags` used to be metadata that nothing read. `skills__list` now accepts a `folderTag` argument that keeps only skills under folders carrying that tag, and `skillforge folders list --tag <name>` filters the listing the same way. The documentation now draws the line clearly: `alias` is one unique handle per folder for addressing, `tags` are many shared labels for grouping.

**Engineering snapshot**

- 561 / 561 tests passing + 1 win32-skip.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean.
- All source files ≤ 400 lines — the folders CLI was split into four focused modules to hold the gate.

## v1.2.0 — Terminal tooling

**Release date:** 2026-05-16

Inspect and manage SkillForge from the shell, without opening an LLM session.

- **`skillforge tools`** — prints the five MCP tools the server exposes, each with its description, parameters, and an example invocation. `--json` for machine-readable output. Confirm the tool surface without starting a session.
- **`skillforge folders`** — manage skill folders from the terminal: `list`, `add`, `remove`, `reset`. Folder management was previously reachable only through the `skills__configure` MCP tool; both surfaces now read and write the same persisted config.
- **`--scope global|project`** on `install` / `uninstall`. The default `global` scope edits each host's home-directory config; `--scope project` wires SkillForge into a repo-local config rooted at the current directory.
- **Skill-source conflict detection.** Registering a folder that already lives inside another tool's native skill store surfaces a hint to disable the duplicate source — otherwise the same skills load twice. The hint is informational; it never blocks the add, and SkillForge never edits another tool's config.
- **Claude Code plugin packaging** — `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. SkillForge can be installed via `claude plugin install` with a rich `/plugins` UI card.

**Engineering snapshot**

- 535 / 535 tests passing + 1 win32-skip.
- `pnpm lint` / `pnpm build` clean, all source files ≤ 400 lines.

## v1.1.1 — Single-bin dispatcher

**Release date:** 2026-05-15

A fix for `npx @lyupro/skillforge-mcp install` hanging on stdin.

- The package shipped two bins (`skillforge-mcp` → server, `skillforge` → install CLI). `npx` matched the package's unscoped basename to the server bin, which silently waited on stdio. Both bins now resolve to a unified dispatcher that routes by the first positional argument.
- New `serve` subcommand for explicit MCP-server invocation (still the default when no command is given), and `skillforge-mcp --version`.
- Installer-generated host configs now write the `serve` argument explicitly; older entries still resolve to `serve` by default.

## v1.1.0 — One-command install

**Release date:** 2026-05-14

Wiring SkillForge into a host tool went from copy-pasting config snippets to a single command.

- **`skillforge install`** edits each host's config file directly — Claude Code (`~/.claude.json`), Codex CLI (`~/.codex/config.toml`), Cursor (OS-specific `settings.json`).
- Flags — `--claude`, `--codex`, `--cursor`, `--all`, `--dry-run`, `--uninstall`, `--force`, `--entry npx|local`, `--binary-path <path>`.
- Atomic-write helper with a `.backup` snapshot — a failed write never leaves the host config broken.
- OS-specific path detection for Cursor (Windows `%APPDATA%`, macOS `Library/Application Support`, Linux `~/.config`).

**Engineering snapshot**

- 451 / 451 tests passing + 1 win32-skip.
- `pnpm lint` / `pnpm build` clean, all source files ≤ 400 lines.

## v1.0.0 — Universal Skills, One Server

**Release date:** 2026-05-13

First public release. A Model Context Protocol server that loads Markdown skills from arbitrary folders and exposes them to **any MCP-capable LLM tool** — Claude Code, Codex CLI, Cursor, or your own MCP client. Skills load lazily on demand, so cold start stays fast even with hundreds of skills configured.

### Why it exists

Every LLM tool ships its own skill format and discovery mechanism. Team-shared skill bundles get duplicated across `~/.claude/`, `~/.codex/`, project repos, and a thousand pastebin gists. Tools auto-load 100+ skills on every cold start, burning tokens on metadata the model never uses.

| Pain | SkillForge fix |
|------|----------------|
| Tool-specific skill formats | Single Markdown + YAML frontmatter contract, four dialects auto-detected (Claude / Codex / persona / custom). |
| Eager auto-load on cold start | Metadata-only enumeration via `skills__list`; full body fetched on `skills__invoke`. |
| No team-shared skill registry | Multi-folder cascade with priority, blacklist filter, hot reload via filesystem watcher. |
| Script skills are a security hole | PatternScanner audit + sandbox (env whitelist, mkdtemp cwd, AbortSignal kill) + double opt-in. |

### What shipped in 1.0.0

- **5 MCP tools:** `skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`.
- **3 invocation strategies:** Prompt (default), Script (sandboxed), Hybrid (script-enriched prompt).
- **3 decorators:** Logging, Timeout, Cache (opt-in).
- **Composite skills:** `skills: [a, b, c]` walks nested skills sequentially with DFS cycle detection.
- **10 sample skills** across all three strategies.
- **5 worked configs** ready to paste — default, team-shared, priority cascade, scripts-enabled, multi-folder cascade.
- **Documentation:** README + INSTALL + SKILL_FORMAT + CONFIGURATION + ARCHITECTURE + SECURITY + 4 INTEGRATION guides.

### Engineering snapshot

- 370 / 370 tests passing + 1 win32-skip.
- 46 source files all ≤ 400 lines (modular architecture enforced via pre-commit hook).
- TypeScript ESM, Node ≥ 20.
- 9 design patterns documented inline (Registry / Strategy / Factory / Adapter / Decorator / Composite / Observer / OCP / DI).
- Honest security model — out-of-scope items called out explicitly (network egress, fs writes outside cwd, CPU/memory, prompt injection).

---

## Links

- Repository: <https://github.com/lyupro/skillforge-mcp>
- Marketplace: <https://github.com/lyupro/llm-plugins-marketplace>
- Issues: <https://github.com/lyupro/skillforge-mcp/issues>
- Security advisories: <https://github.com/lyupro/skillforge-mcp/security/advisories>
- Maintainer: <https://lyupro.com>
