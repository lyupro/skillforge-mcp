#!/usr/bin/env bash
# dependency-checker — npm audit summariser for SkillForge script-strategy skill.
# Reads target directory from SKILLFORGE_INPUT. Prints one line on stdout.
set -uo pipefail

target_dir="${SKILLFORGE_INPUT:-$(pwd)}"

if [ ! -f "$target_dir/package.json" ]; then
  echo "error=no_package_json_at:$target_dir"
  exit 0
fi

if ! command -v jq > /dev/null 2>&1; then
  echo "error=jq_not_installed"
  exit 0
fi

audit_json=$(npm audit --json --prefix "$target_dir" 2>/dev/null || true)

if [ -z "$audit_json" ]; then
  echo "error=npm_audit_no_output"
  exit 0
fi

# npm audit JSON shape: .metadata.vulnerabilities.{info,low,moderate,high,critical}
# and .metadata.totalDependencies. Defensive jq with // 0 fallback.
echo "$audit_json" | jq -r '
  .metadata.vulnerabilities as $v
  | .metadata as $m
  | "high=\($v.high // 0) critical=\($v.critical // 0) total=\(($v.info // 0)+($v.low // 0)+($v.moderate // 0)+($v.high // 0)+($v.critical // 0)) packages=\($m.totalDependencies // 0)"
'
