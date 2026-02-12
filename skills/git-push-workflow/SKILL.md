---
name: git-push-workflow
description: Execute a consistent Git delivery sequence from local validation through commit, push, and PR metadata preparation. Use when asked to "commit/push/create PR" or to streamline repetitive Git handoff steps in this repository.
---

# Git Push Workflow

Run this workflow when code changes are ready for delivery.

## 1) Pre-flight checks

1. Confirm branch and working tree status.
2. Review diffs before staging.
3. Run the minimum relevant tests for changed files.

```bash
git branch --show-current
git status --short
git diff --stat
```

## 2) Stage and validate

1. Stage only intentional files.
2. Re-check staged diff.

```bash
git add <files>
git diff --cached --stat
git diff --cached
```

## 3) Commit

Use a clear imperative commit title.

```bash
git commit -m "<summary>"
```

## 4) Push

Prefer pushing current branch to origin with upstream on first push.

```bash
git push -u origin "$(git branch --show-current)"
```

If upstream already exists, use:

```bash
git push
```

## 5) PR metadata

After push, gather commit list and summary for PR body.

```bash
git log --oneline --decorate -n 10
git show --stat --name-only --oneline -n 1
```

Then create PR title/body in the required tool or platform.

## Optional helper script

Use `scripts/git_push_sequence.sh` for a guided sequence. It does not auto-commit or auto-push; it prints commands and runs safe inspection steps so the operator can confirm each action.
