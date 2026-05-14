---
name: dependency-checker
description: Run `npm audit --json` against the target project and summarise high/critical vulnerabilities.
tags: [security, dependencies, npm]
strategy: script
allowScripts: true
scripts:
  - main.sh
timeoutMs: 30000
---

This is a script-strategy skill. The script in `scripts/main.sh` runs `npm audit --json` inside the directory supplied via `SKILLFORGE_INPUT` (or the SkillForge temp `cwd` if input is empty), parses the output with `jq`, and prints a one-line summary to stdout.

Output format (one line):

```
high=<N> critical=<M> total=<T> packages=<P>
```

When `npm audit` errors (no `package.json`, no `node_modules`, network failure), the script prints `error=<reason>` and exits 0 — SkillForge returns the line as a successful invocation, the consuming agent decides what to do with the diagnostic.

Prerequisites:

- `config.security.allowScripts: true` in the SkillForge persisted config.
- `npm` and `jq` on the host's resolved `PATH` (on POSIX, the SandboxRunner restricts `PATH` to `/usr/bin:/bin` — install `jq` system-wide or override `DEFAULT_PATH` for this skill).
- `SKILLFORGE_INPUT` set to an absolute path of the project to audit, or unset to audit the temp cwd (which will report no `package.json` — usually pass the path explicitly).
