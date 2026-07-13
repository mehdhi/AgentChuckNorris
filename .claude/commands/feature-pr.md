---
description: Push the current feat/NN branch and open its stacked PR ([NN] title) against the correct base
argument-hint: [PR title]
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git log:*), Bash(git push:*), Bash(gh pr list:*), Bash(gh pr create:*)
---

Raise the stacked PR for the current feature branch, following `docs/GIT-WORKFLOW.md`.

Optional PR title override: `$ARGUMENTS` (if empty, derive a Title Case title from the branch slug).

Do this:

1. **Verify the branch.** `git rev-parse --abbrev-ref HEAD` must match `feat/NN-…`. If not, STOP —
   this command only runs on a feature branch. Extract `NN` and the slug from the name.

2. **Determine the PR base.**
   - Find the next-lower feature branch `feat/(NN-1)-…` that has an **open** PR
     (`gh pr list --state open --json headRefName,number --jq '.[]'`).
   - If it exists → base = that parent branch; capture its PR number as `<parentPR>` (this branch is
     **stacked**).
   - If it does not exist → base = `main`.

3. **Confirm there are commits** to propose: `git log --oneline <base>..HEAD` must be non-empty.
   If empty, STOP and tell the user there is nothing to open a PR for.

4. **Push.** `git push -u origin <branch>`.

5. **Open the PR:**
   ```
   gh pr create --base <base> --head <branch> --title "[NN] <title>" --body "<summary>"
   ```
   - `<title>`: `$ARGUMENTS` if provided, else Title Case of the slug.
   - `<summary>`: a short description of the change. When stacked, append a final line
     `Stacked on: #<parentPR>`.

6. **Report** the PR URL, then remind the user:
   - to chain the next feature: `/feature-start <next-slug>` (it will branch off THIS branch),
   - **merge the lowest `NN` first**; after a parent merges, rebase this branch onto `origin/main`
     and `git push --force-with-lease` (see `docs/GIT-WORKFLOW.md`).
