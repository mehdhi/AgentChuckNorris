# Git Workflow — numbered stacked PRs

The base branch is **`main`**. Every feature gets its own numbered branch, raises a PR
immediately, and the next feature **chains** off it so later work already contains earlier work.
PRs are **stacked**: a chained PR targets its parent branch, and GitHub auto-retargets it to
`main` when the parent merges. The number `NN` encodes merge order.

> Two Claude Code commands automate the mechanics: `/feature-start <slug>` and `/feature-pr`.
> This doc is the reference they follow — you can also run the git/gh commands by hand.

## Branch & PR naming

- Branch: `feat/NN-slug` — `NN` is a two-digit, zero-padded, monotonic number (`01`, `02`, …); `slug` is kebab-case.
- PR title: `[NN] <human title>`.

## Numbering

The next number is:

```
max( NN across all local + remote feat/NN-* branches AND all open PR titles matching [NN] ) + 1
```

starting at `01`. Numbering never reuses a value, even after a feature merges.

## Base selection when starting a feature

- **Chain tip** = the highest-numbered feature branch that still has an open (unmerged) PR.
- If a chain tip exists → branch **from it** (after `git fetch`); the new branch inherits its commits, so it won't conflict with the parent.
- If nothing is outstanding (all features merged) → branch fresh from updated `origin/main`.

## Lifecycle

```bash
# 1. Start (from chain tip if one is open, else origin/main)
git fetch origin
git switch -c feat/NN-slug <base>      # <base> = feat/(NN-1)-... or origin/main

# 2. Implement + commit normally

# 3. Raise the PR immediately
git push -u origin feat/NN-slug
gh pr create \
  --base <parent-branch-or-main> \     # parent feat branch when chained, else main
  --head feat/NN-slug \
  --title "[NN] <human title>" \
  --body  "<summary>

Stacked on: #<parentPR>"               # omit this line when base is main

# 4. Chain the next feature off the branch you just pushed
git switch -c feat/(NN+1)-next-slug feat/NN-slug
```

## Worked example — two chained features

```bash
# Feature 01, from main
git fetch origin
git switch -c feat/01-add-cache origin/main
#   …commit…
git push -u origin feat/01-add-cache
gh pr create --base main --head feat/01-add-cache --title "[01] Add cache"

# Feature 02 chains off 01 (do NOT wait for #01 to merge)
git switch -c feat/02-cache-metrics feat/01-add-cache
#   …commit…  (already contains 01's work → no conflicts)
git push -u origin feat/02-cache-metrics
gh pr create --base feat/01-add-cache --head feat/02-cache-metrics \
  --title "[02] Cache metrics" --body "Stacked on: #<PR of 01>"
```

PR `[02]` shows only its own diff because its base is `feat/01-add-cache`, not `main`.

## Merge order & recovery (stacked-PR hazards)

- **Merge the lowest `NN` first.** Merging out of order breaks the stack.
- Enable **delete branch on merge** for the repo (or pass `--delete-branch`) so GitHub
  **auto-retargets** each child PR to `main` when its parent merges.
- **After a parent PR merges** (squash rewrites its SHAs), rebase each child onto main so its PR
  shows only its own diff:

  ```bash
  git switch feat/NN-child
  git fetch origin
  git rebase origin/main              # drops the now-merged parent commits
  git push --force-with-lease
  ```

- **Propagate review fixes made on a parent** down the chain:

  ```bash
  # fix + commit on feat/NN-parent, push
  git switch feat/NN-child
  git rebase feat/NN-parent
  git push --force-with-lease
  ```

## Autonomous mode — the ChuckNorris dev loop

The orchestrator applies this same workflow **per story**, automatically, during `chucknorris run`.
It's **on by default** (opt out with `--no-stacked-prs`, or set `"stackedPrs": false` in the global
config / `CHUCKNORRIS_STACKED_PRS=false`).

For each story in the sprint:

1. Before any work lands, it cuts `feat/NN-<story-key>` from the **chain tip** (the previous
   passed story's branch), or the repo default branch for the first one. `NN` is the run's monotonic
   feature counter.
2. The story file and its implementation land on that branch.
3. When the story **passes goal verification**, it commits any residual changes, pushes, and opens
   `[NN] <goal>` against the parent branch (`Stacked on: #<parentPR>`), or against the default branch
   for the first story.
4. The **chain tip only advances on a pass**, so a skipped/failed story never becomes the base of the
   next one.

Branch and PR for each story are recorded in that story's `## ChuckNorris Tracking` block and in
`state.json`, so `chucknorris resume` picks the branch back up.

Requirements & fallback: the target repo needs a **GitHub remote** and an **authenticated `gh` CLI**.
If either is missing (e.g. a fresh local greenfield repo), the run logs a warning and proceeds
**without** per-story PRs — nothing fails. `--dry-run` always disables it. The same merge-order and
rebase-after-parent-merge rules above apply to the resulting stack.

## Notes

- The legacy `dev` branch is superseded by per-feature branches; it is left in place, not deleted.
- Always rebase/force-push with `--force-with-lease`, never a bare `--force`.
