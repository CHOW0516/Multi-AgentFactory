#!/usr/bin/env bash
# Usage: scripts/check-ownership.sh <p1|p2|p3|p4|p5> [base_ref]
# Fails if the current branch changed any file outside that person's paths (see ownership.json).
# base_ref defaults to origin/main.
set -euo pipefail
cd "$(dirname "$0")/.."
owner_id="${1:?usage: scripts/check-ownership.sh <p1..p5> [base_ref]}"
base_ref="${2:-origin/main}"
git fetch --quiet origin main 2>/dev/null || true
exec python3 scripts/ownership.py check "$owner_id" "$base_ref"
