#!/usr/bin/env bash
# Collect commits since the last semver tag for changelog-generator hybrid skill.
# stdout: "<sha> <subject>" one per line. stderr: diagnostics on failure.
set -euo pipefail

# SkillForge runs us in a temp cwd. The user's repo lives wherever they
# launched their LLM tool from — read PWD from SKILLFORGE_INPUT if the caller
# passed a path, otherwise rely on the caller having cd'd before invocation.
target_dir="${SKILLFORGE_INPUT:-$(pwd)}"

# Defensive: only operate inside a git repo.
if ! git -C "$target_dir" rev-parse --git-dir > /dev/null 2>&1; then
  echo "Not a git repository: $target_dir" >&2
  exit 2
fi

# Find the most recent tag matching v<digits>.<digits>.<digits>. If none, fall back to
# the root commit so the first release still gets a full history.
last_tag=$(git -C "$target_dir" describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || echo "")
if [ -z "$last_tag" ]; then
  range="HEAD"
else
  range="${last_tag}..HEAD"
fi

git -C "$target_dir" log --pretty=format:'%h %s' "$range"
