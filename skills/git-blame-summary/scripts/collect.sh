#!/usr/bin/env bash
# git-blame-summary — collect blame + recent-commit data for the hybrid skill.
# Reads target file path from SKILLFORGE_INPUT. Prints structured plain-text on stdout.
set -uo pipefail

target_file="${SKILLFORGE_INPUT:-}"

if [ -z "$target_file" ]; then
  echo "error=SKILLFORGE_INPUT empty — supply a file path"
  exit 0
fi

if [ ! -f "$target_file" ]; then
  echo "error=file_not_found: $target_file"
  exit 0
fi

repo_dir=$(dirname "$target_file")
if ! git -C "$repo_dir" rev-parse --git-dir > /dev/null 2>&1; then
  echo "error=not_a_git_repo: $repo_dir"
  exit 0
fi

echo "## Authorship by line count"
git -C "$repo_dir" blame --line-porcelain "$target_file" 2>/dev/null \
  | awk '/^author / { sub(/^author /, ""); print }' \
  | sort | uniq -c | sort -rn

echo
echo "## Last touched"
git -C "$repo_dir" log -1 --format='%ar by %an' -- "$target_file"

echo
echo "## Five most recent commits touching this file"
git -C "$repo_dir" log -5 --pretty=format:'%h %ar %an: %s' -- "$target_file"
