# Configuration

SkillForge has two layers of configuration:

1. **Environment variables** — ephemeral, set per shell or per process. Highest priority for folder resolution.
2. **Persisted JSON config** — schema-validated, durable across restarts. Owns folder priorities, security gates, watcher tuning, invocation defaults.

This document covers both. For the field-level skill frontmatter contract, see [SKILL_FORMAT.md](./SKILL_FORMAT.md).

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SKILLFORGE_FOLDERS` | unset | Folder list (path-separator: `;` on Windows, `:` elsewhere). When set, **overrides** persisted `folders[]` entirely. |
| `SKILLFORGE_TTL_MS` | `300000` (5 min) | Metadata cache TTL. Below it, `skills__list` re-uses the cached registry; after, the next call rescans. Set to `0` to fall back to default. |

Env reads happen on **server boot only**, inside `loadResolvedConfig`. Changing them mid-session has no effect until the host restarts the MCP server.

---

## Config file location

| Platform | Path |
|----------|------|
| All (Windows / macOS / Linux) | `~/.lyupro/.skillforge/config.json` (resolved cross-platform via `os.homedir()`) |

The path follows the Lyu Pro brand convention: `~/.lyupro/` is the shared package directory, and the dot-prefixed `.skillforge/` subdirectory holds the per-tool runtime state.

The file is created lazily on the first `skills__configure` mutation. If absent at boot, schema defaults are used in memory. If present but corrupt (invalid JSON or schema mismatch), the server refuses to start and prints the failing path on stderr.

---

## Folder resolution cascade

```
SKILLFORGE_FOLDERS env (when non-empty)
      ↓ otherwise
persisted folders[] filtered to enabled: true, sorted by priority desc
      ↓ otherwise
built-in default: ~/.claude/plugins/cache/claude-code-skills/
```

Resolved paths are deduplicated and absolutised before being handed to `FileScanner`.

---

## Schema (annotated)

The full Zod schema lives in `src/config/config-schema.ts`. Below is the camelCase canonical form with every field's default and constraint.

```json
{
  "version": "1.0",
  "folders": [
    {
      "path": "/home/me/skills",
      "priority": 100,
      "enabled": true,
      "tags": []
    }
  ],
  "blacklist": [],
  "security": {
    "autoAudit": true,
    "auditPatterns": ["shell=True", "eval\\(", "exec\\(", "base64\\.b64decode"],
    "allowScripts": false,
    "sandboxScripts": true,
    "sandboxRestrictedPaths": ["~/.ssh", "~/.aws", "~/.gnupg"]
  },
  "cache": {
    "metadataTtlMs": 300000,
    "contentTtlMs": 300000,
    "maxSizeMb": 50
  },
  "watcher": {
    "enabled": true,
    "debounceMs": 500
  },
  "logging": {
    "level": "info",
    "file": null
  },
  "invocation": {
    "defaultTimeoutMs": 30000,
    "cacheTtlMs": 60000,
    "cacheMaxEntries": 128
  }
}
```

### `folders[]`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `path` | `string` | — | Absolute or relative — resolved via `path.resolve()` on save. Min length 1. |
| `priority` | `int` | `100` | Higher wins on name collisions across folders (`SkillResolver`). |
| `enabled` | `boolean` | `true` | `false` keeps the entry but excludes it from `loadResolvedConfig` until re-enabled. |
| `tags` | `string[]` | `[]` | Informational only — not consumed at runtime yet, reserved for future "scan only folders with tag X" filters. |

### `blacklist[]`

Array of exact skill names (case-sensitive) to exclude from the registry. Short-circuits before audit-pattern scanning. Use this for skills you want to keep on disk but never expose — e.g. drafts, deprecated.

### `security`

| Field | Default | Effect |
|-------|---------|--------|
| `autoAudit` | `true` | When true, `PatternScanner` runs against every skill body on load. Matched skills excluded with a stderr warning. |
| `auditPatterns` | `["shell=True", "eval\\(", "exec\\(", "base64\\.b64decode"]` | Regex source strings (compiled with `g` flag). Empty/invalid patterns drop with a stderr note — see [SECURITY.md](./SECURITY.md). |
| `allowScripts` | `false` | **Global** gate for `ScriptStrategy`. Both this and per-skill `allowScripts: true` must be true for any script to run. |
| `sandboxScripts` | `true` | Reserved — currently always-on. `SandboxRunner` is the only `ScriptStrategy` execution path; setting this false has no effect in v1. |
| `sandboxRestrictedPaths` | `["~/.ssh", "~/.aws", "~/.gnupg"]` | Reserved — informational signal listing paths the env whitelist already prevents subprocess access to. Not enforced at the filesystem level (Node `child_process` cannot). |

### `cache`

| Field | Default | Effect |
|-------|---------|--------|
| `metadataTtlMs` | `300000` (5 min) | `SkillMetadataCache` freshness window. After expiry, the next `skills__list` rescans. Currently the runtime reads the env-side `SKILLFORGE_TTL_MS` for both metadata + content caches; this persisted field is reserved for the planned config-overrides-env wiring. |
| `contentTtlMs` | `300000` | Same status as `metadataTtlMs` — currently env-driven. |
| `maxSizeMb` | `50` | Reserved — content cache currently uses LRU eviction by entry count, not bytes. |

### `watcher`

| Field | Default | Effect |
|-------|---------|--------|
| `enabled` | `true` | When true, `FolderWatcher` starts at boot and watches all resolved folders. When false, hot reload is off — use `skills__reload` to refresh manually. |
| `debounceMs` | `500` | Window during which add/change/unlink events batch before the watcher fires the cache-invalidate callback. |

### `logging`

| Field | Default | Effect |
|-------|---------|--------|
| `level` | `"info"` | Reserved — `stderrLogger` currently emits all `info` / `warn` / `error` calls regardless. Will gate output when the level is wired through. |
| `file` | `null` | Reserved — when set, will tee stderr to a log file. |

### `invocation`

| Field | Default | Effect |
|-------|---------|--------|
| `defaultTimeoutMs` | `30000` | `TimeoutDecorator` budget when a skill omits `timeoutMs` in its frontmatter. |
| `cacheTtlMs` | `60000` | `CacheDecorator` TTL when a skill omits `cacheTtlMs` in its frontmatter (but is otherwise cacheable). |
| `cacheMaxEntries` | `128` | LRU eviction trigger for the invocation result cache. |

---

## The five `skills__configure` actions

`skills__configure` is the live-mutation surface. Every mutating action saves the new config to disk **and** reconciles in-process state (splices `deps.folders`, calls `BlacklistFilter.setManualBlacklist`, invalidates `metadataCache`, calls `folderWatcher.setFolders`, runs `ensureRegistryFresh`) atomically.

### `list_folders`

```json
{"action": "list_folders"}
```

Returns:

```json
{
  "folders": ["/home/me/skills", "/home/me/team-skills"],
  "blacklist": ["draft-foo", "deprecated-bar"],
  "totalSkills": 42
}
```

Read-only. Same response shape as every other action.

### `add_folder`

```json
{"action": "add_folder", "folder": "/home/me/extra-skills"}
```

- Path is normalised via `path.resolve()` and compared as absolute.
- Idempotent — adding an already-present folder is a no-op but still saves the file (atomic-write contract: simpler to always save than to branch).
- Defaults applied: `priority: 100`, `enabled: true`, `tags: []`. Edit the JSON file directly if you need a different priority.

### `remove_folder`

```json
{"action": "remove_folder", "folder": "/home/me/extra-skills"}
```

- Removes the entry by absolute-path equality.
- No-op if not present.

### `set_blacklist`

```json
{"action": "set_blacklist", "blacklist": ["draft-foo", "deprecated-bar"]}
```

Replaces the entire blacklist (not additive). To clear, pass `blacklist: []`. To remove a single name, fetch the current list with `get_blacklist`, drop the name, and pass the result back.

### `get_blacklist`

```json
{"action": "get_blacklist"}
```

Same shape as `list_folders`. Provided as a semantic alias when you only care about the blacklist.

### `reset`

```json
{"action": "reset"}
```

Replaces the persisted config with schema defaults. After reset: folders fall back to the built-in default (`~/.claude/plugins/cache/claude-code-skills/`), blacklist is empty, every section is at its default value. **Cannot be undone** — back up `config.json` first if you might want to restore.

---

## The `skills__reload` tool

```json
{"action": "reload"}                    // no-op shape — full rescan
{"action": "reload", "folder": "/path"} // folder arg validated, full rescan still
```

`skills__reload` is the manual cache-invalidate + rescan path. It does **not** mutate the config file — only the in-memory registry. Returns:

```json
{
  "loaded": 42,
  "added": ["new-skill-a"],
  "removed": ["deleted-skill-b"],
  "errors": [
    {"path": "/home/me/skills/broken.md", "message": "missing required frontmatter field 'name'"}
  ]
}
```

The optional `folder` argument is validated against the configured folder list (you get an error if the folder isn't configured) but the rescan itself is always global — partial-folder reload is deferred. Use this when:

- A file changed but the watcher missed it (e.g. mass `git checkout`).
- You want to see per-file parse errors (the `errors` array carries them; normal `skills__list` calls log to stderr only).
- The watcher is disabled (`watcher.enabled: false`) and you want fresh state.

---

## Editing `config.json` directly

You can edit the file by hand for fields that `skills__configure` doesn't surface (security gates, watcher, invocation defaults, etc.). Workflow:

```bash
# Windows (PowerShell)
notepad $HOME\.lyupro\.skillforge\config.json

# macOS / Linux
${EDITOR:-vi} "$HOME/.lyupro/.skillforge/config.json"
```

Then either:

1. **Soft-reload** — call `skills__configure` with `action: "list_folders"`. The action handler always re-reads the config from disk and re-runs `loadResolvedConfig`, so anything inside `persisted.folders` / `persisted.blacklist` reconciles. **Security gates, watcher, invocation defaults do NOT live-reload** — they're captured into `ServerDeps` at boot and require a server restart.
2. **Hard restart** — quit the host (Claude Code session, Codex CLI process) and let it respawn the MCP server.

When in doubt, restart. The boot cost is ~100 ms.

---

## Example workflows

### "Scan only my team's shared skill repo, not the default"

```json
{
  "version": "1.0",
  "folders": [
    {"path": "/home/me/team-skills", "priority": 100, "enabled": true, "tags": []}
  ],
  "blacklist": [],
  "security": {},
  "cache": {},
  "watcher": {},
  "logging": {},
  "invocation": {}
}
```

The default folder is **not** auto-prepended — when `persisted.folders` has any enabled entry, the default drops out.

### "Use my team's skills first, fall back to the default"

```json
{
  "folders": [
    {"path": "/home/me/team-skills", "priority": 200, "enabled": true, "tags": []},
    {"path": "/home/me/.claude/plugins/cache/claude-code-skills", "priority": 100, "enabled": true, "tags": []}
  ]
}
```

Higher priority wins on name collisions. `SkillResolver.resolve` picks the team-skills copy when both folders register the same name.

### "Enable scripts globally + tighten the audit pattern set"

```json
{
  "security": {
    "autoAudit": true,
    "auditPatterns": [
      "shell=True", "eval\\(", "exec\\(", "base64\\.b64decode",
      "subprocess\\.(call|run|Popen)", "os\\.system",
      "import\\s+pickle", "__import__\\("
    ],
    "allowScripts": true
  }
}
```

`allowScripts: true` is the global gate. Individual skills still need `allowScripts: true` in their frontmatter — that's the defence-in-depth contract.

### "Quieter watcher on a folder with many file edits"

```json
{
  "watcher": {"enabled": true, "debounceMs": 2000}
}
```

Bigger `debounceMs` = fewer rescans during a rapid burst of `.md` edits, at the cost of longer staleness window.

---

## Verification commands

```bash
# Pretty-print the active config (read-only — useful when reporting bugs)
node -e "console.log(require('path').join(require('os').homedir(),'.lyupro','.skillforge','config.json'))"
cat "$(node -e "console.log(require('path').join(require('os').homedir(),'.lyupro','.skillforge','config.json'))")"
```

Or inside a wired LLM tool session:

```
> use skills__configure with action="list_folders"
```

The response shows the live resolved folders, blacklist, and total skills in the registry — everything `loadResolvedConfig` produced after the latest mutation.
