# Install CLI

One-command wiring of SkillForge MCP into Claude Code, Codex CLI, Cursor, and Hermes Agent. Shipped in **v1.1**. For managing the skill registry from the terminal (list, get, reload), see the `skillforge skills` subcommand — available since **v1.4**. For managing the skill **format registry** from the terminal — adding support for new LLM layouts without a code release — see [`skillforge formats`](#skillforge-formats-subcommand).

## Overview

The `skillforge install` command edits each host tool's config file directly so you do not have to copy-paste JSON or TOML snippets. It supports JSON (Claude Code, Cursor) and TOML (Codex CLI), writes atomically through `<path>.tmp` + `fs.rename`, and snapshots the previous content into `<path>.backup` on every overwrite so a bad write never leaves you with a broken config.

## Usage

```bash
npx @lyupro/skillforge-mcp install [flags]
```

| Flag | Purpose |
|------|---------|
| `--claude` | Edit `~/.claude.json` |
| `--codex` | Edit `~/.codex/config.toml` |
| `--cursor` | Edit `~/.cursor/mcp.json` |
| `--hermes` | Edit `~/.hermes/config.yaml` (or `$HERMES_HOME/config.yaml`) |
| `--all` | Auto-detect installed hosts (binary on PATH or config file present) and install into every detected one |
| `--dry-run` | Print the exact `before` and `after` content per host. No disk writes. |
| `--uninstall` | Reverse a previous install — remove the `skillforge` entry, leave everything else untouched |
| `--force` | Overwrite an existing `skillforge` entry (default is to refuse with `already-installed`) |
| `--entry auto` | Default. Detects how the installer runs: a stable install writes `{ command: "node", args: ["<absolute dist/cli/dispatcher.js>", "serve"] }`; a one-shot `npx … install` run falls back to `{ command: "npx", args: ["-y", "@lyupro/skillforge-mcp", "serve"] }` |
| `--entry npx` | Explicit override. Writes `{ command: "npx", args: ["-y", "@lyupro/skillforge-mcp", "serve"] }` |
| `--entry local` | Explicit override. Writes `{ command: "node", args: ["<binary-path>", "serve"] }` |
| `--binary-path PATH` | Override the local-entry binary path (defaults to `<package>/dist/cli/dispatcher.js`) |
| `--help`, `-h` | Show usage |

At least one of `--claude`, `--codex`, `--cursor`, `--hermes`, or `--all` is required.

## Examples

```bash
# Wire into a single host
npx @lyupro/skillforge-mcp install --claude

# Wire into two hosts
npx @lyupro/skillforge-mcp install --codex --cursor

# Auto-detect every installed host and install everywhere
npx @lyupro/skillforge-mcp install --all

# See what would happen without touching disk
npx @lyupro/skillforge-mcp install --all --dry-run

# Use a local build instead of the published npm package
npx @lyupro/skillforge-mcp install --all --entry local --binary-path /abs/skillforge-mcp/dist/cli/dispatcher.js

# Force-overwrite a stale entry
npx @lyupro/skillforge-mcp install --claude --force
```

## How it edits each host

### Claude Code — `~/.claude.json`

```json
{
  "mcpServers": {
    "skillforge": {
      "command": "npx",
      "args": ["-y", "@lyupro/skillforge-mcp"]
    }
  }
}
```

Other entries under `mcpServers` and any unrelated top-level keys are preserved exactly.

### Codex CLI — `~/.codex/config.toml`

```toml
[mcp_servers.skillforge]
command = "npx"
args = ["-y", "@lyupro/skillforge-mcp"]
```

Other tables stay untouched.

### Cursor — `~/.cursor/mcp.json`

Cursor reads MCP servers from `~/.cursor/mcp.json` (global) — uniform across Windows, macOS, and Linux. With `--scope project` the target is `<project>/.cursor/mcp.json` instead. Cursor does **not** read MCP servers from its `settings.json`.

```json
{
  "mcpServers": {
    "skillforge": {
      "command": "npx",
      "args": ["-y", "@lyupro/skillforge-mcp"]
    }
  }
}
```

> **Not VS Code.** VS Code declares MCP servers via a nested `mcp.servers` block inside its `settings.json`; Cursor uses a standalone `mcp.json` with a top-level `mcpServers` map. The installer writes the Cursor shape — see [INTEGRATION/cursor.md](./INTEGRATION/cursor.md).

Other entries under `mcpServers` and any unrelated top-level keys are preserved.

### Hermes Agent — `~/.hermes/config.yaml`

Hermes reads MCP servers from `~/.hermes/config.yaml` (global) or `$HERMES_HOME/config.yaml` when the env var is set. With `--scope project` the target is `./.hermes/config.yaml` in the current directory instead.

The installer writes under the top-level `mcp_servers` key and never touches the sibling `mcp:` key (Hermes LLM provider config) or any other entries — the file is round-tripped through a comment-preserving YAML parser.

```yaml
mcp_servers:
  skillforge:
    command: npx
    args:
      - -y
      - "@lyupro/skillforge-mcp"
      - serve
    enabled: true
    timeout: 120
    connect_timeout: 60
```

Other entries under `mcp_servers` and any unrelated top-level keys are preserved.

After install, reload the MCP tool cache: run `/reload-mcp` in the CLI, or `hermes gateway restart` for the Telegram gateway. See [INTEGRATION/hermes.md](./INTEGRATION/hermes.md).

## Uninstalling

`--uninstall` removes only the `skillforge` entry from the targeted hosts. Pass the same target flags as the install (or `--all`):

```bash
npx @lyupro/skillforge-mcp install --all --uninstall
npx @lyupro/skillforge-mcp install --claude --uninstall
```

The host's config file remains in place. If `skillforge` was the only MCP server entry, the surrounding `mcpServers` (Claude Code / Cursor) or `mcp_servers` (Codex CLI / Hermes) object stays as an empty container.

## Backup and recovery

Every overwrite snapshots the previous content into `<path>.backup` before the new content is rolled in. If you need to revert manually:

```bash
# Claude Code
mv ~/.claude.json.backup ~/.claude.json

# Codex CLI
mv ~/.codex/config.toml.backup ~/.codex/config.toml

# Cursor
mv ~/.cursor/mcp.json.backup ~/.cursor/mcp.json

# Hermes Agent
mv ~/.hermes/config.yaml.backup ~/.hermes/config.yaml
```

The CLI never deletes `.backup` files on its own — clean them up when you no longer need them.

## `skillforge formats` subcommand

The skill format registry decides which files are skills and how their names are resolved. SkillForge ships four built-in formats (`claude`, `codex`, `persona`, `custom`); the `formats` subcommand lets you add, edit, or suppress formats from the shell. Persisted entries live under `config.skillFormats`. See [SKILL_FORMAT.md](./SKILL_FORMAT.md#skill-format-registry) for the full design.

```bash
skillforge formats list [--json]                          # all effective formats (built-in + operator)
skillforge formats add <id> <match-flag> [flags]          # register a new format
skillforge formats remove <id>                             # remove an operator format
skillforge formats enable <id>                             # enable a format (built-in or operator)
skillforge formats disable <id>                            # disable a format without removing it
```

`add` requires exactly one match flag:

- `--filename <name>` — match an exact basename (e.g. `GEMINI.md`).
- `--filename-glob <glob>` — match basenames against a glob (e.g. `*.skill.md`).
- `--frontmatter-field <field>` — match files whose frontmatter has the named non-empty string field.

`add` also accepts:

- `--name-field <field>` — frontmatter key holding the skill name (default `name`).
- `--derive-name-from-dir` — derive the name from the parent directory when the `name-field` is empty/absent. Only meaningful for filename / filename-glob matches.
- `--priority <n>` — conflict-resolution priority (default `100`).
- `--disabled` — register the format disabled.

Examples:

```bash
# Recognize Gemini Gem files; derive names from the parent directory.
skillforge formats add gemini-gem --filename GEMINI.md --derive-name-from-dir

# Add a *.skill.md convention with the highest priority.
skillforge formats add skill-suffix --filename-glob "*.skill.md" --priority 200

# Suppress the catch-all *.md format without losing the entry.
skillforge formats disable custom
```

Built-in formats cannot be removed (the registry would re-add them on the next load). Use `disable` to suppress one.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[<host>] ALREADY-INSTALLED` | An entry named `skillforge` already exists | Re-run with `--force` to overwrite, or `--uninstall` first |
| `[<host>] error: invalid JSON in "..."` | Host config file is corrupt | The CLI refuses to touch a corrupt file. Inspect the path the error points at and fix it before re-running |
| `[<host>] error: EACCES` | Host config path is not writable | Check ownership/permissions on the file (or the parent directory if the file does not yet exist) |
| `No supported hosts detected` | `--all` was used but no host binary is on PATH and no host config file exists | Pass `--claude` / `--codex` / `--cursor` / `--hermes` explicitly to force-install regardless of detection |
| Old entry still active after install | The host tool was running while you ran `install` | Restart the host (Claude Code session, Codex CLI session, Cursor app, or Hermes session / gateway) |

See [INSTALL.md](./INSTALL.md) for the underlying manual wiring steps that the CLI automates.
