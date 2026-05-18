# Integration — Hermes Agent

Hermes Agent reads MCP servers from a YAML config file and supports bare `command`/`args` entries — the same shape used by Codex CLI and Cursor. SkillForge wires in through the top-level `mcp_servers` key.

## Install

After the build step from [INSTALL.md](../INSTALL.md):

```bash
npx @lyupro/skillforge-mcp install --hermes
```

Or include Hermes in an all-hosts pass:

```bash
npx @lyupro/skillforge-mcp install --all
```

## Config file

The installer edits only the `mcp_servers` key in Hermes's YAML config. It never touches the sibling top-level `mcp:` key (Hermes LLM provider config) or any other entries or comments — the file is round-tripped through a comment-preserving parser.

| Scope | Path |
|-------|------|
| Global (default) | `~/.hermes/config.yaml` |
| Global (env override) | `$HERMES_HOME/config.yaml` |
| Project-scoped | `./.hermes/config.yaml` (current directory) |

Entry written under `mcp_servers.skillforge`:

```yaml
mcp_servers:
  skillforge:
    command: node
    args:
      - /absolute/path/to/dist/cli/dispatcher.js
      - serve
    enabled: true
    timeout: 120
    connect_timeout: 60
```

`command` and `args` come from the shared entry resolver (`--entry auto` default). A stable install resolves to an absolute `node <dispatcher.js> serve`; a one-shot `npx` run falls back to an `npx` entry. `enabled`, `timeout`, and `connect_timeout` are Hermes-specific fields added automatically.

An existing `skillforge` entry is **not** overwritten without `--force` — the CLI reports `already-installed` and exits cleanly.

## Manual YAML alternative

If you prefer to edit `~/.hermes/config.yaml` by hand, add the following block under the top-level `mcp_servers` key (create the key if it does not exist):

```yaml
mcp_servers:
  skillforge:
    command: node
    args:
      - /absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js
      - serve
    enabled: true
    timeout: 120
    connect_timeout: 60
```

Replace the path with the absolute path to `dist/cli/dispatcher.js` in your local clone. Once the npm package is published, replace the `node` entry with:

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

## Alternative — `hermes mcp add`

Hermes also ships an interactive `mcp add` command:

```bash
hermes mcp add skillforge --command skillforge-mcp --args serve
```

This command is **interactive** — it connects to the server, lists tools, prompts `Enable all tools?`, and may prompt whether to overwrite an existing entry. It is fine for human use but not suitable for scripted or automated installs. Use `skillforge install --hermes` for non-interactive installs.

## After install — reload MCP tools

Hermes caches its MCP tool list. The server is not visible to Hermes until it re-opens MCP tools:

- **CLI session:** run `/reload-mcp` or start a new session.
- **Telegram gateway:** run `hermes gateway restart`.

## Verify

```bash
hermes mcp list
hermes mcp test skillforge
```

`hermes mcp list` should show `skillforge` in the server list. `hermes mcp test skillforge` connects to the server and confirms the five tools are reachable: `skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`.

## Project-scoped install

Pass `--scope project` to write `./.hermes/config.yaml` in the current directory instead of the global config:

```bash
npx @lyupro/skillforge-mcp install --hermes --scope project
```

Use project scope when:

- The project has its own `.skills/` directory you want exposed only for this repo.
- You need different `SKILLFORGE_FOLDERS` per project.
- You are testing SkillForge without touching your global Hermes config.

Use global scope (`~/.hermes/config.yaml`) when you want SkillForge available in every Hermes session and your skill folders are user-wide.

## Uninstall

```bash
npx @lyupro/skillforge-mcp install --hermes --uninstall
```

Pass `--scope project` if that is how you installed:

```bash
npx @lyupro/skillforge-mcp install --hermes --scope project --uninstall
```

Removes only the `skillforge` entry from `mcp_servers`. All other config content is preserved.

## Dry-run

```bash
npx @lyupro/skillforge-mcp install --hermes --dry-run
```

Prints the exact `before` and `after` content of the config file. No disk writes.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `skillforge` not visible after install | MCP tool cache not refreshed | Run `/reload-mcp` in the CLI session, or `hermes gateway restart` for the Telegram gateway. |
| `already-installed` reported | A `skillforge` entry already exists in the config | Re-run with `--force` to overwrite, or `--uninstall` first. |
| PATH resolution failure under gateway or systemd | `node` not on the gateway's PATH | Not an issue — the `auto` entry writes an absolute `node` path, so no PATH lookup is needed at runtime. |
| `[skillforge] fatal:` on stderr at startup | Corrupt or schema-incompatible `config.json` | Delete or fix the file at the path printed in the error (`~/.lyupro/.skillforge/config.json`). |
| Tools appear but `skills__list` returns empty array | Configured folders contain no `.md` files with `name:` frontmatter | Run `skills__reload` and inspect the `errors` array — missing-name failures surface there. |

## References

- SkillForge issues: https://github.com/lyupro/skillforge-mcp/issues
