#!/usr/bin/env python3
"""markdown-linter — minimal stdlib-only Markdown linter for SkillForge.

Reads the .md file path from SKILLFORGE_INPUT. Prints findings on stdout, one
per line, in the format:

    <line>:<col>:<severity>:<rule>:<message>
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path


def lint_lines(lines: list[str]) -> list[tuple[int, int, str, str, str]]:
    findings: list[tuple[int, int, str, str, str]] = []

    last_heading_level = 0
    list_marker_in_block: str | None = None
    in_code_fence = False

    for lineno, raw in enumerate(lines, start=1):
        if raw.startswith("```"):
            in_code_fence = not in_code_fence
            list_marker_in_block = None
            continue
        if in_code_fence:
            continue

        # Strip trailing newline but preserve the rest for column counting.
        text = raw.rstrip("\n")

        # Trailing whitespace
        stripped = text.rstrip(" \t")
        if stripped != text:
            findings.append(
                (lineno, len(stripped) + 1, "warning", "trailing-whitespace",
                 "trailing whitespace")
            )

        # Tab indent
        if text.startswith("\t"):
            findings.append((lineno, 1, "warning", "tab-indent", "tab used for indent"))

        # Heading level order
        heading_match = re.match(r"^(#{1,6})\s", text)
        if heading_match:
            level = len(heading_match.group(1))
            if last_heading_level > 0 and level > last_heading_level + 1:
                findings.append(
                    (lineno, 1, "error", "heading-order",
                     f"H{level} follows H{last_heading_level} — level skipped")
                )
            last_heading_level = level

        # Missing alt text
        for m in re.finditer(r"!\[\s*\]\(([^)]+)\)", text):
            findings.append(
                (lineno, m.start() + 1, "warning", "missing-alt",
                 f"image {m.group(1)!r} has empty alt text")
            )

        # Bare URL — only when not already inside an angle-bracket or markdown link
        for m in re.finditer(r"(?<![<\(\]\[])(https?://[^\s\)<>]+)", text):
            findings.append(
                (lineno, m.start() + 1, "info", "bare-url",
                 f"bare URL {m.group(1)!r} — wrap in <> or [text](url)")
            )

        # Mixed list marker
        list_match = re.match(r"^([*\-+])\s", text)
        if list_match:
            marker = list_match.group(1)
            if list_marker_in_block is None:
                list_marker_in_block = marker
            elif marker != list_marker_in_block:
                findings.append(
                    (lineno, 1, "warning", "mixed-list-marker",
                     f"list switches from {list_marker_in_block!r} to {marker!r}")
                )
        elif text.strip() == "":
            list_marker_in_block = None

    return findings


def main() -> int:
    path = os.environ.get("SKILLFORGE_INPUT", "").strip()
    if not path:
        print("0:0:error:io:no input file (SKILLFORGE_INPUT empty)")
        return 0

    p = Path(path)
    if not p.is_file():
        print(f"0:0:error:io:file not found: {path}")
        return 0

    try:
        lines = p.read_text(encoding="utf-8").splitlines(keepends=False)
    except UnicodeDecodeError:
        print(f"0:0:error:io:not utf-8: {path}")
        return 0

    findings = lint_lines(lines)
    if not findings:
        print(f"0:0:info:ok:no findings in {p.name}")
        return 0

    for line, col, severity, rule, message in findings:
        print(f"{line}:{col}:{severity}:{rule}:{message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
