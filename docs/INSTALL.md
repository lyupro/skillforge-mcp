# Installation

This guide covers wiring SkillForge MCP into the five supported integrations:

- [Claude Code](#1-claude-code)
- [OpenAI Codex CLI](#2-openai-codex-cli)
- [Cursor](#3-cursor)
- [Hermes Agent](#4-hermes-agent)
- [Manual MCP client](#5-manual-mcp-client) (custom integration via `@modelcontextprotocol/sdk`)

For per-tool deep dives, see [INTEGRATION/](./INTEGRATION/).

## Install CLI

`skillforge install` edits each host tool's config file for you:

```bash
npx @lyupro/skillforge-mcp install --all
```

It supports `--claude` / `--codex` / `--cursor` / `--hermes` / `--all`, plus `--dry-run`, `--uninstall`, `--force`, and `--entry npx|local`. Writes are atomic and snapshot the previous content into `<path>.backup`. Full reference: [INSTALL_CLI.md](./INSTALL_CLI.md).

### Global vs project scope

By default the installer edits each host's **global** config (the home-directory file). Pass `--scope project` to wire SkillForge into a **repo-local** config rooted at the current directory instead:

```bash
npx @lyupro/skillforge-mcp install --all --scope project
```

| Host | `--scope global` (default) | `--scope project` |
|------|----------------------------|-------------------|
| Claude Code | `~/.claude.json` | `./.mcp.json` |
| Codex CLI | `~/.codex/config.toml` | `./.codex/config.toml` |
| Cursor | `~/.cursor/mcp.json` | `./.cursor/mcp.json` |
| Hermes Agent | `~/.hermes/config.yaml` | `./.hermes/config.yaml` |

`skillforge uninstall` accepts the same `--scope global|project` flag — pass the scope you installed with so the right config file is reverted.

The manual wiring sections below remain the canonical reference for users who prefer to edit configs by hand or for environments where `npx` cannot run.

---

## Prerequisites

- **Node.js ≥ 20** — verify with `node --version`. Below 20, the build will type-check but `pnpm smoke` may fail on the `node:fs/promises` `readdir(recursive: true)` call used by `FileScanner`.
- **pnpm** — install via `npm install -g pnpm` if missing. Other package managers work for the build step but `pnpm` is the pinned tooling.
- **Git** — for cloning until v1.0.0 is published to npm.

> Once the npm package is published, the clone+build step is replaced by `npx -y @lyupro/skillforge-mcp serve` and the wiring commands change to use `npx` instead of an absolute `dist/cli/dispatcher.js` path. Until then this guide assumes local-clone install.

---

## Build

```bash
git clone https://github.com/lyupro/skillforge-mcp.git
cd skillforge-mcp
pnpm install
pnpm build              # emits dist/ (entry point: dist/cli/dispatcher.js)
pnpm smoke              # subprocess smoke test — exits 0 on success
```

`pnpm smoke` spawns the built binary, connects via `StdioClientTransport`, exercises all five tools (`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`) against a tmp-folder fixture, and verifies the responses. If this passes, your build is healthy.

Note the **absolute** path to `dist/cli/dispatcher.js`. Every integration below needs it.

```bash
# Windows
echo "$PWD\dist\cli\dispatcher.js"

# macOS / Linux
realpath dist/cli/dispatcher.js
```

---

## 1. Claude Code

### As a Claude Code plugin (recommended)

SkillForge ships a Claude Code plugin manifest, so it installs through the native `/plugins` UI with a rich plugin card:

```bash
/plugin marketplace add lyupro/skillforge-mcp
/plugin install skillforge
```

Or install it directly:

```bash
claude plugin install skillforge@lyupro/skillforge-mcp
```

### As an MCP server

```bash
claude mcp add skillforge -- node /absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js serve
```

Restart the Claude Code session. Five tools should appear in the tool list: `skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`.

To verify in-session:

```
> use skills__list with no arguments
```

The first call triggers a scan of the configured folders (default: `~/.claude/plugins/cache/claude-code-skills/`). Subsequent calls within the 5-minute TTL return cached metadata. See [INTEGRATION/claude-code.md](./INTEGRATION/claude-code.md) for advanced topics (env-var passing, disabling native skill auto-load to avoid duplicate work, multi-folder setups).

### Optional — disable Claude Code's native skill auto-load

Claude Code auto-loads built-in skills (~122 skills, ~4880 tokens). With SkillForge, you can disable that and let SkillForge own the discovery — saves the per-session init token cost. See [INTEGRATION/claude-code.md](./INTEGRATION/claude-code.md) for the exact setting.

---

## 2. OpenAI Codex CLI

Codex CLI gained MCP support in 2026-05. Wiring is similar:

```bash
codex mcp add skillforge -- node /absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js serve
```

Config lives in `~/.codex/config.toml` under `[mcp_servers.skillforge]`. Project-scoped overrides go into `.codex/config.toml` at the repo root. To pass env vars (e.g. custom folders):

```bash
codex mcp add skillforge \
  --env SKILLFORGE_FOLDERS=/home/me/skills \
  -- node /absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js serve
```

See [INTEGRATION/codex.md](./INTEGRATION/codex.md) for verified config snippets and platform notes.

References:
- https://developers.openai.com/codex/mcp
- https://developers.openai.com/codex/cli/reference
- https://developers.openai.com/codex/config-reference

---

## 3. Cursor

Cursor reads MCP servers from `~/.cursor/mcp.json` (global) or `<project>/.cursor/mcp.json` (project) — the same top-level `mcpServers` shape Claude Code uses. Cursor does **not** read MCP servers from its `settings.json`.

```json
// ~/.cursor/mcp.json (global) — or <project>/.cursor/mcp.json (project)
{
  "mcpServers": {
    "skillforge": {
      "command": "node",
      "args": ["/absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js", "serve"]
    }
  }
}
```

> **Not VS Code.** VS Code uses a nested `mcp.servers` block inside its `settings.json`; Cursor uses a standalone `mcp.json` with a top-level `mcpServers` map. The two are not interchangeable — see [INTEGRATION/cursor.md](./INTEGRATION/cursor.md).

For the latest Cursor-specific notes, see [INTEGRATION/cursor.md](./INTEGRATION/cursor.md).

---

## 4. Hermes Agent

Hermes Agent stores MCP servers in a YAML config file under the top-level `mcp_servers` key:

```bash
npx @lyupro/skillforge-mcp install --hermes
```

Config lives in `~/.hermes/config.yaml` (or `$HERMES_HOME/config.yaml` when the env var is set). Pass `--scope project` to target `./.hermes/config.yaml` in the current directory instead.

The installer writes a bare `command`/`args` entry with Hermes-specific `enabled`, `timeout`, and `connect_timeout` fields. It never touches the sibling top-level `mcp:` key (Hermes LLM provider config) or any other entries. After install, reload the MCP tool cache:

- **CLI session:** run `/reload-mcp` or start a new session.
- **Telegram gateway:** run `hermes gateway restart`.

Verify: `hermes mcp list`, `hermes mcp test skillforge`.

See [INTEGRATION/hermes.md](./INTEGRATION/hermes.md) for the full YAML snippet, the `hermes mcp add` interactive alternative, and troubleshooting notes.

---

## 5. Manual MCP client

Any client that speaks MCP stdio over `@modelcontextprotocol/sdk` can connect:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/absolute/path/to/skillforge-mcp/dist/cli/dispatcher.js', 'serve'],
});
const client = new Client({ name: 'my-client', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(tools.map(t => t.name));
// → ['skills__list', 'skills__get', 'skills__invoke', 'skills__configure', 'skills__reload']

const result = await client.callTool({
  name: 'skills__list',
  arguments: {},
});
console.log(result.content);

await client.close();
```

See [INTEGRATION/custom-llm-tools.md](./INTEGRATION/custom-llm-tools.md) for protocol details, schemas, and a complete reference client.

---

## Configure folders to scan

By default SkillForge scans `~/.claude/plugins/cache/claude-code-skills/`. Three ways to override:

### a) Environment variable (highest priority, ephemeral)

```bash
# Windows PowerShell
$env:SKILLFORGE_FOLDERS = "C:\path\to\skills;C:\other\folder"

# macOS / Linux
export SKILLFORGE_FOLDERS=/home/me/skills:/home/me/team-skills
```

Path separator is platform-native (`;` on Windows, `:` elsewhere).

### b) `skills__configure` tool (persisted to JSON config)

Inside any LLM tool session:

```
> use skills__configure with action="add_folder", folder="/home/me/skills"
> use skills__configure with action="list_folders"
```

The change persists to the config file (see below) and reconciles in-process state immediately — no server restart needed.

### c) Direct edit of the config file

- All platforms: `~/.lyupro/.skillforge/config.json` (resolved cross-platform via `os.homedir()`)

The file is Zod-validated on load. Missing → schema defaults. Corrupt JSON or schema mismatch → loud error with the file path (the server refuses to start until fixed).

Full schema reference: [CONFIGURATION.md](./CONFIGURATION.md).

---

## Verify the install

Inside any wired LLM tool session:

1. `skills__list` — should return an array of skill summaries (possibly empty if you have no skills folders yet).
2. `skills__configure` with `action: "list_folders"` — should show the resolved folder list with priorities + `enabled` flags.
3. `skills__reload` — forces a fresh scan, returns `{loaded, added, removed, errors}` diff.

If any of these fail with `[skillforge] fatal:` on stderr, the most likely cause is a corrupt config file or a missing folder path — the error message points at the offending file. Delete or fix `~/.lyupro/.skillforge/config.json` and retry.

---

## Upgrade

```bash
cd skillforge-mcp
git pull
pnpm install
pnpm build
pnpm smoke
```

The wiring in Claude Code / Codex / Cursor / Hermes points at the same `dist/cli/dispatcher.js` absolute path — restarting the host session picks up the new build. Once published to npm, the upgrade flow becomes `npm install -g @lyupro/skillforge-mcp@latest` (or the equivalent for the host tool that fetched the package).

### Self-update — `skillforge update`

For a global npm install, `skillforge update` checks the registry and applies a newer version for you (alias `skillforge upgrade`; `--check` reports without installing). Two environment realities it surfaces — and never resolves silently:

- **Permissions.** On Linux the global prefix is usually root-owned (`/usr/lib/node_modules`), so the install needs `sudo`. `update` detects the non-writable prefix and prints the exact `sudo npm install -g @lyupro/skillforge-mcp@latest` — it does not run `sudo` itself. To avoid `sudo` permanently, install into a user-owned prefix (`npm config set prefix ~/.npm-global`, then add `~/.npm-global/bin` to `PATH`) or use a version manager (nvm / fnm / volta).
- **Cooldown.** If `~/.npmrc` sets npm's `min-release-age` (npm ≥ 11.10.0), a just-published version is withheld until it is old enough. `update` reports this and prints the opt-in `skillforge update --min-release-age 0`. (Same registry filter that hides a fresh version from `npx` below.)

### Re-wire the host config when upgrading from before v1.4.2 (one-time)

Upgrading the package only refreshes the code. The entry in your host
config (`~/.claude.json`, Codex / Cursor / Hermes configs) is left
untouched. If it was created by an installer before v1.4.2, it holds the
old **npx-entry** (`command=npx`) — and on a host with `min-release-age`
set in `~/.npmrc` the MCP server fails to connect (`-32000` /
`ENOVERSIONS`), because `npx` re-resolves the package from the registry
on every spawn and the registry filter hides the just-published version.

Overwrite it with the binary-entry:

```bash
skillforge install --claude --force   # also --codex / --cursor / --hermes
# then restart the host tool so it picks up the new entry
```

Since v1.4.2 the installer defaults to `--entry auto`, which writes a
binary-entry (`command=node`, `args=[<abs dispatcher.js>, serve]`). The
host then launches the server directly — no network, no npm resolve per
spawn. This is a one-time step; later upgrades no longer need `--force`.

---

## Uninstall

Remove the MCP server entry from your host tool:

```bash
claude mcp remove skillforge
codex mcp remove skillforge
```

Optionally delete the persisted config:

```bash
# Windows (PowerShell)
Remove-Item $HOME\.lyupro\.skillforge -Recurse -Force

# macOS / Linux
rm -rf "$HOME/.lyupro/.skillforge"
```

And delete the cloned repo. That's everything — SkillForge writes nothing else outside the config directory and the temp `cwd` used by `SandboxRunner` (which is auto-cleaned in `finally`).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `[skillforge] fatal: ... config ...` on stderr at boot | Corrupt or schema-incompatible `config.json` | Delete or fix the file at the path printed in the error. |
| `pnpm smoke` exits non-zero with `MODULE_NOT_FOUND` | Build skipped or stale `dist/` | Re-run `pnpm install && pnpm build`. |
| `skills__list` returns empty array | No skills found in any configured folder | Verify the folder exists, contains `.md` files with `name:` frontmatter, and is not blacklisted. Run `skills__reload` and check the `errors` field. |
| `skills__invoke` returns `scripts disabled globally` | `config.security.allowScripts: false` (default) | Edit `config.json` and set `security.allowScripts: true`, then restart the host (env-resolved deps re-read on boot). See [CONFIGURATION.md](./CONFIGURATION.md#security). |
| `skills__invoke` returns `scripts disabled for this skill` | Global flag is true, but skill is missing `allowScripts: true` in frontmatter | Add `allowScripts: true` to the skill's frontmatter. |
| Skill body shows up unredacted but matches `eval(` / `shell=True` | `security.autoAudit: true` (default) and `auditPatterns` matched | Skill is excluded from the registry. Either fix the skill body or remove the pattern from `auditPatterns`. See [SECURITY.md](./SECURITY.md). |
| Hot reload doesn't pick up new `.md` files | `watcher.enabled: false` in config OR file extension is not `.md` | Set `watcher.enabled: true` and ensure the file is `.md`. Use `skills__reload` to force a rescan manually. |
| MCP server fails to connect (`-32000` / `ENOVERSIONS`) | Host config holds a pre-v1.4.2 npx-entry, and `min-release-age` in `~/.npmrc` hides the published version from `npx`'s per-spawn resolve | Re-wire to the binary-entry: `skillforge install --claude --force` (also `--codex` / `--cursor` / `--hermes`), then restart the host. See [Upgrade](#upgrade). |
| Stderr quiet on a folder you expect to be a skill | File did not match any enabled skill-format descriptor (e.g. a generic `.md` without a `name:` field, or a `references/` sub-file inside a skill directory) | Re-run with `skillforge skills get <name> --verbose` to surface debug-level skip lines that explain why each candidate was dropped. The default `info` level suppresses these — see [CONFIGURATION.md](./CONFIGURATION.md#verbosity-controls). |
| A `SKILL.md` / `AGENTS.md` is silently missing from the registry | File frontmatter is malformed or the skill is on the blacklist | Re-run with `--verbose` to see the parse error, or `skillforge skills reload` to print the aggregated error summary including a per-file breakdown. |
