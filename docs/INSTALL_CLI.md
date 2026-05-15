# Install CLI

One-command wiring of SkillForge MCP into Claude Code, Codex CLI, and Cursor. Shipped in **v1.1**.

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
| `--all` | Auto-detect installed hosts (binary on PATH or config file present) and install into every detected one |
| `--dry-run` | Print the exact `before` and `after` content per host. No disk writes. |
| `--uninstall` | Reverse a previous install — remove the `skillforge` entry, leave everything else untouched |
| `--force` | Overwrite an existing `skillforge` entry (default is to refuse with `already-installed`) |
| `--entry npx` | Default. Writes `{ command: "npx", args: ["-y", "@lyupro/skillforge-mcp"] }` |
| `--entry local` | Writes `{ command: "node", args: ["<binary-path>"] }` |
| `--binary-path PATH` | Override the local-entry binary path (defaults to `<package>/dist/server.js`) |
| `--help`, `-h` | Show usage |

At least one of `--claude`, `--codex`, `--cursor`, or `--all` is required.

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
npx @lyupro/skillforge-mcp install --all --entry local --binary-path /abs/skillforge-mcp/dist/server.js

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

## Uninstalling

`--uninstall` removes only the `skillforge` entry from the targeted hosts. Pass the same target flags as the install (or `--all`):

```bash
npx @lyupro/skillforge-mcp install --all --uninstall
npx @lyupro/skillforge-mcp install --claude --uninstall
```

The host's config file remains in place. If `skillforge` was the only MCP server entry, the surrounding `mcpServers` (Claude Code / Cursor) or `mcp_servers` (Codex CLI) object stays as an empty container.

## Backup and recovery

Every overwrite snapshots the previous content into `<path>.backup` before the new content is rolled in. If you need to revert manually:

```bash
# Claude Code
mv ~/.claude.json.backup ~/.claude.json

# Codex CLI
mv ~/.codex/config.toml.backup ~/.codex/config.toml

# Cursor
mv ~/.cursor/mcp.json.backup ~/.cursor/mcp.json
```

The CLI never deletes `.backup` files on its own — clean them up when you no longer need them.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[<host>] ALREADY-INSTALLED` | An entry named `skillforge` already exists | Re-run with `--force` to overwrite, or `--uninstall` first |
| `[<host>] error: invalid JSON in "..."` | Host config file is corrupt | The CLI refuses to touch a corrupt file. Inspect the path the error points at and fix it before re-running |
| `[<host>] error: EACCES` | Host config path is not writable | Check ownership/permissions on the file (or the parent directory if the file does not yet exist) |
| `No supported hosts detected` | `--all` was used but no host binary is on PATH and no host config file exists | Pass `--claude` / `--codex` / `--cursor` explicitly to force-install regardless of detection |
| Old entry still active after install | The host tool was running while you ran `install` | Restart the host (Claude Code session, Codex CLI session, Cursor app) |

See [INSTALL.md](./INSTALL.md) for the underlying manual wiring steps that the CLI automates.
