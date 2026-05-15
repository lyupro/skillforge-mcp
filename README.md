# SkillForge MCP

> Universal Skills MCP server — load Markdown skills from arbitrary folders, lazy-by-design, cross-tool.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-purple)](https://modelcontextprotocol.io)

**v1.1.1** — 5 MCP tools, one-command install across Claude Code / Codex CLI / Cursor, 462 tests, 10 sample skills, modular architecture (all source files ≤ 400 lines).

---

## What it is

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server that exposes Markdown-defined **skills** (prompts, templates, scripts) to any MCP-capable LLM tool — Claude Code, OpenAI Codex CLI, Cursor, or custom clients via `@modelcontextprotocol/sdk`.

One skill folder. One config file. Any tool can ask for any skill on demand.

## Why it exists

| Pain | Today | With SkillForge |
|------|-------|-----------------|
| Auto-loading 122+ skills per session burns ~4880 tokens on init | Every Claude Code session pays the toll, most skills are never used | Lazy MCP discovery — pay only for `skills__get` / `skills__invoke` calls actually made |
| Hardcoded paths (`~/.claude/plugins/cache/...`, `~/.codex/skills/`) | One folder, one tool, hardcoded | Multi-folder, per-project, priority-ordered, env override |
| No cross-tool format | Each tool ships its own skill layout | Universal frontmatter parser auto-detects Claude / Codex / persona / custom dialects |
| Skill execution = "just inline body in prompt" | No scripts, no caching, no timeouts, no composition | Strategy pattern (prompt / script / hybrid) + decorator chain (logging → timeout → cache) + composite skills with cycle detection |

## One-command install (v1.1)

```bash
npx @lyupro/skillforge-mcp install --all
```

Auto-detects Claude Code, Codex CLI, and Cursor on your machine and wires SkillForge into each. Supports `--dry-run`, `--uninstall`, and `--force`. Full reference: [docs/INSTALL_CLI.md](./docs/INSTALL_CLI.md).

## Quick Start

### Option 1 — Claude Code marketplace (recommended)

```bash
/plugin marketplace add lyupro/llm-plugins-marketplace
/plugin install skillforge-mcp@lyupro-llm-plugins
```

Restart your Claude Code session. The five tools (`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`) appear in the tool list.

### Option 2 — npm

```bash
claude mcp add skillforge -- npx -y @lyupro/skillforge-mcp
```

Works for any MCP host that can spawn a stdio command (Claude Code, Codex CLI, Cursor).

### Option 3 — local build

See [Contributing](#contributing).

After install, point SkillForge at your skill folder:

```
> use skills__configure with action="add_folder", folder="/abs/path/to/your/skills"
> use skills__list
```

See [docs/INSTALL.md](./docs/INSTALL.md) for Codex CLI, Cursor, and manual MCP-client setups.

## Verify Installation

After the install step, run these three checks from inside any wired LLM tool session:

1. `skills__list` — returns an array of skill summaries (possibly empty if no skills folders are configured yet).
2. `skills__configure` with `action: "list_folders"` — shows the resolved folder list with priorities and `enabled` flags.
3. `skills__reload` — forces a fresh scan, returns `{loaded, added, removed, errors}` diff.

If any call fails with `[skillforge] fatal:` on stderr, the most likely cause is a corrupt config file or a missing folder path — the error message points at the offending file. Delete or fix `~/.lyupro/.skillforge/config.json` and retry.

## MCP tool surface

| Tool | Purpose |
|------|---------|
| `skills__list`      | Enumerate available skills (metadata only). Filters: `folder`, `search`, `source`. |
| `skills__get`       | Fetch full SKILL.md body + metadata for one skill. |
| `skills__invoke`    | Execute a skill via its assigned strategy, wrapped in the decorator chain (Logging → Timeout → Cache). Composite skills (`metadata.skills: [a, b]`) walk nested skills sequentially with DFS cycle detection. |
| `skills__configure` | Manage configured folders + manual blacklist. Actions: `add_folder`, `remove_folder`, `list_folders`, `set_blacklist`, `get_blacklist`, `reset`. Persists to the config file and reconciles in-process state without restart. |
| `skills__reload`    | Force a full rescan of all configured folders. Returns `{ loaded, added, removed, errors }` diff vs. the previous registry snapshot. |

## Configure which folders to scan

By default SkillForge scans `~/.claude/plugins/cache/claude-code-skills/`. Override via environment:

```bash
# Windows (PowerShell)
$env:SKILLFORGE_FOLDERS = "C:\path\to\skills;C:\other\folder"

# macOS / Linux
export SKILLFORGE_FOLDERS=/home/me/skills:/home/me/team-skills
```

Path separator is platform-native (`;` on Windows, `:` elsewhere). Or use `skills__configure` to manage the persisted list — see [docs/CONFIGURATION.md](./docs/CONFIGURATION.md).

For shared content across multiple tools, the convention is `~/.lyupro/skills/` (Lyu Pro brand shared content folder).

## Persisted config + hot reload

- **Config file:** `~/.lyupro/.skillforge/config.json` (resolved cross-platform via `os.homedir()`). Schema-validated via Zod; missing → schema defaults; corrupt JSON / schema → loud error with the file path.
- **Merge order for folders:** `SKILLFORGE_FOLDERS` env (when set) > persisted `folders[]` with `enabled: true` sorted by `priority` desc > built-in default.
- **Auto-audit:** `security.autoAudit: true` (default) scans skill bodies on load against `security.auditPatterns` (default: `shell=True`, `eval(`, `exec(`, `base64.b64decode`). Matched skills are excluded and logged to stderr.
- **Manual blacklist:** `blacklist: string[]` excludes skills by exact name (case-sensitive). Short-circuits before the audit step.
- **Hot reload:** chokidar watches all configured folders for `.md` add/change/unlink events. Debounced batches invalidate the metadata cache so the next `skills__list` re-scans. Folders mutated via `skills__configure` auto-re-watch via the same diff path.

## Skill format

Any `.md` file with a YAML frontmatter block defining at least `name:`:

```markdown
---
name: apple-hig-check
description: Audit code against Apple Human Interface Guidelines.
tags: [ios, design]
---

You are an Apple HIG expert. When asked to review code...
```

Optional camelCase fields validated by `SkillMetadata`: `strategy` (`prompt` / `script` / `hybrid`), `allowScripts`, `allowNetwork`, `skills` (composite — string[] of nested skill names invoked sequentially), `timeoutMs`, `cacheable`, `cacheTtlMs`, `scripts` (string[], single-entry — `main.py` / `entry.sh` / `app.mjs`). Anything else passes through to `extra`.

`FormatDetector` recognizes Claude (`SKILL.md`), Codex (`AGENTS.md`), persona-style (frontmatter has `persona:`), and generic-custom dialects automatically.

Full spec: [docs/SKILL_FORMAT.md](./docs/SKILL_FORMAT.md).

## Architecture (one-liner)

`MCP request → Tool handler → Registry lookup → DecoratorChain.wrap(strategy).invoke(skill, ctx) → Logging → Timeout → Cache → Strategy (Prompt / Script / Hybrid / Composite-resolver) → InvocationResult`

Patterns used: Registry, Strategy, Factory, Adapter, Decorator (chain composition), Composite (sequential nested invocation), Observer (chokidar), Singleton.

Full design: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Limitations

Read this before enabling scripts.

`ScriptStrategy` runs user-provided scripts in a `SandboxRunner` subprocess. **The sandbox is best-effort env/cwd isolation, not an OS-grade jail.** Node `child_process` cannot guarantee network isolation, filesystem confinement outside `cwd`, or CPU/memory limits — those require Docker/firecracker/gVisor (future enhancement).

| Property | Enforced? | How |
|----------|-----------|-----|
| `env` whitelist | Yes | Subprocess receives only `PATH` (+ explicit `opts.env` like `SKILLFORGE_INPUT`). No `HOME`/`USER`/`SSH_AUTH_SOCK`/`~/.ssh`/`~/.aws` propagation. |
| Temp `cwd` | Yes | Fresh `fs.mkdtemp(os.tmpdir()/skillforge-XXXX)`, recursive cleanup in `finally`. |
| Abort signal | Yes | `signal.abort()` → SIGTERM → 5s grace → SIGKILL. |
| stdout/stderr cap | Yes | Tail-truncate at 1 MB each. |
| Network egress | No | Subprocess inherits host network stack. `metadata.allowNetwork` is a documentation signal, not a runtime constraint. |
| Filesystem reads outside `cwd` | No | Subprocess has full OS user permissions. |
| Filesystem writes outside `cwd` | No | Same. |
| CPU / memory limits | No | Only the timeout decorator wall-clock-kills runaways. |

**Defence in depth** layered on top:

1. **Global gate** — `config.security.allowScripts: false` by default.
2. **Per-skill opt-in** — `metadata.allowScripts: true` required per skill.
3. **Audit pattern scanner** — `PatternScanner` detects `shell=True`, `eval(`, `exec(`, base64 decode patterns in skill bodies before load.
4. **Manual blacklist** — explicit skill names in `config.security.blacklist`.

For production use with untrusted skill authors, run SkillForge inside Docker or another OS-level sandbox. Full threat model: [docs/SECURITY.md](./docs/SECURITY.md).

## Updating

```bash
# Marketplace install
/plugin update skillforge-mcp@lyupro-llm-plugins

# npm install
claude mcp remove skillforge
claude mcp add skillforge -- npx -y @lyupro/skillforge-mcp@latest

# Local-build install
cd skillforge-mcp
git pull
pnpm install
pnpm build
```

The wiring in Claude Code / Codex / Cursor points at the same binary path — restarting the host session picks up the new build. Your persisted config at `~/.lyupro/.skillforge/config.json` survives the upgrade.

## Documentation

| Doc | Audience |
|-----|----------|
| [docs/INSTALL.md](./docs/INSTALL.md) | First-time setup for Claude Code, Codex CLI, Cursor, manual MCP clients |
| [docs/SKILL_FORMAT.md](./docs/SKILL_FORMAT.md) | Skill authors — full frontmatter spec, dialect detection, examples |
| [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) | Power users — folder management, blacklist, sandbox config, env overrides |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Contributors — design patterns, module responsibilities, extension points |
| [docs/SECURITY.md](./docs/SECURITY.md) | Security-conscious operators — threat model, audit checklist, sandbox limits, disclosure policy |
| [docs/INTEGRATION/](./docs/INTEGRATION/) | Per-tool wiring guides (claude-code / codex / cursor / custom-llm-tools) |
| [skills/](./skills/) | 10 ready-to-use sample skills (prompt / script / hybrid examples) |
| [examples/configs/](./examples/configs/) | Sample `config.json` files for common setups |

## Contributing

Local build (for development or pre-publish testing):

```bash
git clone https://github.com/lyupro/skillforge-mcp.git
cd skillforge-mcp
pnpm install
pnpm build

# Wire into Claude Code using the absolute path
claude mcp add skillforge -- node /absolute/path/to/skillforge-mcp/dist/server.js
```

Development commands:

```bash
pnpm install
pnpm dev           # tsx watch src/server.ts
pnpm test          # vitest run
pnpm test:coverage # coverage report
pnpm lint          # tsc --noEmit
pnpm check:size    # file-size gate (≤400 lines per file)
pnpm build         # emit dist/
pnpm smoke         # post-build subprocess smoke test
```

## License

MIT — see [LICENSE](./LICENSE).

## Author

[lyupro](https://lyupro.com) — independent dev. Part of the Lyu Pro tooling portfolio.
