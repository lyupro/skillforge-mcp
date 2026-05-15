# Integration — Cursor

Cursor IDE supports MCP servers via a dedicated `mcp.json` file. SkillForge wiring is straightforward.

## Config file location

Cursor reads MCP servers from one of two files — **never** from Cursor's `settings.json`:

| Scope | File path |
|-------|-----------|
| Global | `~/.cursor/mcp.json` |
| Project | `<project>/.cursor/mcp.json` |

The global path is `~/.cursor/mcp.json` on every OS (Windows, macOS, Linux) — Cursor resolves it from the home directory, so there is no per-OS application-data path to track.

> **Not VS Code.** This is a common confusion: VS Code declares MCP servers via a nested `mcp.servers` block inside its own `settings.json`. Cursor does **not** use that shape and does **not** read MCP from `settings.json`. Cursor uses a standalone `mcp.json` with a top-level `mcpServers` map — the same shape Claude Code uses in `~/.claude.json`. If you put a `mcp.servers` block into Cursor's `settings.json`, Cursor will silently ignore it.

## Install

Edit `~/.cursor/mcp.json` (global) — create the file if it does not exist:

```json
{
  "mcpServers": {
    "skillforge": {
      "command": "node",
      "args": ["/absolute/path/to/skillforge-mcp/dist/server.js"],
      "env": {
        "SKILLFORGE_FOLDERS": "/home/me/skills",
        "SKILLFORGE_TTL_MS": "120000"
      }
    }
  }
}
```

> **Windows example** — replace with your actual clone path:
> ```json
> {
>   "mcpServers": {
>     "skillforge": {
>       "command": "node",
>       "args": ["C:\\Users\\you\\skillforge-mcp\\dist\\server.js"],
>       "env": {
>         "SKILLFORGE_FOLDERS": "C:\\Users\\you\\skills"
>       }
>     }
>   }
> }
> ```

After publication on npm:

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

> **Schema note (Cursor docs, retrieved 2026-05-16):** Cursor uses `"mcpServers"` (camelCase) as the top-level key. The object shape is `{ command, args, env }` — identical to Claude Code's MCP stdio format.

## Verify

Restart Cursor after editing the config. The five SkillForge tools should appear in Cursor's tool list:

- `skills__list`
- `skills__get`
- `skills__invoke`
- `skills__configure`
- `skills__reload`

In Cursor's agent chat:

```
> Call skills__list with no arguments and show me what's available.
```

## Workspace-scoped configuration

Cursor supports per-workspace MCP settings via `.cursor/mcp.json` at the project root. It uses the same top-level `mcpServers` shape as the global `~/.cursor/mcp.json`. Use this when a project has its own `.skills/` directory that should only be exposed when that project is open.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| SkillForge tools missing | Config not reloaded | Restart Cursor. MCP servers attach at workspace open. |
| SkillForge tools missing, config looks correct | Entry written to `settings.json` instead of `mcp.json` | Cursor reads MCP only from `~/.cursor/mcp.json` / `.cursor/mcp.json`. Move the `mcpServers` block there. |
| `Failed to spawn node` | `node` not on Cursor's resolved PATH | Use absolute path: `"command": "/usr/local/bin/node"` (macOS/Linux) or `"command": "C:\\Program Files\\nodejs\\node.exe"` (Windows). |
| `[skillforge] fatal:` | Build stale or config corrupt | Re-run `pnpm build`. Check the `config.json` path printed in the error. |

## References

- Cursor MCP docs: https://cursor.com/docs/mcp
- SkillForge issues: https://github.com/lyupro/skillforge-mcp/issues

---

## Verification (2026-05-16)

**Status: docs-only — end-to-end pending.**

Cursor is not installed in the maintainer's local environment. The `mcpServers` config schema and the `~/.cursor/mcp.json` / `.cursor/mcp.json` file locations above were verified against the official Cursor docs (https://cursor.com/docs/mcp, retrieved 2026-05-16). The `{ command, args, env }` shape is identical to the MCP stdio transport format confirmed working in Claude Code and Codex CLI — the same SkillForge `dist/server.js` binary works with any MCP-stdio client.

If you wire SkillForge into Cursor and confirm it works, please open a PR updating this section with your Cursor version and the output of Cursor's MCP server status panel.
