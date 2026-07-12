# ChuckNorrisAgent

Unattended BMAD-METHOD v6 dev-loop orchestrator. Point it at a repo and a problem statement; it drives BMAD's own workflows — brainstorm → PRD → UX → architecture → epics/stories → per-story dev loop — through to shipped, goal-verified stories, switching Claude models per phase, and pinging your phone only when it genuinely needs a decision.

```bash
npm install && npm run build && npm link
chucknorris run --target /path/to/your/repo
```

## Docs

- **[Greenfield Walkthrough](docs/GREENFIELD-WALKTHROUGH.md)** — a real, executed end-to-end run: empty repo → working phone book CLI with 57 passing tests, $5.62, phase-by-phase
- **[Usage Guide](docs/USAGE.md)** — install, notification setup, running a project, responding to pauses, command reference, troubleshooting
- **[Development Environment](docs/DEVELOPMENT.md)** — project layout, testing, architecture notes for contributors, how to extend
- **[Design & Roadmap](docs/DESIGN.md)** — the idea, why context is cleared between stories, why goal-checking is a separate session, known limitations, future implementation ideas

## At a glance

Each BMAD phase runs as its own fresh Agent SDK session with the model mapped to that phase's role — no session is ever resumed across phases or stories; all cross-session context travels through documents (BMAD's own artifacts, plus a managed tracking block this agent maintains in each story file).

| Role | Used for | Default model |
|---|---|---|
| planning | brainstorm, product brief, PRD, UX, architecture, epics/stories, create-story | `claude-opus-4-8` |
| grunt | readiness check, sprint planning, goal extraction, retrospectives | `claude-haiku-4-5-20251001` |
| coding | dev-story implementation | `claude-sonnet-5` |
| review | code review + goal verification | `claude-opus-4-8` |

Every story is verified against its acceptance criteria by a separate, fail-closed goal-check session before being marked done. State is persisted atomically after every step, so `chucknorris resume` picks up cleanly after a crash or a `Ctrl-C`.

## Development

```bash
npx tsc --noEmit && npm test   # 35 unit + e2e tests, no network, no API spend
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full layout and contributor notes.
