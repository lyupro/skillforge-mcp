# SkillForge MCP

> Universal Skills MCP server — load Markdown skills from arbitrary folders, lazy-by-design, cross-tool.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-purple)](https://modelcontextprotocol.io)

**v1.9.0** — 5 MCP tools, one-command install across Claude Code / Codex CLI / Cursor / Hermes Agent, terminal `tools` + `folders` + `formats` + `skills` + `security` + `version-policy` subcommands, blacklist name-glob and path-glob patterns, config-driven skill format registry with directory-name derivation, code-scoped security auto-audit (`auditTarget`) with an `auditExceptions` allowlist, per-bundle `versionPolicy` (pin / freeze) with highest-semver collision resolution, leveled stderr logger with `--verbose` / `--quiet`, candidate-aware skip lines, persistent on-disk registry index for fast warm starts, batch `skills get`, config live-reload, forward-compatible config schemas, global/project install scopes, Claude Code plugin packaging, 867 tests, 10 sample skills, modular architecture (all source files ≤ 400 lines).

---

## What it is

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server that exposes Markdown-defined **skills** (prompts, templates, scripts) to any MCP-capable LLM tool — Claude Code, OpenAI Codex CLI, Cursor, Hermes Agent, or custom clients via `@modelcontextprotocol/sdk`.

One skill folder. One config file. Any tool can ask for any skill on demand.

## Why it exists

| Pain | Today | With SkillForge |
|------|-------|-----------------|
| Auto-loading 122+ skills per session burns ~4880 tokens on init | Every Claude Code session pays the toll, most skills are never used | Lazy MCP discovery — pay only for `skills__get` / `skills__invoke` calls actually made |
| Hardcoded paths (`~/.claude/plugins/cache/...`, `~/.codex/skills/`) | One folder, one tool, hardcoded | Multi-folder, per-project, priority-ordered, env override |
| No cross-tool format | Each tool ships its own skill layout | Universal frontmatter parser auto-detects Claude / Codex / persona / custom dialects |
| Skill execution = "just inline body in prompt" | No scripts, no caching, no timeouts, no composition | Strategy pattern (prompt / script / hybrid) + decorator chain (logging → timeout → cache) + composite skills with cycle detection |

## One-command install

```bash
npx @lyupro/skillforge-mcp install --all
```

Auto-detects Claude Code, Codex CLI, Cursor, and Hermes Agent on your machine and wires SkillForge into each. Supports `--dry-run`, `--uninstall`, and `--force`.

By default the installer edits each host's global config. Pass `--scope project` to wire SkillForge into a repo-local config rooted at the current directory instead — `.mcp.json` (Claude Code), `.codex/config.toml` (Codex CLI), `.cursor/mcp.json` (Cursor), `.hermes/config.yaml` (Hermes Agent):

```bash
npx @lyupro/skillforge-mcp install --all --scope project
```

Full reference: [docs/INSTALL_CLI.md](./docs/INSTALL_CLI.md).

## Quick Start

### Option 1 — Claude Code plugin (recommended)

SkillForge ships a Claude Code plugin manifest, so it installs through the native `/plugins` UI with a rich plugin card:

```bash
/plugin marketplace add lyupro/skillforge-mcp
/plugin install skillforge
```

Or install it directly:

```bash
claude plugin install skillforge@lyupro/skillforge-mcp
```

Restart your Claude Code session. The five tools (`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`) appear in the tool list.

### Option 2 — npm

```bash
claude mcp add skillforge -- npx -y @lyupro/skillforge-mcp
```

Works for any MCP host that can spawn a stdio command (Claude Code, Codex CLI, Cursor). Or let the install CLI wire every detected host at once:

```bash
npx -y @lyupro/skillforge-mcp install --all
```

### Option 3 — local build

See [Contributing](#contributing).

After install, point SkillForge at your skill folder:

```
> use skills__configure with action="add_folder", folder="/abs/path/to/your/skills"
> use skills__list
```

See [docs/INSTALL.md](./docs/INSTALL.md) for Codex CLI, Cursor, Hermes Agent, and manual MCP-client setups.

## Verify Installation

After the install step, run these three checks from inside any wired LLM tool session:

1. `skills__list` — returns an array of skill summaries (possibly empty if no skills folders are configured yet).
2. `skills__configure` with `action: "list_folders"` — shows the resolved folder list with priorities and `enabled` flags.
3. `skills__reload` — forces a fresh scan, returns `{loaded, added, removed, errors}` diff.

If any call fails with `[skillforge] fatal:` on stderr, the most likely cause is a corrupt config file or a missing folder path — the error message points at the offending file. Delete or fix `~/.lyupro/.skillforge/config.json` and retry.

## CLI commands

The `skillforge` / `skillforge-mcp` binary is a dispatcher — the first positional argument selects a subcommand. Run `skillforge --help` for the full list.

| Command | Purpose |
|---------|---------|
| `serve` | Run the stdio MCP server. Default when no command is given. |
| `install` | Wire SkillForge into Claude Code / Codex CLI / Cursor / Hermes Agent. Flags: `--claude` / `--codex` / `--cursor` / `--hermes` / `--all`, `--dry-run`, `--uninstall`, `--force`, `--entry auto\|npx\|local`, `--binary-path <path>`, `--scope global\|project`. |
| `uninstall` | Reverse a previous install. Accepts the same `--scope global\|project` flag. |
| `tools` | Print the 5 MCP tools the server exposes (name, description, parameters, example). Pass `--json` for machine-readable output. |
| `folders` | Manage skill folders from the terminal — `list` / `add` / `remove` / `alias` / `rename` / `enable` / `disable` / `reset`. |
| `formats` | Manage the skill format registry — `list` / `add` / `remove` / `enable` / `disable`. Add support for a new LLM's layout (e.g. Gemini Gem files) without a code release. |
| `skills` | Inspect the skill registry from the terminal — `list` (with `--search`, `--source`, `--folder`, `--folder-tag`, `--json`, `--folder-fmt`), `get <names>` (comma-separated for a batch fetch), `reload`, `reindex`. `--no-cache` bypasses the on-disk index. |
| `security` | Manage security knobs from the terminal — `audit-exceptions list\|add\|remove\|clear`, `audit-target [scripts\|all]`, `audit-patterns list`, `blacklist list\|add\|remove\|clear`. |
| `version-policy` | Manage per-bundle version pins from the terminal — `list`, `set <bundle> <latest\|x.y.z>`, `remove <bundle>`, `clear`. |
| `update` | Update the CLI to the latest published npm version. Flags: `--check`, `--dry-run`, `--registry <url>`, `--json`, `--min-release-age <n>`. Alias: `upgrade`. |
| `--version`, `-v` | Print the package version. |
| `--help`, `-h` | Print combined usage. |

### Inspect the MCP tools — `skillforge tools`

```bash
skillforge tools          # human-readable reference
skillforge tools --json   # machine-readable: { "tools": [ ... ] }
```

Prints every MCP tool the server exposes (`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`) with its description, parameters, and an example invocation — handy for confirming the surface without starting a session.

### Manage skill folders from the terminal — `skillforge folders`

Folder management is also available from the shell, not just via the `skills__configure` MCP tool inside an LLM session:

```bash
skillforge folders list [--json] [--tag <name>]          # print registered folders
skillforge folders add <path> [flags]                    # register a folder
skillforge folders remove <path|alias>                    # remove a folder entry
skillforge folders alias <path|alias> <name>              # set or change a folder alias
skillforge folders rename <old-alias|path> <new-alias>    # rename an existing alias
skillforge folders enable <path|alias>                    # re-activate a disabled folder
skillforge folders disable <path|alias>                   # deactivate a folder (kept in config)
skillforge folders reset --yes                            # reset folders to the default (empty) list
```

`add` flags:

- `--priority <n>` — folder priority (default `100`; higher wins on name collisions).
- `--alias <name>` — a handle to address the folder without typing its full path (used by `remove` / `enable` / `disable` / `rename`). Lowercase letters/digits in segments joined by a single `-`, `_`, or `/` (e.g. `lyupro/llm-skills`); uppercase is auto-lowercased; doubled or leading/trailing separators are rejected. Unique across folders; matched case-insensitively.
- `--tags <a,b,c>` — comma-separated tags. Filter on them via `folders list --tag <name>` or the `skills__list` `folderTag` argument.
- `--disabled` — register the folder disabled.

```bash
skillforge folders add ~/.lyupro/skills --priority 50 --alias core --tags work,review
skillforge folders disable core            # address it by alias, not by path
skillforge folders list --tag work         # only folders tagged "work"
```

`alias` is one unique handle per folder (addressing); `tags` are many shared labels (grouping and filtering) — see [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) for the full contrast.

`reset` requires `--yes` to apply — without it, the command prints what would change and makes no edits. All `folders` actions read and write the same persisted config (`~/.lyupro/.skillforge/config.json`) as the `skills__configure` MCP tool.

If you register a folder that already lives inside another tool's native skill store (a Claude Code plugin cache or a Gemini CLI extension), `folders add` prints a hint to disable the duplicate source so the same skills don't load twice. SkillForge only prints the hint — it never edits another tool's config.

### Manage security settings from the terminal — `skillforge security`

All security knobs that previously required hand-editing `config.json` or the `skills__configure` MCP tool are now available from the shell:

```bash
# Audit exceptions — skills whose example code legitimately contains flagged patterns
skillforge security audit-exceptions list [--json]
skillforge security audit-exceptions add <skill-name>
skillforge security audit-exceptions remove <skill-name>
skillforge security audit-exceptions clear --yes

# Audit target — what to scan: fenced code blocks only (default) or the whole body
skillforge security audit-target            # print current value
skillforge security audit-target scripts    # scan only executable fenced blocks (default)
skillforge security audit-target all        # scan the entire skill body

# Audit patterns — read-only view of the code-seeded regex patterns
skillforge security audit-patterns list [--json]

# Manual blacklist — exclude skills by name or glob pattern
skillforge security blacklist list [--json]           # shows KIND for each entry
skillforge security blacklist add <pattern>
skillforge security blacklist remove <pattern>
skillforge security blacklist clear --yes
```

**Blacklist pattern kinds** — entries are auto-classified by syntax:

| Kind | Syntax | Example | Matches |
|------|--------|---------|---------|
| `exact` | plain name, no wildcards or `/` | `dangerous-skill` | skill named exactly `dangerous-skill` |
| `name-glob` | contains `*` or `?`, no `/` | `wiki-*` | any skill whose name matches `wiki-*` |
| `path-glob` | contains `/` | `**/agenthub/**` | skill whose source path (relative to its folder root) matches the glob |

```bash
skillforge security blacklist add "wiki-*"              # name-glob: all wiki-* skills
skillforge security blacklist add "**/agenthub/**"      # path-glob: skills under any agenthub/ subtree
skillforge security blacklist add dangerous-skill       # exact match (unchanged behaviour)
skillforge security blacklist list                      # shows KIND column for each entry
```

`list` accepts `--json`. `add` is idempotent — adding an existing pattern is a no-op. `clear` requires `--yes`. A reindex hint is printed after any mutation. All commands accept the global `--verbose` / `--quiet` flags.

### Manage version pins from the terminal — `skillforge version-policy`

Per-bundle version policy (previously only settable via `config.json` hand-edits) is now a first-class CLI group:

```bash
skillforge version-policy list [--json]                    # show current policy map with kinds
skillforge version-policy set <bundle> 2.4.4               # pin bundle to an exact version
skillforge version-policy set <bundle> latest              # restore highest-semver resolution
skillforge version-policy remove <bundle>                  # remove a single pin (reverts to latest)
skillforge version-policy clear --yes                      # wipe the entire policy map
```

When one recursive root holds two installed versions of a bundle, the highest semver wins by default (`latest`). Pin a bundle to freeze it against newer installs:

```bash
skillforge version-policy set apple-hig 1.3.2   # always use 1.3.2, ignore newer installs
skillforge version-policy set apple-hig latest   # unpin, highest installed wins again
skillforge version-policy list                   # verify the current map
```

`list` accepts `--json`. `clear` requires `--yes`. A reindex hint is printed after any mutation.

### Update the CLI — `skillforge update`

Check for and apply a newer published version without retyping the install command:

```bash
skillforge update                    # check, then install if a newer version exists
skillforge update --check            # only report: "update available: X → Y" or "up to date"
skillforge update --dry-run          # print the install command without running it
skillforge update --json             # machine-readable: { current, latest, updateAvailable }
skillforge update --min-release-age 0 # install a just-published latest despite an npm cooldown
skillforge upgrade                   # alias of update
```

`update` reads its own package name and version from `package.json`, queries the npm registry for the latest published version, and compares the two. When a newer version exists, the default (no flags) applies it with `npm install -g <name>@latest`. `--check` (and `--json`) double as "what is the latest version on npm?" — they print it without installing.

Before running npm, `update` runs two pre-flight checks and **surfaces** problems rather than papering over them — it never escalates privileges or weakens a policy on your behalf:

- **Permissions (sudo).** If the global prefix is root-owned (common on Linux: `/usr/lib/node_modules`), the install would fail with `EACCES`. `update` detects the non-writable prefix up front, prints the exact `sudo npm install -g <name>@latest`, and exits — it **never runs `sudo` for you**. To avoid `sudo` for good, use a user-owned prefix or a version manager:

  ```bash
  npm config set prefix ~/.npm-global   # then add ~/.npm-global/bin to PATH
  # or use nvm / fnm / volta — global installs land in your home dir, no sudo
  ```

- **Cooldown (`min-release-age`).** npm ≥ 11.10.0 can enforce a supply-chain cooldown (`min-release-age=<days>` in `.npmrc` / `npm config set`) that refuses versions younger than N days. If your configured cooldown would block the latest, `update` reports it and points to the opt-in — it **never bypasses the cooldown silently**:

  ```bash
  skillforge update --min-release-age 0   # opt in: install the fresh latest now
  ```

  `--min-release-age <n>` is forwarded straight to npm. (npm rejects combining it with `--before`, so `update` does not expose `--before`.)

- **Fail-loud fallback.** If an install still fails (e.g. an `EACCES` the pre-flight could not predict), the exact command is printed with a `sudo` hint and the process exits non-zero. Nothing is retried silently.
- **`--registry <url>`** overrides the registry base (default `https://registry.npmjs.org`) for private mirrors.

## MCP tool surface

| Tool | Purpose |
|------|---------|
| `skills__list`      | Enumerate available skills (metadata only). Filters: `folder`, `search`, `source`, `folderTag`. |
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
- **Auto-audit:** `security.autoAudit: true` (default) scans skills on load against `security.auditPatterns` (default: `shell=True`, `eval(`, `exec(`, `base64.b64decode`). Matched skills are excluded and logged to stderr. `security.auditTarget` controls *what* is scanned: `scripts` (default) only fenced executable code blocks, so a skill that documents a pattern in prose is not flagged; `all` scans the whole body. `security.auditExceptions: string[]` is a case-sensitive name allowlist that skips the audit for a skill whose example code legitimately contains a flagged pattern (the manual blacklist still applies).
- **Manual blacklist:** `blacklist: string[]` excludes skills by pattern (case-sensitive). Three kinds are auto-classified by syntax: a plain name is an **exact** match; an entry with `*` or `?` but no `/` is a **name-glob** matched against the skill name (e.g. `wiki-*`, `*-draft`); any entry containing `/` is a **path-glob** matched against the skill source path relative to its registered root folder (e.g. `**/agenthub/**`, `internal/*/draft-*`). Existing plain-name entries are unchanged. Short-circuits before the audit step.
- **Version policy:** `versionPolicy: { "<bundle>": "latest" | "<major.minor.patch>" }`. When one recursive root holds two installed versions of a bundle, the highest semver wins by default (`latest`). Pin a bundle to an exact version, or pin it to its current version to freeze it against newer installs.
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

Pick the block that matches how you installed.

```bash
# Installed as a Claude Code plugin
/plugin update skillforge

# Installed via the install CLI (global npm package)
npm install -g @lyupro/skillforge-mcp@latest
# host wiring already points at the global bin — restart the host session

# Installed as a bare MCP server (npx)
claude mcp remove skillforge
claude mcp add skillforge -- npx -y @lyupro/skillforge-mcp@latest

# Local-build install (git clone)
cd skillforge-mcp
git pull
pnpm install
pnpm build
```

The wiring in Claude Code / Codex / Cursor / Hermes points at the same binary path — restarting the host session picks up the new build. Your persisted config at `~/.lyupro/.skillforge/config.json` survives the upgrade.

## Documentation

| Doc | Audience |
|-----|----------|
| [docs/INSTALL.md](./docs/INSTALL.md) | First-time setup for Claude Code, Codex CLI, Cursor, manual MCP clients |
| [docs/SKILL_FORMAT.md](./docs/SKILL_FORMAT.md) | Skill authors — full frontmatter spec, dialect detection, examples |
| [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) | Power users — folder management, blacklist, sandbox config, env overrides |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Contributors — design patterns, module responsibilities, extension points |
| [docs/SECURITY.md](./docs/SECURITY.md) | Security-conscious operators — threat model, audit checklist, sandbox limits, disclosure policy |
| [docs/INTEGRATION/](./docs/INTEGRATION/) | Per-tool wiring guides (claude-code / codex / cursor / hermes / custom-llm-tools) |
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
claude mcp add skillforge -- node /absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js serve
```

Development commands:

```bash
pnpm install
pnpm dev           # tsx watch src/cli/dispatcher.ts serve
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
