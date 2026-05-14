---
name: markdown-linter
description: Lint a Markdown file for common structural issues — heading order, trailing whitespace, missing alt text.
tags: [markdown, lint, docs]
strategy: script
allowScripts: true
scripts:
  - main.py
timeoutMs: 10000
---

This is a script-strategy skill. The script in `scripts/main.py` reads the Markdown file path from `SKILLFORGE_INPUT`, runs a built-in linter against it (no third-party dependencies — only the Python standard library), and prints findings to stdout, one per line.

Output format (one finding per line):

```
<line_number>:<column>:<severity>:<rule>:<message>
```

Severities: `error`, `warning`, `info`. Rules:

- `heading-order` — H2 follows H1, H3 follows H2, no skipped levels.
- `trailing-whitespace` — lines ending in space or tab.
- `tab-indent` — tabs used for indent (Markdown prefers spaces).
- `missing-alt` — `![](url)` with empty alt text.
- `bare-url` — http(s) URL not wrapped in `<...>` or `[text](url)`.
- `mixed-list-marker` — list switches between `-`, `*`, `+` inside the same block.

When the file does not exist or `SKILLFORGE_INPUT` is empty, the script prints `0:0:error:io:no input file` and exits 0.

Prerequisites:

- `config.security.allowScripts: true`.
- `python3` on the host's resolved `PATH`.
- `SKILLFORGE_INPUT` set to the absolute path of the `.md` file to lint.
