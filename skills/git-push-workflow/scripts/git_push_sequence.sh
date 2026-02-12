#!/usr/bin/env bash
set -euo pipefail

echo "== Git push workflow helper =="
echo

echo "[1/5] Branch"
git branch --show-current

echo
echo "[2/5] Working tree"
git status --short

echo
echo "[3/5] Diff summary"
git diff --stat

echo
echo "[4/5] Suggested next commands"
cat <<'CMDS'
# Stage intended files
git add <files>

# Review staged changes
git diff --cached --stat
git diff --cached

# Commit
git commit -m "<summary>"

# Push (first time on branch)
git push -u origin "$(git branch --show-current)"

# Push (after upstream is set)
git push
CMDS

echo
echo "[5/5] Recent commits"
git log --oneline --decorate -n 5
