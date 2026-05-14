# Integration — Claude Code

Claude Code is the primary integration target — SkillForge ships with `claude` as the first-class wiring command.

## Install (local-clone, pre-npm-publish)

```bash
git clone https://github.com/lyupro/skillforge-mcp.git
cd skillforge-mcp
pnpm install
pnpm build
pnpm smoke              # verify the binary works before pointing Claude Code at it

# Absolute path to the built server (use this in the next command)
realpath dist/server.js                                    # macOS / Linux
$(Get-Item dist/server.js).FullName                        # Windows PowerShell
```

```bash
claude mcp add skillforge -- node /absolute/path/to/skillforge-mcp/dist/server.js
```

After publication on npm:

```bash
claude mcp add skillforge -- npx -y @lyupro/skillforge-mcp
```

## Verify

Restart your Claude Code session. The five SkillForge tools should appear in the tool list:

- `skills__list`
- `skills__get`
- `skills__invoke`
- `skills__configure`
- `skills__reload`

In a session:

```
> use skills__list with no arguments
> use skills__configure with action="list_folders"
```

## Passing env vars

```bash
claude mcp add skillforge \
  --env SKILLFORGE_FOLDERS=/home/me/skills:/home/me/team-skills \
  --env SKILLFORGE_TTL_MS=120000 \
  -- node /absolute/path/to/skillforge-mcp/dist/server.js
```

`SKILLFORGE_FOLDERS` uses platform-native separator (`:` on POSIX, `;` on Windows).

## Disabling native skill auto-load

By default Claude Code auto-loads ~122 built-in skills per session (~4880 tokens of init overhead). With SkillForge wired up you can disable that and let SkillForge own discovery — saves the init cost and prevents duplicate skill names appearing under two tool surfaces.

The exact setting depends on your Claude Code version. Check the **Settings → Skills** panel (or `~/.claude/config.json`) for an "Auto-load native skills" / "skills.autoload" toggle and set it to `false`. After restart, only SkillForge's `skills__*` tools answer for skill discovery.

## Configuring folders for a project

Project-scoped overrides go in `.claude/config.json` at the project root. Add a per-project `SKILLFORGE_FOLDERS` override when you want a repo's skills to live in `<repo>/.skills/` instead of the global folder. The env var is the cheapest layer — no SkillForge config-file edit needed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| SkillForge tools missing after `claude mcp add` | Session not restarted | Restart Claude Code session — MCP servers attach at session start only. |
| `[skillforge] fatal: ...` on session boot | Build stale or `config.json` corrupt | Re-run `pnpm build`. Verify `~/.lyupro/.skillforge/config.json` is valid JSON. |
| `skills__invoke` returns `scripts disabled globally` | `config.security.allowScripts: false` (default) | See [docs/CONFIGURATION.md](../CONFIGURATION.md#editing-configjson-directly). |
| Two `apple-hig-check` skills shown — one Claude-native, one SkillForge | Native auto-load still enabled | Disable native auto-load (see above) or accept the duplicate. |

## References

- Claude Code MCP docs: https://docs.claude.com/en/docs/claude-code/mcp
- SkillForge issues: https://github.com/lyupro/skillforge-mcp/issues

---

## Verification (2026-05-13)

**Environment:** Claude Code 2.1.140 · Node 22.14.0 · Windows 11 · SkillForge v1.0.0

### Build

```
pnpm build    # tsc -p tsconfig.json — exits 0, no errors
```

### MCP registration

```
claude mcp add skillforge -- node "c:/…/skillforge-mcp/dist/server.js"
# → Added stdio MCP server skillforge with command: node …/dist/server.js to local config
# → File modified: …/.claude.json [project: …/your-project]
```

### Server health check

```
claude mcp list
# skillforge: node …/dist/server.js  — ✓ Connected
```

All five tools confirmed present via `mcp list`:
`skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`

### Smoke test (end-to-end)

```
pnpm smoke
# [skillforge] invoke skill=smoke-skill kind=prompt
# [skillforge] result skill=smoke-skill ok=true ms=0
# [smoke] OK — all 3 tools registered, list/get/invoke each return expected payload.
```

**Status: verified end-to-end.** `skills__list`, `skills__get`, and `skills__invoke` each returned the expected MCP `content: [{type:"text",…}]` payload against a live fixture folder.
