# Design & Roadmap

## The idea

BMAD-METHOD gives you a structured, document-driven AI development lifecycle — brainstorm, PRD, architecture, epics, stories, dev loop — but every phase transition and every story cycle is still a human clicking through slash commands in an editor. ChuckNorrisAgent automates the whole thing end to end: point it at a repo and a problem statement, and it drives BMAD's own workflows through to shipped, goal-verified stories, stopping only when it genuinely needs a human decision.

The name and scope came out of a specific set of requirements (see the "Non-negotiable requirements" section below) rather than a generic "AI does everything" pitch — the design choices below all trace back to one of those requirements.

## Why per-phase model switching

Planning documents (PRD, architecture, epics) benefit from a stronger model's judgment; sprint-status bookkeeping and retrospectives don't need it; writing code benefits from a model tuned for that; reviewing code and verifying goals benefits from a different, skeptical pass — ideally not the same model that just wrote the code, so it isn't reviewing its own reasoning uncritically.

This maps directly onto four roles (`planning`, `grunt`, `coding`, `review`) and each BMAD phase declares which role it uses in `src/orchestrator/phases.ts`. Because every phase runs as an independent Agent SDK `query()` call, switching models is just a different `model` string on the next call — there's no session state to migrate.

## Why context is cleared between stories

This was an explicit, non-negotiable requirement, not a default we chose lazily. Three reasons it matters:

1. **Cost and latency.** A long-lived session accumulates context linearly across dozens of stories; a fresh session per step is bounded regardless of how large the project gets.
2. **Independence.** A story's implementation shouldn't be influenced by the specific back-and-forth phrasing used debugging a previous story — it should be influenced by the project's actual documented state (PRD, architecture, sprint status, the story's own file). Documents are the interface between steps, not conversation history.
3. **Resumability.** If nothing depends on session continuity, killing the process and resuming later is just "read state, figure out what's done, start a fresh session for what's not." A design that depended on session resume would need the Agent SDK's session store to survive crashes and machine restarts, which is a much harder guarantee to make.

The mechanism: `runSession()` in `src/sdk/runner.ts` never takes a `resume` parameter. Cross-step context that would normally live in conversation history instead gets written into the **ChuckNorris Tracking** block appended to each story's markdown file (goal, attempt count, last verifier verdict, failed criteria, a truncated code-review digest, and any freeform operator guidance). A retry's dev-story prompt just says "re-read the story file, including the tracking section" — the document carries what the conversation would have.

`state.json` is the machine-readable source of truth; the tracking block in the story file is the model-readable mirror of the same facts, regenerated from state after every step so BMAD's own workflows can't silently clobber it.

## Why goal-checking is a separate session with fail-closed parsing

If the same session that wrote the code also judged whether it met the goal, you'd get systematically optimistic verdicts. The goal-check runs as its own review-model session with read-only tools (`Read`, `Grep`, `Glob`, `Bash`), instructed to diff against a recorded baseline commit and actually run the story's acceptance criteria against the diff rather than trust the story file's own claims.

The verdict must be a JSON object on the final line of the reply. If it can't be parsed, that counts as a **fail**, not a pass — an ambiguous verifier response should never silently ship a story. This costs one retry in the rare parsing-failure case; the alternative (assume pass on unparseable output) risks shipping broken work with no signal at all.

## Why retries live in the loop, not as a separate "fix" phase

A failed goal-check re-enters the same `dev-story` step with retry context injected, rather than routing to a distinct "fix" workflow. BMAD's `bmad-dev-story` workflow is already the right tool for "implement/modify this story to satisfy its acceptance criteria" — a bespoke fix-phase would duplicate that logic and fight the docs-as-state model, since the tracking block already contains everything a fresh dev-story session needs to know what to fix.

## Why notifications fan out and Telegram is the primary ack channel

Three channels are wired in from the start (console, macOS desktop, ntfy push) because a long unattended run might be checked from different places at different times — the desktop banner when at the machine, ntfy when the phone is nearby but Telegram isn't installed, console always as the audit trail. But only **Telegram** is bidirectional without extra infrastructure: a getUpdates long-poll lets you reply `/retry` or type free-text guidance from your phone with no server to run. The control file (`echo retry > .chucknorris/control`) is the always-available fallback for anyone who hasn't set up a bot, or for scripted/CI-adjacent use where a human isn't reading Telegram.

## Non-negotiable requirements (as given)

These came directly from the person commissioning the build and shaped the architecture more than any single technical preference would have:

1. Pick models per purpose (brainstorm/plan, grunt work, coding, review) at the start, and actually switch between them mid-run.
2. Install BMAD-METHOD into the target repo as the first step, since the whole workflow depends on it.
3. Define the problem, then choose which BMAD process steps to run (brainstorm, PRD, UI, architecture, stories) — not all of them are always wanted.
4. Set an overall development goal, and a per-story goal as each story is created; recheck the goal after every dev-loop iteration.
5. On any issue, prompt and have a way to notify the user promptly, then auto-continue once addressed.
6. **Clear context between stories being developed** — nothing should carry over via conversation memory.
7. **BMAD-generated documents should be updated to carry whatever information the agent itself needs** to operate correctly across those context resets.

Everything in "Why" sections above is a direct consequence of items 6 and 7 in particular — they are the two requirements that most constrain the architecture, since they rule out the simpler "one long session, resume as needed" design that would otherwise have been the default.

## Known limitations / open risks

- **BMAD elicitation prompts.** The non-interactive suffix appended to every BMAD prompt (`src/orchestrator/phases.ts`) asks workflows to pick defaults instead of stopping to ask. Not every BMAD workflow version is guaranteed to honor this; the per-role `maxTurns` ceiling is the backstop — a stalled session ends with `error_max_turns` rather than hanging forever, and the engine treats that as a step failure (notify + pause), never a silent hang.
- **sprint-status.yaml schema drift.** BMAD is an actively evolving external project; the parser (`src/orchestrator/sprintStatus.ts`) treats unrecognized status strings as "not done yet" rather than crashing, and falls back to scanning for any nested map with story-shaped keys if `development_status` isn't where expected. This is a deliberate tolerance tradeoff, not full schema validation.
- **bypassPermissions.** Sessions run with `permissionMode: bypassPermissions` since unattended operation can't stop for tool-use approval. This means the target repo's own `.claude/settings.json` `deny`/`ask` rules for core tools should be relaxed for automated runs — documented in [docs/USAGE.md](USAGE.md), not enforced by the tool itself.
- **No cost prediction before a run.** The wizard lets you set a budget ceiling, but there's no dry-run cost estimate before you commit to a model mapping — `--all-haiku` combined with a small budget on a throwaway repo is the recommended way to sanity-check cost behavior before a real run.

## Future implementation ideas

Roughly in the order they'd likely matter, not a committed roadmap:

- **Parallel story execution.** Stories within an epic that don't share files could run concurrently instead of strictly sequentially, cutting wall-clock time on larger epics. Would need a dependency/conflict signal between stories (shared file overlap, explicit epic ordering) before it's safe.
- **Cost estimation pass.** A cheap grunt-model pass over the PRD/epics that estimates total session count and rough cost before committing to a model mapping, surfaced in the wizard.
- **Richer ack commands.** `/retry-with:<file>` to attach a specific correction document, or `/goal:<new text>` to amend a story's goal mid-run without a full abort/restart.
- **ntfy subscribe-stream as a second ack channel.** Deliberately left out of v1 (see "Why notifications fan out" above) to keep moving parts down; the `AckSource` interface already supports adding it without touching the listener or engine.
- **Pluggable review policies.** Right now goal-check is a single fixed prompt; a per-project policy file (test coverage thresholds, specific lint rules, security checklist) could be layered in without changing the core loop.
- **Multi-repo runs.** Today one `chucknorris run` targets one repo. A thin wrapper that walks a list of repos with the same problem statement (e.g. rolling out the same change across services) is a natural extension of the existing wizard/state model.
- **Web dashboard over state.json.** `chucknorris status` is a terminal table today; a small local web view over the same state file (plus the JSONL session logs) would make longer runs easier to audit without SSH'ing in.
- **First-class support for BMAD's own `bmad-loop` module.** Currently ChuckNorrisAgent and BMAD's opt-in unattended-loop module simply coexist without interacting. If BMAD's own automation matures, evaluate whether ChuckNorrisAgent should delegate story-level looping to it and focus purely on the cross-phase orchestration + notification layer.
