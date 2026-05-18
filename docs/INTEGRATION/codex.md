# Integration — OpenAI Codex CLI

Codex CLI gained MCP support in May 2026. SkillForge works through Codex's standard `mcp_servers` table.

## Install

After the build step from [INSTALL.md](../INSTALL.md):

```bash
codex mcp add skillforge -- node /absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js serve
```

After publication on npm:

```bash
codex mcp add skillforge -- npx -y @lyupro/skillforge-mcp
```

## Config file

Codex stores the wiring under `[mcp_servers.skillforge]` in:

| Platform | Path |
|----------|------|
| Global | `~/.codex/config.toml` |
| Project-scoped | `<repo>/.codex/config.toml` (trusted projects only) |

Example:

```toml
[mcp_servers.skillforge]
command = "node"
args = ["/absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js", "serve"]

[mcp_servers.skillforge.env]
SKILLFORGE_FOLDERS = "/home/me/skills:/home/me/team-skills"
SKILLFORGE_TTL_MS = "120000"
```

## Passing env vars

```bash
codex mcp add skillforge \
  --env SKILLFORGE_FOLDERS=/home/me/skills \
  --env SKILLFORGE_TTL_MS=120000 \
  -- node /absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js serve
```

Codex's `--env` flag adds entries to the `[mcp_servers.skillforge.env]` table.

## Verify

In a Codex session:

```
/mcp
```

`skillforge` should appear with its five registered tools. Then:

```
/use skillforge skills__list
```

## Project-scoped vs. global

Use project-scoped config (`.codex/config.toml`) when:

- The project has its own `.skills/` directory you want exposed only for this repo.
- You need different `SKILLFORGE_FOLDERS` per project.
- You're testing SkillForge in one repo without touching global Codex config.

Use global config (`~/.codex/config.toml`) when:

- You want SkillForge available in every Codex session.
- Your skill folders are user-wide.

Codex's resolution order is project-scoped first, falling through to global. Same server name in both → project wins.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Unknown MCP server: skillforge` | Wiring not picked up | Run `codex mcp list` to confirm the entry exists. Restart Codex. |
| `Failed to spawn node` | `node` not on Codex's resolved PATH | Use absolute path: `command = "/usr/local/bin/node"`. |
| `[skillforge] fatal: ...` on startup | Build stale or config corrupt | Re-run `pnpm build` in the SkillForge repo. Check `~/.lyupro/.skillforge/config.json`. |
| Tools appear but `skills__list` returns empty array | Configured folders contain no `.md` files with `name:` frontmatter | Run `skills__reload` and inspect the `errors` array — missing-name failures surface there. |

## References

- Codex MCP: https://developers.openai.com/codex/mcp
- Codex CLI reference: https://developers.openai.com/codex/cli/reference
- Codex config reference: https://developers.openai.com/codex/config-reference
- SkillForge issues: https://github.com/lyupro/skillforge-mcp/issues

---

## Verification (2026-05-13)

**Environment:** Codex CLI 0.129.0 · Node 22.14.0 · Windows 11 · SkillForge v1.0.0

### MCP registration

```
codex mcp add skillforge -- node "c:/…/skillforge-mcp/dist/cli/dispatcher.js" serve
# → Added global MCP server 'skillforge'.
```

### Config written to `~/.codex/config.toml`

```toml
[mcp_servers.skillforge]
command = "node"
args = ["c:/…/skillforge-mcp/dist/cli/dispatcher.js", "serve"]
```

### Server list confirmation

```
codex mcp list
# skillforge  node  c:/…/dist/cli/dispatcher.js  …  enabled  Unsupported
```

`Unsupported` in the Auth column is expected — SkillForge uses no OAuth/API-key auth layer.

### Tool availability

Five tools confirmed registered:
`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`

**Status: installation verified.** The server registers and shows `enabled` via `codex mcp list`. Full interactive invocation (running a Codex agent session and calling a tool) requires an active Codex session, which was not exercised here — use `codex mcp list` + the `/use skillforge skills__list` command in a live Codex session to confirm tool response end-to-end.
