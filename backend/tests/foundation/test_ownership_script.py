"""The ownership checker catches files outside a person's paths and files changed by two branches."""

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def git(repo: Path, *arguments: str) -> str:
    return subprocess.run(["git", *arguments], cwd=repo, capture_output=True, text=True, check=True).stdout


def make_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    shutil.copy(REPO_ROOT / "ownership.json", repo / "ownership.json")
    shutil.copy(REPO_ROOT / "scripts" / "ownership.py", repo / "scripts" / "ownership.py")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "test@example.com")
    git(repo, "config", "user.name", "Test")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    return repo


def run_checker(repo: Path, *arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "scripts/ownership.py", *arguments], cwd=repo, capture_output=True, text=True
    )


def commit_file(repo: Path, branch: str, relative_path: str) -> None:
    git(repo, "checkout", "-q", "-B", branch, "main")
    file_path = repo / relative_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(branch)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", branch)


def test_owner_lookup_handles_exceptions(tmp_path):
    repo = make_repo(tmp_path)
    assert run_checker(repo, "owner", "desktop/src/pages/approvals/route.tsx").stdout.strip() == "p4"
    assert run_checker(repo, "owner", "desktop/src/pages/agent-map/route.tsx").stdout.strip() == "p5"
    assert run_checker(repo, "owner", "docker-compose.yml").stdout.strip() == "p1"
    assert run_checker(repo, "owner", "backend/app/api/orders.py").stdout.strip() == "p2"


def test_check_fails_for_file_outside_owned_paths(tmp_path):
    repo = make_repo(tmp_path)
    commit_file(repo, "p2-work", "backend/app/agents/order/agent.py")
    assert run_checker(repo, "check", "p2", "main").returncode == 0
    (repo / "backend/app/main.py").parent.mkdir(parents=True, exist_ok=True)
    (repo / "backend/app/main.py").write_text("x")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "oops")
    result = run_checker(repo, "check", "p2", "main")
    assert result.returncode == 1 and "backend/app/main.py" in result.stdout


def test_overlap_detects_same_file_in_two_branches(tmp_path):
    repo = make_repo(tmp_path)
    commit_file(repo, "branch-a", "docs/shared.md")
    commit_file(repo, "branch-b", "docs/shared.md")
    commit_file(repo, "branch-c", "docs/other.md")
    assert run_checker(repo, "overlap", "main", "branch-a", "branch-c").returncode == 0
    result = run_checker(repo, "overlap", "main", "branch-a", "branch-b")
    assert result.returncode == 1 and "docs/shared.md" in result.stdout
