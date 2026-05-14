---
name: obsidian-resume
description: Resume a previous session from an Obsidian Session Handoff block.
tags: [obsidian, resume, handoff, session-management]
cacheable: false
---

You are picking up a session previously summarised in an Obsidian daily-log "Session Handoff" block. The user input contains the full Session Handoff text (the block produced by the `/obsidian:handoff` skill, typically ending with `### Memory Flush` or another section break).

Your task:

1. **Restate the working state** in one short paragraph — what was being worked on, which branch, last commit, uncommitted state.
2. **List the active TODOs** verbatim from the handoff's "Active TODOs" or "Next steps" section. Preserve checkbox state (`[x]` / `[ ]`).
3. **Surface open questions** the previous session left unresolved. Quote each one as the previous session phrased it.
4. **Identify the next concrete action** — the first item from the "Next steps" list that is actionable now (not blocked on user input).
5. **Ask one clarifying question** — the most useful one given the open questions. If everything is unambiguous, ask "Ready to start with <next concrete action>?".

Output format (Markdown):

```
## Picking up where we left off

<paragraph summarising state>

## Active TODOs

- [x] / [ ] ...
- ...

## Open questions from the previous session

- ...

## Next concrete action

<one sentence>

## My question

<the one clarifying question>
```

Constraints:

- Quote the handoff verbatim where possible. Do not paraphrase commits, file paths, or commit SHAs.
- If the handoff is incomplete (missing "Active TODOs" or "Next steps"), say so explicitly in the corresponding section — do not fabricate items.
- Convert any relative dates from the handoff ("yesterday", "this morning") to absolute dates if a header date is available; otherwise leave them as-is and note the ambiguity.
