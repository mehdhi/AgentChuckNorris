# Usage Guide

## Prerequisites

- Node.js ≥ 20 (global `fetch` required)
- Claude Code credentials configured (or `ANTHROPIC_API_KEY` set) — the Agent SDK reuses whichever auth is already set up for Claude Code
- Target repo is a git repository (recommended — goal-check diffs against a baseline commit; without git, goal-checks review the working tree only)
- BMAD-METHOD not required beforehand — the wizard installs it for you on first run

## Install

```bash
npm install
npm run build      # emits dist/, matches package.json "bin": { "chucknorris": "dist/index.js" }
npm link           # optional — puts `chucknorris` on PATH
```

Without `npm link`, run everything as `node dist/index.js <command>` instead of `chucknorris <command>`.

## One-time: notification config

Secrets live outside the target repo, in `~/.config/chucknorris/config.json`:

```json
{
  "ntfyTopic": "your-secret-topic-name",
  "telegramBotToken": "123456:ABC-your-bot-token",
  "telegramChatId": "your-numeric-chat-id"
}
```

All fields optional — omit a channel to disable it. Console output and (on macOS) desktop banners are always on regardless of this file. Env vars override the file: `CHUCKNORRIS_NTFY_TOPIC`, `CHUCKNORRIS_TELEGRAM_BOT_TOKEN`, `CHUCKNORRIS_TELEGRAM_CHAT_ID`.

**Getting a Telegram bot token/chat id**: message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token. Then message your new bot once, and hit `https://api.telegram.org/bot<token>/getUpdates` in a browser — your chat id is in the response.

Verify the round trip before trusting a long unattended run:

```bash
chucknorris notify-test
```

This fires all configured channels and waits 60s for a reply (`/go` via Telegram, or `echo go > ./.chucknorris/control`).

## Running a project

```bash
chucknorris run --target /path/to/your/repo
```

The wizard walks through:

1. **Target repo** — confirms the path exists
2. **BMAD install check** — if `_bmad/` is missing, offers to install it non-interactively (`--yes --modules core,bmm --tools claude-code`) right there in your terminal
3. **Problem statement** — what you're building and why, one sentence minimum
4. **Overall development goal** — checked informationally at the very end of the run
5. **Optional phases** — brainstorming, product brief, UX/UI design, implementation-readiness check. PRD, architecture, epics/stories, sprint planning, and the dev loop always run
6. **Model mapping** — accept the defaults or override per role
7. **Retry limit and budget cap** — how many auto-retries per story before pausing, and an optional USD ceiling for the whole run

After the wizard, the run starts immediately and streams progress to the console (and your log file).

### Resuming

Every state transition is persisted atomically to `<target>/.chucknorris/state.json`. If the process dies (crash, `Ctrl-C`, laptop sleep), just:

```bash
chucknorris resume --target /path/to/your/repo
```

This re-validates the state, shows you where things stood, and continues — including re-sending any notification you hadn't yet answered.

### Checking status without running anything

```bash
chucknorris status --target /path/to/your/repo
```

Prints the pipeline phase table, per-story status, and running cost totals.

## Responding to a pause

When a story fails its goal check after all retries, or a phase fails outright, or the budget cap is hit, you get an **action** notification on every configured channel. Reply on whichever is easiest:

| Channel | How |
|---|---|
| Telegram | reply to the bot: `/go`, `/retry`, `/skip`, `/abort`, or any free text |
| Control file | `echo retry > <target>/.chucknorris/control` |

Recognized commands:

- `/go` or `continue` — resume as-is
- `/retry` — reset the attempt counter and try again
- `/skip` — mark the story skipped, move to the next one (only meaningful for story-level pauses)
- `/abort` or `stop` — end the run cleanly, state stays resumable
- anything else — treated as `/retry` **with your text as guidance**, written into the story's tracking block so the next attempt sees it

## Cheap smoke testing before a real run

```bash
chucknorris run --target /tmp/some-throwaway-repo --all-haiku
```

`--all-haiku` maps every role to Haiku 4.5. Pair it with a small budget cap in the wizard and a one-story-sized problem statement (e.g. "add a `--version` flag") to exercise the entire pipeline — real BMAD dispatch, real sprint-status parsing, real goal-check verdicts — for well under a dollar.

```bash
chucknorris run --target test/fixtures/sample-target --dry-run
```

`--dry-run` swaps in a scripted responder — zero API calls, zero cost, deterministic output. Good for demoing the CLI or checking your terminal/notification wiring without touching your budget.

## Command reference

```
chucknorris run    [--target <path>] [--dry-run] [--all-haiku]
chucknorris resume [--target <path>] [--dry-run]
chucknorris status [--target <path>]
chucknorris notify-test
chucknorris scratch [--target <path>] [--model <model>]   # SDK connectivity smoke test
```

## Troubleshooting

- **"no bmad slash commands visible"** — the first BMAD session probes for this and falls back automatically to instruction-style prompts ("use the bmad-prd skill"); this is informational, not fatal.
- **A phase or story session times out repeatedly** — check `<target>/.chucknorris/logs/<runId>.jsonl` for the raw SDK transcript; usually means a BMAD workflow is waiting on elicitation input that the non-interactive suffix didn't cover for that particular workflow version.
- **Permission errors inside a session** — sessions run with `permissionMode: bypassPermissions`. If the target repo's own `.claude/settings.json` has `deny`/`ask` rules on core tools (Read/Write/Bash), remove them for automated runs or scope them elsewhere.
- **Wrong story picked up / dev loop looks stuck** — check `<target>/docs/**/sprint-status.yaml` (or wherever your BMAD `bmm` output folder points) matches what the CLI parsed; `chucknorris status` shows exactly what it sees.
