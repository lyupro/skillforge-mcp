# SkillForge MCP — Release Notes

**License:** MIT
**Maintainer:** [Lyu Pro](https://lyupro.com)

Per-release notes, newest first. For the terse machine-style changelog see [CHANGELOG.md](./CHANGELOG.md).

---

## v1.12.0 — Update that warns before it fails

**Release date:** 2026-06-26

`skillforge update` now catches the two ways a global self-update goes wrong on real machines — a root-owned prefix and an npm cooldown — and tells you what to do, without ever escalating privileges or weakening a policy on your behalf.

- **Permission pre-flight.** Before installing, `update` checks whether the global npm prefix (`npm root -g`) is writable. On Linux it usually is not (`/usr/lib/node_modules` is root-owned), so the install would die with `EACCES`. `update` now detects that up front, prints the exact `sudo npm install -g <name>@latest`, and exits — it **never runs `sudo` for you**. The message also shows how to drop `sudo` permanently (user-owned prefix `npm config set prefix ~/.npm-global`, or a version manager like nvm / fnm / volta).
- **Cooldown pre-flight.** npm ≥ 11.10.0 can enforce a supply-chain cooldown (`min-release-age=<days>`) that withholds versions younger than N days. `update` reads the latest version's publish time and your configured cooldown; if the cooldown would block the latest, it reports the gap and prints the opt-in `skillforge update --min-release-age 0`. The cooldown is **never bypassed silently** — it is a protection you set on purpose.
- **`--min-release-age <n>`** (and `--min-release-age=<n>`) is forwarded straight to npm. Pass `0` to install a just-published latest now. It cannot be combined with npm's `--before`, so `update` deliberately does not expose `--before`.
- **Latest-version query.** `--check` and `--json` are the way to ask "what is the newest version on npm?" — they print current/latest and never install.

**Engineering snapshot**

- 926 tests passing + 2 skipped.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines (detection helpers split into `update-preflight.ts`).

## v1.11.0 — Self-update from the terminal

**Release date:** 2026-06-26

Updating a global install no longer means hand-typing `npm install -g @lyupro/skillforge-mcp@latest` and remembering when to reach for `sudo`.

- **`skillforge update`** (alias `skillforge upgrade`) — reads its own package name and version from `package.json`, asks the npm registry for `dist-tags.latest`, and compares the two. With no flags it applies a newer version via `npm install -g <name>@latest`.
- **Report-only modes.** `--check` prints `update available: X → Y` or `up to date` without installing; `--dry-run` prints the install command for pnpm / yarn-global users to copy; `--json` emits `{ current, latest, updateAvailable }`; `--registry <url>` points the check at a private mirror.
- **Fail-loud, never silent.** A failed install (commonly `EACCES` on a system-owned global prefix) prints the exact command with a `sudo` hint and exits non-zero — nothing is retried behind your back. The package name is read from `package.json`, never hard-coded, since the registry id is volatile.

**Engineering snapshot**

- 901 tests passing + 2 skipped.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.10.0 — Folder aliases that match real handles

**Release date:** 2026-06-26

Folder aliases now accept the handles real skill folders actually have.

- **`skillforge folders rename <old-alias|path> <new-alias>`** — rename an existing alias in one step, addressing the folder by its current alias or its path, with the same uniqueness and validation rules as `alias`.
- **Relaxed alias grammar.** An alias is lowercase letters/digits in segments joined by a single `-`, `_`, or `/` (e.g. `lyupro/llm-skills`, `team_shared_skills`) — the `/` lets an alias mirror a source handle. Uppercase input is auto-lowercased and the normalization is printed, instead of being rejected. (Digits were always allowed; the prior error misattributed rejections to them — the real cause was uppercase and `_`.) Doubled or leading/trailing separators (`--`, `__`, `//`, `-foo`, `foo/`) are still rejected.
- **Case-insensitive alias lookup.** `remove` / `enable` / `disable` / `alias` / `rename` match a stored alias regardless of the case typed, since aliases are stored normalized.

**Engineering snapshot**

- 880 tests passing + 2 skipped.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.9.0 — Full CLI parity for security and version pins

**Release date:** 2026-05-24

Security knobs, manual blacklist patterns, and version-policy pins — all previously requiring hand-edits to `config.json` or the `skills__configure` MCP tool — are now manageable from the shell.

- **`skillforge security` group.** `audit-exceptions list|add|remove|clear`, `audit-target [scripts|all]`, `audit-patterns list` (read-only view of the seeded patterns), and `blacklist list|add|remove|clear` with each entry's classified kind. `list` accepts `--json`, `add` is idempotent, `clear` requires `--yes`, and a reindex hint prints after any mutation.
- **`skillforge version-policy` group.** `list`, `set <bundle> <latest|major.minor.patch>`, `remove <bundle>`, `clear --yes` — pin a bundle to an exact version or restore highest-semver resolution with `latest`.
- **Blacklist pattern types.** Entries are auto-classified by syntax: a plain name is an exact match, an entry with `*`/`?` but no `/` is a glob over the skill name (e.g. `wiki-*`), and any entry with `/` is a glob over the source path relative to its registered root (e.g. `**/agenthub/**`). Implemented with a self-contained glob compiler — no new dependency. Existing exact-name entries keep working with no migration.

**Engineering snapshot**

- 867 tests passing + 2 skipped.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.8.0 — Security-teaching skills load again

**Release date:** 2026-05-23

Security-teaching skills load again, and the freshest installed version of a bundle wins.

- **`security.auditTarget`** (`scripts` default, or `all`). The auto-audit now scans only fenced executable code blocks (`python`, `sh`, `js`, …) by default rather than the whole document. A skill whose prose merely *mentions* a flagged pattern — a security guide documenting `exec(` or `shell=True` in a table — no longer excludes itself. With `allowScripts:false` such a mention is never executed, so scanning it was a false positive. Set `all` to restore whole-body scanning.
- **`security.auditExceptions`** — a case-sensitive skill-name allowlist that bypasses the auto-audit for skills whose example code legitimately contains flagged patterns (security auditors, lint rule packs). The manual blacklist still applies.
- **`versionPolicy`** — a per-bundle map (`<bundle>` → `latest` | `<major.minor.patch>`). Pin a bundle to an exact version, or pin it to its current version to freeze it against newer installs. Defaults to `latest`.
- **Highest installed version wins on a name collision.** When one recursive root holds two installed versions of a bundle (`…/<bundle>/2.3.0/…` and `…/2.4.4/…`), the resolver keeps the highest semver instead of whichever the filesystem enumerated first. Cross-folder priority still takes precedence; an unparseable version falls back to stable input order.

**Engineering snapshot**

- 811 tests passing + 2 skipped.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.7.1 — Quieter defaults, candidate-aware skip lines

**Release date:** 2026-05-19

Routine per-file noise gone from the default stderr stream — only files SkillForge could actually load surface as a skip.

- **Leveled logger.** Output is now filtered by threshold. Default `info` keeps folder-scan failures, blacklist exclusions, and name collisions visible; per-file skip lines drop to `debug` and stay hidden until you ask for them. `--verbose` / `-v` lowers the threshold to `debug`; `--quiet` / `-q` raises it to `warn`. `SKILLFORGE_DEBUG=1` or `DEBUG=1` also flip to `debug` for one-shot troubleshooting. The `logging.level` config key drives the default when no flag or env override is present.
- **Candidate filter via the format registry.** A `.md` becomes a skill candidate only when at least one enabled format descriptor matches it. A `README.md`, `references/*.md`, or `assets/*.md` next to a `SKILL.md` no longer fails the `name:` check and produces no log line at any level — they were never going to be skills. A canonical `SKILL.md` / `AGENTS.md` with broken frontmatter still produces a debug skip you can surface with `--verbose`.
- **Reload summary breakdown.** `skillforge skills reload` now reports `folder-failures` vs `file-skips` alongside the total error count.

**Engineering snapshot**

- 781 tests passing + 2 skipped.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.7.0 — Extensible skill format registry

**Release date:** 2026-05-19

SkillForge can now recognize a new LLM's skill layout without a code release — and a canonical file without a `name:` no longer disappears from the registry.

- **Config-driven format registry.** "What counts as a skill file" lives in `config.skillFormats`: a list of descriptors with a unique `id`, a `match` rule (exact filename, filename glob, or non-empty frontmatter field), a `nameField`, a `deriveNameFromDir` flag, plus `enabled` and `priority`. The four built-ins (`claude`, `codex`, `persona`, `custom`) ship by default; operator entries merge over them by `id`. Supporting Gemini Gem files is one line: `skillforge formats add gemini-gem --filename GEMINI.md --derive-name-from-dir`.
- **Directory-name derivation.** Canonical files (`SKILL.md` / `AGENTS.md`) without a `name:` in frontmatter used to be silently skipped — they were structurally unaddressable. They now register under a kebab-normalized parent-directory name (`migration-architect/SKILL.md` → `migration-architect`). The behaviour is per-format opt-in and limited to filename / filename-glob matches, so a sibling `README.md` never becomes a skill.
- **`skillforge formats` subcommand.** `formats list`, `formats add`, `formats remove`, `formats enable`, `formats disable` — same atomic-write story as `folders`. Built-ins can be disabled or replaced (by reusing their id), but not removed.
- **Provenance.** `skills get` and `skills list` JSON now carry `formatId` (which descriptor matched) and `nameSource` (`"frontmatter"` or `"directory"`). The text view of `skills get` shows them too. A derived name emits an info log to stderr.
- **Name-collision diagnostics.** When the same name registers from more than one folder, SkillForge logs the kept winner and the ignored copies on stderr. The priority-based resolver still picks the winner — no crash.

**Engineering snapshot**

- 749 tests passing + 2 skipped.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.6.0 — Persistent registry index

**Release date:** 2026-05-19

The terminal `skills` commands now start fast on every call.

- **Persistent on-disk index.** Each `skillforge skills get` runs as a fresh process, so its in-memory caches always started cold — every call walked every skill folder and parsed every skill file. SkillForge now keeps a registry snapshot in `<configDir>/cache/registry-index.json`; a subsequent process hydrates from it with one file read and parses only the skill you asked for. Over a 500-skill catalog, a warm `skills get` runs in ~28 ms versus ~109 ms cold — about a 3.8x speedup.
- **Always correct.** The index carries a fingerprint of every skill file's path and modification time. Add, remove, or edit a skill and the next call rebuilds automatically. A corrupt or missing index simply triggers a full rebuild — never a crash.
- **Batch fetch.** `skillforge skills get code-review,api-design,test-author` fetches several skills in one process. A single name keeps the original `--json` object shape; multiple names return `{ skills, errors }`.
- **`skillforge skills reindex`** rebuilds the on-disk index on demand and prints a summary. **`--no-cache`** bypasses the index for a guaranteed full scan.

**Engineering snapshot**

- 684 tests passing + 2 skipped.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.5.0 — Hermes Agent install target

**Release date:** 2026-05-18

SkillForge now installs into a fourth host: Hermes Agent.

- **`skillforge install --hermes`** edits the Hermes YAML config (`~/.hermes/config.yaml`, `$HERMES_HOME/config.yaml`, or `./.hermes/config.yaml` with `--scope project`) and adds a `mcp_servers.skillforge` entry — `command` / `args` plus the Hermes-specific `enabled` / `timeout` / `connect_timeout` fields. The config round-trips through a comment-preserving YAML parser, so the sibling `mcp:` provider block, other servers, and your comments are untouched. `install --all` picks up Hermes automatically.
- After install, Hermes caches its MCP tool list — the CLI prints a reminder to reload (`/reload-mcp`, a new session, or `hermes gateway restart`).

**Engineering snapshot**

- 649 tests passing + 2 skipped; the Hermes installer shares the entry resolver and atomic-write helpers with the other three host installers.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.4.2 — One canonical entry point, offline-safe installs

**Release date:** 2026-05-18

The installer now writes a host config that does not depend on the npm registry, and the server has a single entry point.

- **New default `--entry auto`.** The old default wrote an `npx` entry that re-resolves the package from the npm registry every time the server spawns — which fails on a machine with a registry cooldown policy or no network. `--entry auto` detects how the installer itself is running: from a stable install it writes a direct `node <dist/cli/dispatcher.js> serve` entry (no registry, offline-safe); from a one-shot `npx … install` it falls back to an npx entry. `--entry npx` and `--entry local` stay available as explicit overrides.
- **One canonical entry point.** `dist/cli/dispatcher.js` is now the single entry point — `serve` (its default subcommand) starts the MCP stdio server. The server-start sequence, previously duplicated between the dispatcher and `server.ts`, now lives in one place; `server.ts` is a pure module. Installer-written host configs and the default `--binary-path` point at the dispatcher instead of the internal `server.js` module.

**Engineering snapshot**

- 627 tests passing + 2 skipped; the three host installers now share one entry-resolution module.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean, `pnpm smoke` passes.
- All source files ≤ 400 lines.

## v1.4.1 — Global-install CLI fix

**Release date:** 2026-05-18

A single fix for a serious one: the CLI did nothing when installed globally.

- **The CLI was a silent no-op under `npm install -g`.** A global install puts the bin on `PATH` as a symlink (`/usr/bin/skillforge-mcp` → `dist/cli/dispatcher.js`). The dispatcher decided whether to run by comparing `process.argv[1]` to its own file path — but under a symlinked bin those are different strings (the symlink path vs. the real file), so the comparison failed and `main()` never ran. Every command — `install`, `serve`, `tools`, `folders`, `skills`, `--version`, `--help` — returned to the prompt instantly with no output and exit code 0. This hit every Linux and macOS global install since the dispatcher shipped in v1.1.1; Windows was unaffected because its npm `.cmd` shim passes the resolved file path. Entry detection now resolves both paths through `realpath` before comparing, so symlinked bins, direct `node dist/cli/dispatcher.js` invocations, and `npx` all work.

**Engineering snapshot**

- Tests passing + 1 win32-skip; a new symlink regression test covers the global-install path.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean.
- All source files ≤ 400 lines.

## v1.4.0 — Config live-reload and skills CLI

**Release date:** 2026-05-17

Four reliability and usability improvements.

- **Config live-reload.** The `skillforge folders` CLI writes `config.json` from a separate process; a long-lived MCP server held a startup folder snapshot and never picked up those edits without a restart. A new `ConfigWatcher` watches the config directory (handles atomic temp+rename saves) and reconciles the folder list and skill registry on every change. `skills__configure` `list_folders` and `get_blacklist` now report current disk state.
- **`skillforge skills` CLI subcommand.** There was no terminal-side way to inspect the skill registry without opening an LLM session. `skills list` prints a table of all registered skills with `--search`, `--source`, `--folder <path|alias>`, `--folder-tag`, `--json`, and `--folder-fmt alias|path` filters. `skills get <name>` prints the full SKILL.md of one skill. `skills reload` forces a registry rebuild and prints folder/skill counts.
- **Conflict-hint accuracy.** The skill-source conflict detector warned when a registered folder overlapped with a host plugin's native store — but warned even for plugins that were already disabled. It now reads the host's plugin enable state: disabled plugins produce no warning; unknown state produces a softened conditional hint.
- **Config forward-compatibility.** All Zod config schemas previously used `strip` mode, silently dropping unknown keys on load/save. A config written by a newer version of SkillForge would lose unrecognised fields when read by an older version. All schemas now use `passthrough`, so unknown future keys survive a load/save round-trip.

**Engineering snapshot**

- 609 / 609 tests passing + 1 win32-skip (610 total).
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean.
- All 68 source files ≤ 400 lines.

## v1.3.0 — Folder ergonomics

**Release date:** 2026-05-16

Folders became easier to address, toggle, and group.

- **Folder alias.** A folder can now carry a short kebab-case `alias`. Register it with `skillforge folders add <path> --alias <name>`, then `folders remove`, `folders enable`, `folders disable`, and the new `folders alias` command all accept the alias in place of the full absolute path. The full path keeps working everywhere — the alias is an additional shorthand, not a replacement. Aliases are unique across registered folders; a collision fails cleanly and leaves the config untouched. `folders list` shows an `ALIAS` column, and the `skills__configure` `add_folder` tool accepts an `alias` field.
- **Enable / disable toggle.** `skillforge folders enable <path|alias>` and `skillforge folders disable <path|alias>` flip a folder's `enabled` flag both ways. Previously `folders add --disabled` had no inverse and re-activating a folder meant hand-editing the config file. A disabled folder stays registered but is skipped on scan.
- **Folder-tag filter.** Folder `tags` used to be metadata that nothing read. `skills__list` now accepts a `folderTag` argument that keeps only skills under folders carrying that tag, and `skillforge folders list --tag <name>` filters the listing the same way. The documentation now draws the line clearly: `alias` is one unique handle per folder for addressing, `tags` are many shared labels for grouping.

**Engineering snapshot**

- 561 / 561 tests passing + 1 win32-skip.
- `pnpm lint` (`tsc --noEmit`) clean, `pnpm build` clean.
- All source files ≤ 400 lines — the folders CLI was split into four focused modules to hold the gate.

## v1.2.0 — Terminal tooling

**Release date:** 2026-05-16

Inspect and manage SkillForge from the shell, without opening an LLM session.

- **`skillforge tools`** — prints the five MCP tools the server exposes, each with its description, parameters, and an example invocation. `--json` for machine-readable output. Confirm the tool surface without starting a session.
- **`skillforge folders`** — manage skill folders from the terminal: `list`, `add`, `remove`, `reset`. Folder management was previously reachable only through the `skills__configure` MCP tool; both surfaces now read and write the same persisted config.
- **`--scope global|project`** on `install` / `uninstall`. The default `global` scope edits each host's home-directory config; `--scope project` wires SkillForge into a repo-local config rooted at the current directory.
- **Skill-source conflict detection.** Registering a folder that already lives inside another tool's native skill store surfaces a hint to disable the duplicate source — otherwise the same skills load twice. The hint is informational; it never blocks the add, and SkillForge never edits another tool's config.
- **Claude Code plugin packaging** — `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. SkillForge can be installed via `claude plugin install` with a rich `/plugins` UI card.

**Engineering snapshot**

- 535 / 535 tests passing + 1 win32-skip.
- `pnpm lint` / `pnpm build` clean, all source files ≤ 400 lines.

## v1.1.1 — Single-bin dispatcher

**Release date:** 2026-05-15

A fix for `npx @lyupro/skillforge-mcp install` hanging on stdin.

- The package shipped two bins (`skillforge-mcp` → server, `skillforge` → install CLI). `npx` matched the package's unscoped basename to the server bin, which silently waited on stdio. Both bins now resolve to a unified dispatcher that routes by the first positional argument.
- New `serve` subcommand for explicit MCP-server invocation (still the default when no command is given), and `skillforge-mcp --version`.
- Installer-generated host configs now write the `serve` argument explicitly; older entries still resolve to `serve` by default.

## v1.1.0 — One-command install

**Release date:** 2026-05-14

Wiring SkillForge into a host tool went from copy-pasting config snippets to a single command.

- **`skillforge install`** edits each host's config file directly — Claude Code (`~/.claude.json`), Codex CLI (`~/.codex/config.toml`), Cursor (OS-specific `settings.json`).
- Flags — `--claude`, `--codex`, `--cursor`, `--all`, `--dry-run`, `--uninstall`, `--force`, `--entry npx|local`, `--binary-path <path>`.
- Atomic-write helper with a `.backup` snapshot — a failed write never leaves the host config broken.
- OS-specific path detection for Cursor (Windows `%APPDATA%`, macOS `Library/Application Support`, Linux `~/.config`).

**Engineering snapshot**

- 451 / 451 tests passing + 1 win32-skip.
- `pnpm lint` / `pnpm build` clean, all source files ≤ 400 lines.

## v1.0.0 — Universal Skills, One Server

**Release date:** 2026-05-13

First public release. A Model Context Protocol server that loads Markdown skills from arbitrary folders and exposes them to **any MCP-capable LLM tool** — Claude Code, Codex CLI, Cursor, or your own MCP client. Skills load lazily on demand, so cold start stays fast even with hundreds of skills configured.

### Why it exists

Every LLM tool ships its own skill format and discovery mechanism. Team-shared skill bundles get duplicated across `~/.claude/`, `~/.codex/`, project repos, and a thousand pastebin gists. Tools auto-load 100+ skills on every cold start, burning tokens on metadata the model never uses.

| Pain | SkillForge fix |
|------|----------------|
| Tool-specific skill formats | Single Markdown + YAML frontmatter contract, four dialects auto-detected (Claude / Codex / persona / custom). |
| Eager auto-load on cold start | Metadata-only enumeration via `skills__list`; full body fetched on `skills__invoke`. |
| No team-shared skill registry | Multi-folder cascade with priority, blacklist filter, hot reload via filesystem watcher. |
| Script skills are a security hole | PatternScanner audit + sandbox (env whitelist, mkdtemp cwd, AbortSignal kill) + double opt-in. |

### What shipped in 1.0.0

- **5 MCP tools:** `skills__list`, `skills__get`, `skills__invoke`, `skills__configure`, `skills__reload`.
- **3 invocation strategies:** Prompt (default), Script (sandboxed), Hybrid (script-enriched prompt).
- **3 decorators:** Logging, Timeout, Cache (opt-in).
- **Composite skills:** `skills: [a, b, c]` walks nested skills sequentially with DFS cycle detection.
- **10 sample skills** across all three strategies.
- **5 worked configs** ready to paste — default, team-shared, priority cascade, scripts-enabled, multi-folder cascade.
- **Documentation:** README + INSTALL + SKILL_FORMAT + CONFIGURATION + ARCHITECTURE + SECURITY + 4 INTEGRATION guides.

### Engineering snapshot

- 370 / 370 tests passing + 1 win32-skip.
- 46 source files all ≤ 400 lines (modular architecture enforced via pre-commit hook).
- TypeScript ESM, Node ≥ 20.
- 9 design patterns documented inline (Registry / Strategy / Factory / Adapter / Decorator / Composite / Observer / OCP / DI).
- Honest security model — out-of-scope items called out explicitly (network egress, fs writes outside cwd, CPU/memory, prompt injection).

---

## Links

- Repository: <https://github.com/lyupro/skillforge-mcp>
- Marketplace: <https://github.com/lyupro/llm-plugins-marketplace>
- Issues: <https://github.com/lyupro/skillforge-mcp/issues>
- Security advisories: <https://github.com/lyupro/skillforge-mcp/security/advisories>
- Maintainer: <https://lyupro.com>
