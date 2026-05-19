# Skill format

A SkillForge **skill** is a Markdown file (`.md`) with a YAML frontmatter block. Every skill is just one file on disk; optional sibling `scripts/` directories add executable behavior. SkillForge auto-detects four dialects (Claude / Codex / persona / custom) so existing skill libraries from Claude Code and Codex CLI work without conversion.

This document is the source of truth for the **field-level frontmatter contract**. For the wiring between the parser and the runtime (Strategy / Decorator / Composite), see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Minimum viable skill

```markdown
---
name: my-skill
---

Body text. Returned verbatim by the default PromptStrategy.
```

The single required field is `name`. Everything else is optional.

---

## Frontmatter fields (canonical reference)

All fields use **camelCase** in canonical form. Two long-standing snake_case aliases are accepted (see [Aliases](#aliases) below) to ease migration from earlier Claude/Codex layouts.

| Field | Type | Required | Default | Purpose |
|-------|------|----------|---------|---------|
| `name` | `string` | ✅ | — | Unique skill identifier — primary key in the registry. Must be non-empty after trim. |
| `description` | `string` | ❌ | unset | One-line summary shown in `skills__list`. |
| `tags` | `string[]` or `string` | ❌ | unset | Free-form labels. Comma-separated string also accepted (`tags: "ios, design"`). |
| `format` | `'claude' \| 'codex' \| 'persona' \| 'custom'` | ❌ | auto | Override the auto-detected dialect. Usually leave unset. |
| `strategy` | `'prompt' \| 'script' \| 'hybrid'` | ❌ | auto | Force a specific strategy. Without it, `StrategyFactory` picks via `canHandle()` priority order `[hybrid, script, prompt]`. |
| `allowScripts` | `boolean` | ❌ | `false` | Per-skill opt-in for `ScriptStrategy`. Both this **and** `config.security.allowScripts` must be `true` for any script to run. |
| `allowNetwork` | `boolean` | ❌ | `false` | Documentation signal that the script expects network access. **Not enforced at runtime** — the sandbox cannot block egress. See [SECURITY.md](./SECURITY.md). |
| `skills` | `string[]` | ❌ | unset | Composite skill — names of nested skills invoked sequentially before this skill's own output. Triggers `resolveComposite` with DFS cycle detection. |
| `timeoutMs` | `number > 0` | ❌ | global `invocation.defaultTimeoutMs` (30 000 ms) | Per-skill wall-clock budget. `TimeoutDecorator` aborts via `AbortSignal` at expiry. `≤ 0` disables the timeout for this skill. |
| `cacheable` | `boolean` | ❌ | `false` | Opt-in for `CacheDecorator`. Enables caching of successful `InvocationResult` per `(name, input)` pair. |
| `cacheTtlMs` | `number > 0` | ❌ | global `invocation.cacheTtlMs` (60 000 ms) | Per-skill cache TTL override. Setting any positive value also implies `cacheable: true`. |
| `scripts` | `string[]` | ❌ | unset | Filenames inside the sibling `scripts/` directory. **Single-entry only** in v1 — index `[0]` is executed; multi-entry semantics are deferred. Auto-detection of `ScriptStrategy` triggers when this is non-empty. |

Anything not in the table above falls through to `extra: Record<string, unknown>` on `SkillContent` and is returned by `skills__get` for downstream consumers to inspect.

### Aliases

For continuity with earlier draft formats and existing Claude / Codex skills:

| Canonical (camelCase) | Accepted alias (snake_case) |
|-----------------------|------------------------------|
| `allowScripts` | `allow_scripts` |
| `allowNetwork` | `allow_network` |
| `timeoutMs` | `timeout_ms` |
| `cacheTtlMs` | `cache_ttl_ms` |

The parser normalises aliases on read — internal `SkillContent` always exposes the camelCase form. No other transforms are applied to the JSON config or frontmatter — the persisted store ([CONFIGURATION.md](./CONFIGURATION.md)) is camelCase end-to-end.

---

## Dialect auto-detection

`FormatDetector` assigns the `format` value when frontmatter omits it. Detection is driven by the [skill-format registry](#skill-format-registry); the table below summarises the four built-in formats:

| Detected `format` | Trigger |
|-------------------|---------|
| `claude` | Filename is exactly `SKILL.md` |
| `codex` | Filename is exactly `AGENTS.md` |
| `persona` | Frontmatter has a non-empty `persona:` string field |
| `custom` | Everything else (any other `.md` filename) |

Detection is a hint only — it surfaces in `skills__list` (`source: claude`/`codex`/`persona`/`custom` filter) and does not change runtime behaviour. Skills from any dialect go through the same Registry / Strategy / Decorator pipeline.

Operator-defined formats (added via the [registry](#skill-format-registry)) report under the `custom` dialect in `skills__list` — the registry surfaces the precise `id` separately as `formatId`. A `name` derived from the parent directory also carries `nameSource: "directory"`; an explicit frontmatter `name` carries `nameSource: "frontmatter"`. Both fields appear in `skills__get` / `skills__list` JSON output.

---

## Skill format registry

"What counts as a skill file" is **not hardcoded** — it is a config-driven list of format descriptors. The registry is the union of the four built-in defaults and any operator-supplied entries in `config.skillFormats`. Supporting a new LLM's layout (e.g. Gemini Gem files) is therefore a config edit, not a code release.

Each descriptor carries:

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier (kebab-case). Reusing a built-in id replaces that built-in. |
| `match` | Discriminated union: `{type:"filename"}`, `{type:"filenameGlob"}`, or `{type:"frontmatterField"}`. |
| `nameField` | Frontmatter key holding the skill name (default `name`). |
| `deriveNameFromDir` | Allow directory-name derivation when the `nameField` is empty/absent. Only meaningful for filename / filename-glob matches. |
| `enabled` | Disabled descriptors never match. |
| `priority` | Highest priority wins when a file matches more than one descriptor. |

### Built-in defaults

| `id` | `match` | `deriveNameFromDir` | `priority` |
|------|---------|---------------------|------------|
| `claude` | `filename: SKILL.md` | `true` | `100` |
| `codex` | `filename: AGENTS.md` | `true` | `100` |
| `persona` | `frontmatterField: persona` | `false` | `90` |
| `custom` | `filenameGlob: *.md` | `false` | `10` |

### Adding a format without code

Use the `formats` CLI or edit `config.json` directly.

```bash
skillforge formats add gemini-gem --filename GEMINI.md --derive-name-from-dir
skillforge formats add skill-suffix --filename-glob "*.skill.md" --priority 200
skillforge formats list
skillforge formats disable custom
```

The same operations can be performed by hand under `config.skillFormats` — see [CONFIGURATION.md](./CONFIGURATION.md#skillformats).

### Name resolution and directory derivation

When a file matches a format descriptor `F`, the skill name comes from frontmatter `F.nameField`. When that field is empty or absent:

- if `F.deriveNameFromDir` is `true` **and** `F.match.type` is `filename` or `filenameGlob`, the name is derived from the parent directory, kebab-normalized (`migration-architect/SKILL.md` registers as `migration-architect`);
- otherwise the parser throws and the file is skipped on stderr.

A frontmatter-field match (e.g. `persona`) never derives — the parser cannot give such a file a stable identity from its path alone. Generic `.md` files matched only by `custom` likewise never derive, so a sibling `README.md` never becomes a skill.

### Match conflicts and name collisions

A file that matches several enabled formats resolves to the highest-priority descriptor; remaining descriptors are ignored. A skill `name` that registers from more than one folder resolves to the highest-priority folder via `SkillResolver`, and the collision is surfaced on stderr — the losing copies stay on disk but do not register.

---

## Strategy selection

A skill ends up under one of three strategies. The decision tree:

```
Frontmatter has `strategy:` set?
├── 'prompt'  → PromptStrategy
├── 'script'  → ScriptStrategy
├── 'hybrid'  → HybridStrategy
└── unset (most skills)
        │
        ▼
    StrategyFactory iterates [hybrid, script, prompt] and picks the first
    canHandle(skill) === true.
        │
        ├── HybridStrategy.canHandle  → only when `strategy: 'hybrid'` explicit
        ├── ScriptStrategy.canHandle  → `scripts: [..]` non-empty
        └── PromptStrategy.canHandle  → universal fallback, always claims
```

In practice:

- Skill with no `scripts:` and no `strategy:` → PromptStrategy (body returned as the prompt blob).
- Skill with `scripts: [main.py]` and no `strategy:` → ScriptStrategy auto-detect.
- Skill with `strategy: 'hybrid'` and `scripts: [main.py]` → HybridStrategy (runs script, then composes body + script output + user input into a prompt blob).
- Skill with `strategy: 'prompt'` and `scripts: [main.py]` → PromptStrategy wins (explicit overrides auto-detect; the `scripts` field is ignored at invocation, present only as metadata).

---

## Examples — one per pattern

### Prompt skill (most common)

```markdown
---
name: apple-hig-check
description: Audit code against Apple Human Interface Guidelines.
tags: [ios, design, audit]
cacheable: true
cacheTtlMs: 300000
---

You are an Apple HIG expert. Given the supplied source snippet, evaluate
it against the latest Apple Human Interface Guidelines along these axes:

1. Visual hierarchy and contrast (WCAG AA minimum).
2. Touch target sizing (44pt minimum).
3. Dark Mode behavior and dynamic type readiness.
4. Native control fitness vs. custom UI.

Return a numbered list of issues with severity (critical / warning /
nit) and quote the exact lines that triggered each finding.
```

Result: `PromptStrategy` returns the body verbatim. `CacheDecorator` caches the InvocationResult per `(name, input)` for 5 minutes — re-invoking with the same snippet returns instantly.

### Script skill

```markdown
---
name: dependency-checker
description: Run `npm audit --json` and summarise high/critical issues.
tags: [security, dependencies]
allowScripts: true
strategy: script
scripts:
  - main.sh
timeoutMs: 30000
---

The script in scripts/main.sh runs `npm audit --json` in the temp cwd
and prints a one-line summary on stdout. SkillForge will return the
captured stdout as the invocation output.
```

`scripts/main.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
npm audit --json 2>/dev/null \
  | jq -r '.metadata.vulnerabilities | "high=\(.high) critical=\(.critical)"' \
  || echo "high=0 critical=0"
```

Result: `ScriptStrategy` spawns `bash` under `SandboxRunner` with `cwd=mkdtemp` and `env={PATH, SKILLFORGE_INPUT=<input>}`. stdout is captured (tail-truncated at 1 MB). Non-zero exit codes surface in `error`.

Prerequisites:
- `config.security.allowScripts: true` (global gate).
- `allowScripts: true` in this skill's frontmatter.
- Interpreter on PATH (`bash` on POSIX; on Windows the host's PATH is passed through — see [SECURITY.md](./SECURITY.md#windows-path)).

Supported extensions: `.py` (python3), `.sh` (bash), `.js` / `.mjs` (node).

### Hybrid skill

```markdown
---
name: git-changelog-generator
description: Generate CHANGELOG.md entry from git log + LLM polish.
tags: [git, release]
allowScripts: true
strategy: hybrid
scripts:
  - collect.sh
---

You are a release-notes writer. The Script output section below contains
the raw `git log` since the last tag, one commit per line. Group commits
into Features / Fixes / Breaking changes / Internal. Drop chore commits.
Write tight, user-facing bullets — no SHAs, no commit subjects verbatim.
Return Markdown only.
```

`scripts/collect.sh` collects `git log` since `git describe --tags --abbrev=0` and prints it to stdout.

Result: `HybridStrategy` runs `collect.sh` first via `ScriptStrategy`. On success it composes:

```
<body — release-notes writer instructions>

## Script output

<git log output>

## User input

<user-supplied input, e.g. "v1.4.0 release notes please">
```

On script failure, `HybridStrategy` short-circuits and returns the failure `InvocationResult` directly — no prompt blend.

### Composite skill

```markdown
---
name: full-pr-review
description: Run security + style + test-coverage reviewers sequentially.
tags: [review, pr]
skills:
  - security-auditor
  - refactor-suggester
  - test-coverage-reviewer
---

You are a release reviewer. Each subordinate skill above has produced
its own section. Read all of them and produce a final ship/no-ship
verdict with a short rationale citing the highest-severity findings.
```

Result: `resolveComposite` walks `skills` sequentially with DFS cycle detection. Each nested invocation goes through the **full DecoratorChain** (Logging → Timeout → Cache → strategy). Outputs are concatenated under `## Skill: <name>` headings, separated by horizontal-rule rows:

```
## Skill: security-auditor

<output of security-auditor>

---

## Skill: refactor-suggester

<output of refactor-suggester>

---

## Skill: test-coverage-reviewer

<output of test-coverage-reviewer>

---

<parent body>
```

If any nested skill fails, the composite short-circuits with `error: 'nested skill X failed: <reason>'`. Self-references (`skills: [full-pr-review]`) or longer cycles (`a → b → c → a`) raise `CyclicSkillDependencyError` and return `ok: false` with a cycle path in `error`.

### Persona skill

```markdown
---
name: tech-lead-mode
description: Roleplay a strict tech lead reviewer.
persona: Senior staff engineer with 15 years in distributed systems.
tags: [persona, review]
---

You are a senior staff engineer reviewing junior code. Be direct, cite
concrete examples from the diff, and avoid soft language.
```

`FormatDetector` tags this as `format: persona` because frontmatter has a non-empty `persona:` field. Runtime is identical to a prompt skill — the dialect is just discoverability metadata.

---

## Body content rules

- Everything after the closing `---` of the frontmatter block is the body.
- A single leading newline after the frontmatter is stripped (a `\n+` prefix is dropped) — this lets you write `---\n\nBody starts here` without a leading blank line in the rendered output.
- No further normalisation: trailing whitespace, code fences, tables, anything goes. Whatever PromptStrategy receives is what the LLM gets, byte-for-byte.

---

## Conflict resolution across folders

If the same `name:` exists in multiple configured folders, `SkillResolver` picks the winner:

1. Highest `priority` from the persisted folder config wins.
2. On ties, input order (the order folders appear in the resolved list) wins.
3. The losing copies stay on disk; they just don't get registered.

`skills__list` shows the winner's `folder` field so you can see which folder owned a given skill. To debug a conflict, run `skills__reload` — the response includes any per-file errors (parser failures, blacklist hits) under `errors`.

---

## What the parser does NOT do

- **No template rendering.** Mustache / Handlebars / `${var}` substitution is the consuming agent's job. SkillForge returns the prompt body literally.
- **No prompt sanitisation.** If your skill body contains `{{evil}}` markers, they pass through to the LLM.
- **No frontmatter merging across files.** Each `.md` is parsed in isolation.
- **No symbolic links resolution beyond what Node does.** If you symlink one skill from another folder, the resolver sees both copies.

---

## Validation rules summary

| Field | Validation |
|-------|------------|
| `name` | Required, non-empty after trim — throws with the file path in the message otherwise. |
| `tags` | Array-of-strings or comma-separated string; anything else → `undefined`. |
| `strategy` | Must be `'prompt'` / `'script'` / `'hybrid'` literal; otherwise `undefined`. |
| `allowScripts` / `allowNetwork` | Coerced via `Boolean(...)` — non-bool truthy values become `true`. |
| `skills` | Array of strings; mixed-type arrays → `undefined`. |
| `timeoutMs` | Finite positive number; `0`, negative, `Infinity`, `NaN` → `undefined`. |
| `scripts` | Array of strings; mixed-type arrays → `undefined`. Single-entry consumed in v1. |
| `cacheable` | Must be a boolean literal; non-bool → `undefined`. |
| `cacheTtlMs` | Finite positive number; `0`, negative, `Infinity`, `NaN` → `undefined`. |

When validation drops a field, the skill still loads — only the dropped field is missing. Cross-field requirements (e.g. `ScriptStrategy` needs both `allowScripts: true` and a sibling `scripts/` directory) are checked at invocation time and surfaced as `ok: false, error: '<reason>'`.
