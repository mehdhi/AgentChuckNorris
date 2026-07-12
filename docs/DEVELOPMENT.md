# Development Environment

## Requirements

- Node.js ≥ 20
- npm (repo uses `package-lock.json`)

## Setup

```bash
npm install
```

## Everyday commands

```bash
npx tsc --noEmit     # typecheck (strict mode, no unchecked index access)
npm test             # vitest run — 35 unit + e2e tests, no network, no API spend
npm run build        # tsc -> dist/
npm run dev          # tsx src/index.ts <command>  (skip the build step while iterating)
```

Run a single test file or pattern:

```bash
npx vitest run test/unit/storyDoc.test.ts
npx vitest run -t "goal-check"
```

## Project layout

```
src/
  index.ts               CLI entry — subcommands: run, resume, status, notify-test, scratch
  cli/
    wizard.ts             startup wizard (@clack/prompts)
    statusView.ts          renders state.json as a readable table
  config/
    schema.ts             zod schemas: RunConfig, ModelMap, NotifierConfig, GlobalConfig
    defaults.ts            DEFAULT_MODEL_MAP, retry/turn/budget constants
    load.ts                ~/.config/chucknorris/config.json + env var overrides
  sdk/
    runner.ts              wraps Agent SDK query(): streams, captures result, cost, try/catch
    types.ts               SessionSpec/SessionResult/QueryFn — the injectable seam
    scripted.ts             ScriptedQueryFn + autoResponder for tests and --dry-run
  orchestrator/
    engine.ts               main loop: next pending step -> execute -> persist -> repeat
    phases.ts                declarative BMAD pipeline table (command, model role, prompts)
    devLoop.ts                per-story cycle: create-story -> dev-story -> review -> goal-check -> retry
    goalChecker.ts            fresh review-model session, strict JSON verdict, fail-closed parsing
    sprintStatus.ts            locates + parses BMAD's sprint-status.yaml, tolerant to drift
    storyDoc.ts                reads/writes the managed "ChuckNorris Tracking" block in story .md files
    sessionHelpers.ts           shared session/budget/pause-for-ack plumbing used by engine + devLoop
  state/
    types.ts                RunState + all reducers (pure, unit-tested)
    stateFile.ts              zod-validated load, atomic save (tmp + rename)
  bmad/
    detect.ts                probes _bmad/ presence, reads output-folder config
    install.ts                spawns the interactive `npx bmad-method install`
  notify/                    Notifier interface + console/desktop/ntfy/telegram + fan-out
  ack/                       AckSource interface + control-file/telegram pollers + race listener
  util/                      logger, atomic file writes, JSON extraction, git head, bounded file search
test/
  unit/                    one file per module, no network
  e2e/dryRun.test.ts        full engine run against a fixture repo with a scripted SDK
  fixtures/sample-target/    a tiny fake BMAD-installed repo used by the e2e test and --dry-run demos
```

## Architecture notes for contributors

**Two seams make everything testable without spending API credits:**

- `QueryFn` (`src/sdk/types.ts`) — production code calls the real Agent SDK `query()`; tests and `--dry-run` swap in `scriptedQueryFn()` / `autoResponderQueryFn()` from `src/sdk/scripted.ts`. Never call `@anthropic-ai/claude-agent-sdk` directly outside `src/sdk/runner.ts`.
- `Notifier` (`src/notify/types.ts`) — real channels vs. `consoleNotifier()`, which is also what tests use.

**State is the only source of truth.** Every mutation goes through a pure reducer in `src/state/types.ts` and is persisted immediately via `saveState()` (atomic tmp-file + rename). Nothing should hold state in a local variable across an `await` boundary without re-deriving from the persisted copy on resume — this is what makes `chucknorris resume` safe after a hard kill.

**Context isolation is structural, not a convention to remember.** `runSession()` never accepts a `resume` session id; every call to it is a brand-new SDK session. If you're tempted to thread a session id through for "efficiency," don't — see [docs/DESIGN.md](DESIGN.md) for why this is a hard requirement, not an oversight.

**Fail-closed parsing.** `goalChecker.ts` treats an unparseable verdict as a failure, consuming a retry rather than silently passing. Keep this bias if you touch verdict parsing — a false pass is worse than a false fail (the retry/pause path recovers from a false fail; a false pass ships broken work).

**Tolerant parsing at BMAD boundaries.** `sprintStatus.ts` and `bmad/detect.ts` deliberately don't hard-fail on unrecognized status strings or config shapes — BMAD is a fast-moving external dependency at v6, and hard-coding its exact schema would make every point release a breaking change here.

## Adding a new BMAD phase

1. Add the step id to `STEP_IDS` in `src/state/types.ts`
2. Add a `StepDef` entry to `PIPELINE` in `src/orchestrator/phases.ts` — model role, command, prompt builder, optional `verifyArtifact` for resume support
3. If it should be togglable, add it to the wizard's `optional` multiselect in `src/cli/wizard.ts`
4. Add a fixture + scripted response if you extend the e2e test

## Adding a new notification or ack channel

- Notifier: implement `Notifier` in `src/notify/`, wire it into `buildNotifier()` in `src/index.ts`
- Ack source: implement `AckSource` in `src/ack/`, wire it into `buildAckSources()` in `src/index.ts` — `waitForAck()` races all enabled sources, so a new source just needs to resolve with an `AckCommand`

## Release checklist

```bash
npx tsc --noEmit && npm test && npm run build
node dist/index.js run --target test/fixtures/sample-target --dry-run   # sanity check the built CLI
```
