# Greenfield Walkthrough: Building a Phone Book App From an Empty Repo

This is a real, executed run — not a hypothetical. Every artifact path, cost figure, and outcome below was observed on 2026-07-12 running ChuckNorrisAgent against a repo containing nothing but an empty git commit. Total cost: **$5.62 across 26 sessions** (all-Haiku mode), roughly an hour of unattended wall time, ending in a working, tested CLI app.

## Starting point

```bash
mkdir phonebook && cd phonebook
git init -b main
git commit --allow-empty -m "empty greenfield repo"
```

That's it. No package.json, no source files, no docs. Then:

```bash
chucknorris run --target ./phonebook --all-haiku
```

(`--all-haiku` maps every role to Haiku 4.5 — used here to keep the demo cheap. For real work, use the default map: Opus for planning/review, Sonnet for coding. Same flow, better output, higher cost.)

## The wizard answers used

| Prompt | Answer given |
|---|---|
| BMAD not installed — install now? | yes (runs `npx bmad-method install --yes --modules core,bmm --tools claude-code`, one-time, ~1 min) |
| Problem statement | *"Build a phone book CLI app in Node.js (no external dependencies). Users manage contacts (name + phone number) stored in a local JSON file. Commands: add, list, search, delete. Keep the scope minimal: a single epic with at most 3 stories."* |
| Overall goal | *"A working phonebook CLI: add, list, search, and delete all work correctly with contacts persisted between invocations in a JSON file."* |
| Optional phases | none (PRD, architecture, epics/stories, sprint planning, dev loop only) |
| Max retries / budget | 1 retry, $10 cap |

Two things worth copying from that problem statement: it **names the tech constraints** ("Node.js, no external dependencies, JSON file") so the architecture phase doesn't invent a database, and it **caps the scope** ("single epic, at most 3 stories") so a small idea doesn't balloon into a 12-story program. (BMAD produced 4 stories anyway — treat the cap as pressure, not a contract.)

## What happened, phase by phase

### 1. PRD — $0.15
A fresh Haiku session ran BMAD's `bmad-prd` workflow with the problem statement injected. Output: `_bmad-output/planning-artifacts/prds/prd-phonebook-2026-07-12/prd.md` — functional requirements for each command, error-handling expectations, and explicitly scoped-out items. One detail that mattered later: the PRD defined search as **name matching only**.

### 2. Architecture — $0.13
`bmad-create-architecture` read the PRD and produced `ARCHITECTURE-SPINE.md`: a commands/ directory with one handler per command, a shared `storage.js` for JSON persistence, `utils.js` for validation, and a dispatcher in `index.js` returning proper exit codes. The dev-loop sessions followed this structure exactly — this document is what keeps four independent story sessions building one coherent app instead of four disjoint ones.

### 3. Epics & stories — $0.20
One epic, four stories, each annotated with how it serves the overall goal:

1. `1-1-project-setup-storage-layer` — scaffolding, storage read/write, dispatcher
2. `1-2-add-contact-command`
3. `1-3-list-search-commands`
4. `1-4-delete-contact-command`

### 4. Sprint planning — $0.08
`bmad-sprint-planning` generated `sprint-status.yaml`, the file the dev loop polls to know what's next.

> **What a crash looks like (real example):** on this run, BMAD emitted a line in sprint-status.yaml that wasn't valid YAML (`story_location: {project-root}/...` unquoted), and the orchestrator crashed when the dev loop tried to parse it. This is the failure mode working as designed: an **action-priority notification** fired on every channel ("run crashed — state persisted, resume after fixing"), the state file kept every completed phase, and after the parser was fixed, `chucknorris resume --target ./phonebook` picked up **exactly where it left off** — straight into the dev loop, zero planning work repeated, zero dollars re-spent. (That parser bug is fixed in this repo now, but the recovery behavior is the takeaway: crashes cost you a resume command, not a run.)

### 5. Dev loop — 4 stories, ~$4.60, all passed on first attempt

Each story ran the same cycle, every step a **fresh session with no memory of the previous ones** — all context flows through the story file, the architecture doc, and the tracking block the agent maintains:

| Story | Goal-check verdict (verbatim summary) |
|---|---|
| 1-1 project-setup-storage-layer | PASS — "All 5 acceptance criteria verified… All 36 tests passing." |
| 1-2 add-contact-command | PASS — "validates input, persists valid contacts to JSON, rejects invalid input without file modification" |
| 1-3 list-search-commands | PASS — "All 7 acceptance criteria pass. 49 tests pass with no regressions." |
| 1-4 delete-contact-command | PASS — "exact case-sensitive matching… all delete-specific tests pass" |

For each story: `bmad-create-story` drafted the story file → acceptance criteria were extracted and pinned as the story's goal → `bmad-dev-story` implemented (TDD: the sessions wrote failing tests first) → `bmad-code-review` reviewed in a fresh session → a separate **goal-check session** read the story, diffed against the baseline commit, ran the test suite, and returned a strict pass/fail JSON verdict. Had any verdict been *fail*, the loop would have retried once with the failure written into the story's tracking block, then paged Telegram and paused.

After story 4, the epic retrospective ran, then a final informational check against the overall goal, then the summary notification: **"Stories: 4 done, 0 skipped of 4. Total cost: $5.62 across 26 sessions."**

## What was actually produced

```
phonebook/
├── index.js                  # dispatcher with exit codes
├── storage.js                # JSON persistence
├── utils.js                  # validation
├── commands/
│   ├── add.js  list.js  search.js  delete.js
├── test/                     # 57 tests, all passing (node --test)
│   ├── storage.test.js  handlers.test.js  dispatcher.test.js
│   ├── structure.test.js  utils.test.js
└── _bmad-output/             # PRD, architecture, epics, stories, sprint status
```

Verified by hand after the run:

```
$ node index.js add "Alice Smith" "555-1234"     → Contact added: Alice Smith (555-1234)   exit 0
$ node index.js list                             → all contacts, one per line               exit 0
$ node index.js search alice                     → Alice Smith (555-1234)                   exit 0
$ node index.js delete "Bob Jones"               → Deleted 1 contact                        exit 0
$ node index.js add "" ""                        → Error: Both name and phone number…       exit 1
$ node index.js nonsense                         → Unknown command: nonsense                exit 1
$ cat contacts.json                              → clean JSON, persisted across invocations
```

## The lesson about specs (worth reading)

Searching by phone number (`search 555-98`) finds nothing. Bug? No — the PRD defined search as *name matching only*, the story repeated it ("search only looks at names"), and the goal-check verified against **what was written, not what a human might have assumed**. The whole pipeline is spec-faithful: if you want phone-number search, it belongs in the problem statement. The problem statement is the highest-leverage sentence you will write all run — spend your effort there.

## Reproducing this

```bash
npm install && npm run build && npm link       # in the ChuckNorrisAgent repo
mkdir /tmp/phonebook && cd /tmp/phonebook && git init -b main && git commit --allow-empty -m init
chucknorris run --target /tmp/phonebook --all-haiku
# answer the wizard as in the table above, then walk away —
# it pages Telegram if it needs you, otherwise come back to a finished app
```

Costs to expect: ~$5–6 all-Haiku for a 4-story project like this. With the default model map (Opus planning/review, Sonnet coding), expect several times that, with correspondingly better planning documents and code.
