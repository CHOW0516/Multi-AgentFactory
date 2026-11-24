#!/usr/bin/env python3
"""File ownership checks (stdlib only). Used by check-ownership.sh and check-overlap.sh.

  ownership.py owner <path>                      print the owner of a path
  ownership.py check <owner_id> <base_ref>       fail if this branch changed files outside <owner_id>'s paths
  ownership.py overlap <base_ref> <branch>...    fail if any file is changed by more than one branch
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def load_rules() -> dict:
    rules = json.loads((REPO_ROOT / "ownership.json").read_text())
    return {owner: value for owner, value in rules.items() if not owner.startswith("_")}


def entry_matches(entry: str, path: str) -> bool:
    return path.startswith(entry) if entry.endswith("/") else path == entry


def owners_of(path: str, rules: dict) -> list[str]:
    found = []
    for owner, rule in rules.items():
        in_paths = any(entry_matches(entry, path) for entry in rule["paths"])
        excluded = any(entry_matches(entry, path) for entry in rule.get("except", []))
        if in_paths and not excluded:
            found.append(owner)
    if "/" not in path and "p1" not in found:
        found.append("p1")
    return found


def changed_files(base_ref: str, head_ref: str = "HEAD") -> list[str]:
    output = subprocess.run(
        ["git", "diff", "--name-only", f"{base_ref}...{head_ref}"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    ).stdout
    return [line for line in output.splitlines() if line]


def command_owner(path: str) -> int:
    print(", ".join(owners_of(path, load_rules())) or "nobody")
    return 0


def command_check(owner_id: str, base_ref: str) -> int:
    rules = load_rules()
    if owner_id not in rules:
        print(f"Unknown owner '{owner_id}'. Use one of: {', '.join(rules)}")
        return 2
    violations = [path for path in changed_files(base_ref) if owner_id not in owners_of(path, rules)]
    if violations:
        print(f"{owner_id} changed files it does not own:")
        for path in violations:
            print(f"  {path}  (owner: {', '.join(owners_of(path, rules)) or 'nobody'})")
        return 1
    print(f"OK: every changed file belongs to {owner_id}.")
    return 0


def command_overlap(base_ref: str, branches: list[str]) -> int:
    changed_by: dict[str, list[str]] = {}
    for branch in branches:
        for path in changed_files(base_ref, branch):
            changed_by.setdefault(path, []).append(branch)
    overlaps = {path: names for path, names in changed_by.items() if len(names) > 1}
    if overlaps:
        print("Files changed by more than one branch:")
        for path, names in sorted(overlaps.items()):
            print(f"  {path}: {', '.join(names)}")
        return 1
    print(f"OK: no file is changed by more than one of {len(branches)} branches.")
    return 0


def main(arguments: list[str]) -> int:
    if len(arguments) >= 2 and arguments[0] == "owner":
        return command_owner(arguments[1])
    if len(arguments) == 3 and arguments[0] == "check":
        return command_check(arguments[1], arguments[2])
    if len(arguments) >= 3 and arguments[0] == "overlap":
        return command_overlap(arguments[1], arguments[2:])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
