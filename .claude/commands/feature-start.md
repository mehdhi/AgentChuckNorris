---
description: Start a numbered feature branch (feat/NN-slug) off the correct base per the stacked-PR workflow
argument-hint: <slug>
allowed-tools: Bash(git status:*), Bash(git fetch:*), Bash(git branch:*), Bash(git switch:*), Bash(gh pr list:*)
---

Start a new feature branch following `docs/GIT-WORKFLOW.md` (numbered stacked PRs, base branch `main`).

Slug for this feature: `$1` (kebab-case; if empty, ask the user for one before continuing).

Do this:

1. **Guard a clean tree.** Run `git status --porcelain`. If it is non-empty, STOP and tell the user
   to commit or stash first — do not create a branch on top of uncommitted work.

2. **Fetch.** `git fetch origin --prune`.

3. **Compute the next number `NN`** (two-digit, zero-padded, monotonic). Gather every existing
   number from both branch names and PR titles, take the max, add 1; if none exist, `NN=01`:
   - branches: `git branch -a --format='%(refname:short)'` → match `feat/NN-…`
   - PRs: `gh pr list --state all --json title --jq '.[].title'` → match `[NN]`

4. **Pick the base.** The **chain tip** is the highest-numbered `feat/NN-…` branch that still has an
   **open** PR (`gh pr list --state open --json headRefName --jq '.[].headRefName'`).
   - Chain tip exists → base = that branch (use its up-to-date ref).
   - No open feature PRs → base = `origin/main`.

5. **Create the branch.** `git switch -c feat/NN-$1 <base>`.

6. **Report** to the user, concisely:
   - the new branch name,
   - the base it was cut from and **why** (chain tip `feat/(NN-1)-…` vs fresh `origin/main`),
   - the PR base to use later (the parent feature branch when chained, else `main`),
   - next step: implement + commit, then run `/feature-pr`.

Do NOT push or open a PR here — that is `/feature-pr`.
