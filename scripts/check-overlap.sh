#!/usr/bin/env bash
# Usage: scripts/check-overlap.sh <branch> <branch> ...   (base is origin/main, or set BASE_REF)
# Fails if any file is changed by more than one of the branches. P1 runs this before merging.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -lt 2 ]; then echo "usage: scripts/check-overlap.sh <branch> <branch> ..." >&2; exit 2; fi
base_ref="${BASE_REF:-origin/main}"
git fetch --quiet origin 2>/dev/null || true
branches=()
for branch in "$@"; do
  if git rev-parse --verify --quiet "origin/$branch" >/dev/null; then branches+=("origin/$branch"); else branches+=("$branch"); fi
done
exec python3 scripts/ownership.py overlap "$base_ref" "${branches[@]}"
