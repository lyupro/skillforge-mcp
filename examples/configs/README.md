# Example configs

Drop-in `config.json` files for common SkillForge setups. Copy the one closest to your situation to the canonical config path:

- All platforms: `~/.lyupro/.skillforge/config.json` (resolved via `os.homedir()`)

Then restart your host (Claude Code session / Codex CLI / Cursor) so SkillForge re-reads on boot. For folder changes, `skills__configure` can mutate without restart — see [CONFIGURATION.md](../../docs/CONFIGURATION.md).

| File | Use when |
|------|----------|
| [`default.json`](./default.json) | First-time install — schema defaults made explicit so you can see what every field defaults to. |
| [`team-shared-folder.json`](./team-shared-folder.json) | You want SkillForge to scan **only** a team-shared skill folder, skipping the user-default `~/.claude/plugins/cache/...`. |
| [`team-priority-with-default-fallback.json`](./team-priority-with-default-fallback.json) | Team folder wins on name conflicts, user default folder is still searched. |
| [`scripts-enabled.json`](./scripts-enabled.json) | You've audited your script-skills and want to enable `ScriptStrategy` / `HybridStrategy`. Includes a tightened audit-pattern list. |
| [`multifolder-cascade.json`](./multifolder-cascade.json) | Multi-folder cascade — repo-local skills, user skills, team skills, with priorities reflecting the precedence order. |

Each file is a complete `config.json` — paste verbatim, edit paths/values to match your environment.
