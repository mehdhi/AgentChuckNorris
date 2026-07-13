#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { controlFileSource } from './ack/controlFile.js';
import { waitForAck } from './ack/listener.js';
import { fetchLatestOffset, telegramSource, type TelegramOffsetStore } from './ack/telegramPoll.js';
import type { AckSource } from './ack/types.js';
import { detectBmad } from './bmad/detect.js';
import { renderStatus } from './cli/statusView.js';
import { firstRunSetup, runWizard } from './cli/wizard.js';
import { cavemanAppend, CavemanLevel } from './config/caveman.js';
import { ALL_HAIKU_MODEL_MAP, STATE_DIR } from './config/defaults.js';
import { globalConfigExists, loadGlobalConfig } from './config/load.js';
import type { GlobalConfig } from './config/schema.js';
import { gitHead, hasGitHubRemote } from './util/git.js';
import { ghAvailable } from './util/github.js';
import { runEngine } from './orchestrator/engine.js';
import { RunAborted, type OrchestratorDeps } from './orchestrator/sessionHelpers.js';
import { realQueryFn } from './sdk/runner.js';
import { autoResponderQueryFn } from './sdk/scripted.js';
import type { QueryFn } from './sdk/types.js';
import { loadState, saveState } from './state/stateFile.js';
import { newRunState, setTelegramOffset, type RunState } from './state/types.js';
import { consoleNotifier } from './notify/console.js';
import { desktopNotifier } from './notify/desktop.js';
import { multiNotifier } from './notify/multi.js';
import { ntfyNotifier } from './notify/ntfy.js';
import { telegramNotifier } from './notify/telegram.js';
import type { Notifier } from './notify/types.js';
import { createLogger, type Logger } from './util/logger.js';
import { runSession } from './sdk/runner.js';

const USAGE = `ChuckNorrisAgent — BMAD dev-loop orchestrator

Usage:
  chucknorris run    [--target <path>] [--dry-run] [--all-haiku] [--caveman <off|lite|full|ultra>]
  chucknorris resume [--target <path>] [--dry-run]
  chucknorris status [--target <path>]
  chucknorris setup  (re-run first-time global config)
  chucknorris notify-test
  chucknorris scratch [--target <path>] [--model <model>]  (SDK smoke test)
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      model: { type: 'string' },
      caveman: { type: 'string' },
      'stacked-prs': { type: 'boolean', default: false },
      'no-stacked-prs': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'all-haiku': { type: 'boolean', default: false },
    },
  });
  const command = positionals[0] ?? 'run';
  let global = await loadGlobalConfig();

  // First run (or explicit `setup`): capture durable global config once.
  if (command === 'setup' || (command === 'run' && !(await globalConfigExists()))) {
    global = await firstRunSetup(global);
    if (command === 'setup') return;
  }

  switch (command) {
    case 'run':
      return cmdRun(global, values);
    case 'resume':
      return cmdResume(global, values);
    case 'status':
      return cmdStatus(values);
    case 'notify-test':
      return cmdNotifyTest(global);
    case 'scratch':
      return cmdScratch(values);
    default:
      console.log(USAGE);
      process.exit(command === 'help' ? 0 : 1);
  }
}

type Flags = {
  target?: string | undefined;
  model?: string | undefined;
  caveman?: string | undefined;
  'stacked-prs'?: boolean;
  'no-stacked-prs'?: boolean;
  'dry-run'?: boolean;
  'all-haiku'?: boolean;
};

/** Stacked-PR flag intent, or undefined when neither flag given (wizard choice then wins). */
function stackedPrsFlag(flags: Flags): boolean | undefined {
  if (flags['no-stacked-prs']) return false;
  if (flags['stacked-prs']) return true;
  return undefined;
}

/** Parse the --caveman flag, or undefined when absent (wizard choice then wins). */
function cavemanFlag(flags: Flags): CavemanLevel | undefined {
  if (!flags.caveman) return undefined;
  const parsed = CavemanLevel.safeParse(flags.caveman);
  if (!parsed.success) {
    console.error(`--caveman must be off|lite|full|ultra, got "${flags.caveman}"`);
    process.exit(1);
  }
  return parsed.data;
}

async function cmdRun(global: GlobalConfig, flags: Flags): Promise<void> {
  const wizard = await runWizard(global, flags.target);

  const existing = await loadState(wizard.targetRepo);
  if (existing) {
    console.log(renderStatus(existing));
    console.error('\nA run already exists for this target. Use `chucknorris resume` or delete .chucknorris/state.json.');
    process.exit(1);
  }

  let state = newRunState({
    runId: randomUUID(),
    targetRepo: wizard.targetRepo,
    problemStatement: wizard.problemStatement,
    overallGoal: wizard.overallGoal,
    modelMap: flags['all-haiku'] ? ALL_HAIKU_MODEL_MAP : wizard.modelMap,
    caveman: cavemanFlag(flags) ?? wizard.caveman,
    stackedPrs: stackedPrsFlag(flags) ?? wizard.stackedPrs,
    maxRetries: wizard.maxRetries,
    maxBudgetUsd: wizard.maxBudgetUsd,
    enabledSteps: wizard.enabledSteps,
  });
  if (global.telegramBotToken) {
    // Otherwise offset 0 means "since bot creation" — the first real pause
    // would replay setup chatter (e.g. the "hi" used to discover chat id).
    state = setTelegramOffset(state, await fetchLatestOffset(global.telegramBotToken));
  }
  await saveState(state);
  await execute(state, global, flags);
}

async function cmdResume(global: GlobalConfig, flags: Flags): Promise<void> {
  const target = path.resolve(flags.target ?? process.cwd());
  const state = await loadState(target);
  if (!state) {
    console.error(`no run found at ${target}/${STATE_DIR}/state.json`);
    process.exit(1);
  }
  console.log(renderStatus(state));
  console.log('\nResuming…\n');
  await execute(state, global, flags);
}

async function cmdStatus(flags: Flags): Promise<void> {
  const target = path.resolve(flags.target ?? process.cwd());
  const state = await loadState(target);
  if (!state) {
    console.error(`no run found at ${target}/${STATE_DIR}/state.json`);
    process.exit(1);
  }
  console.log(renderStatus(state));
}

async function execute(initial: RunState, global: GlobalConfig, flags: Flags): Promise<void> {
  const logger = createLogger(path.join(initial.targetRepo, STATE_DIR, 'logs'), initial.runId);
  const abort = new AbortController();

  // Shared mutable ref: the telegram poller bumps the offset while the engine
  // holds its own state copy, so persist() merges the freshest offset.
  const ref = { current: initial };
  const persist = async (s: RunState): Promise<void> => {
    const merged = setTelegramOffset(s, Math.max(s.telegramOffset, ref.current.telegramOffset));
    ref.current = merged;
    await saveState(merged);
  };

  const notifier = buildNotifier(global, logger);
  const ackSources = buildAckSources(initial.targetRepo, global, ref, persist);

  const queryFn: QueryFn = flags['dry-run'] ? autoResponderQueryFn() : await realQueryFn();
  if (flags['dry-run']) logger.warn('DRY RUN — no real model calls, target must be pre-seeded');

  const bmad = await detectBmad(initial.targetRepo);
  const append = cavemanAppend(initial.caveman);
  if (append) logger.info(`caveman mode: ${initial.caveman}`);
  const stackedPrs = await stackedPrsFeasible(initial, flags, logger);
  const deps: OrchestratorDeps = {
    queryFn,
    logger,
    notifier,
    ackSources,
    persist,
    abort,
    bmadOutputFolder: bmad.outputFolder,
    ...(append ? { systemPromptAppend: append } : {}),
    ...(stackedPrs ? { stackedPrs: true } : {}),
  };

  process.on('SIGINT', () => {
    logger.warn('SIGINT — aborting (state is persisted; `chucknorris resume` to continue)');
    abort.abort();
  });

  try {
    const final = await runEngine(ref.current, deps);
    console.log('\n' + renderStatus(final));
  } catch (err) {
    if (err instanceof RunAborted || abort.signal.aborted) {
      logger.warn(`stopped: ${err instanceof Error ? err.message : String(err)} — resume with \`chucknorris resume --target ${initial.targetRepo}\``);
      console.log('\n' + renderStatus(ref.current));
      process.exitCode = 130;
    } else {
      logger.error(`fatal: ${String(err)}`);
      await notifier.send({
        title: 'run crashed',
        body: `${String(err)}\n\nState persisted — \`chucknorris resume\` after fixing.`,
        priority: 'action',
      });
      process.exitCode = 1;
    }
  } finally {
    abort.abort();
    await logger.close();
  }
}

/**
 * Stacked PRs need a real git repo with a GitHub remote and an authenticated
 * `gh` CLI. Probe once; if anything is missing (or it's a dry run), log and run
 * without per-story PRs rather than failing.
 */
async function stackedPrsFeasible(state: RunState, flags: Flags, logger: Logger): Promise<boolean> {
  if (!state.stackedPrs || flags['dry-run']) return false;
  const isRepo = (await gitHead(state.targetRepo)) !== null;
  const ok = isRepo && (await hasGitHubRemote(state.targetRepo)) && (await ghAvailable(state.targetRepo));
  if (ok) {
    logger.info('stacked-PRs: on — per-story feat/NN branches + chained PRs');
  } else {
    logger.warn(
      'stacked-PRs enabled but target lacks a git repo, GitHub remote, or gh CLI auth — ' +
        'running without per-story PRs',
    );
  }
  return ok;
}

function buildNotifier(global: GlobalConfig, logger: Logger): Notifier {
  const channels: Notifier[] = [consoleNotifier(logger)];
  if (process.platform === 'darwin') channels.push(desktopNotifier());
  if (global.ntfyTopic) channels.push(ntfyNotifier(global.ntfyTopic));
  if (global.telegramBotToken && global.telegramChatId) {
    channels.push(telegramNotifier(global.telegramBotToken, global.telegramChatId));
  }
  return multiNotifier(channels, logger);
}

function buildAckSources(
  targetRepo: string,
  global: GlobalConfig,
  ref: { current: RunState },
  persist: (s: RunState) => Promise<void>,
): AckSource[] {
  const sources: AckSource[] = [controlFileSource(targetRepo)];
  if (global.telegramBotToken && global.telegramChatId) {
    const offsets: TelegramOffsetStore = {
      get: () => ref.current.telegramOffset,
      set: (offset) => persist(setTelegramOffset(ref.current, offset)),
    };
    sources.push(telegramSource(global.telegramBotToken, global.telegramChatId, offsets));
  }
  return sources;
}

async function cmdNotifyTest(global: GlobalConfig): Promise<void> {
  const logger = createLogger(path.join(process.cwd(), '.chucknorris-notify-test'), 'notify-test');
  const notifier = buildNotifier(global, logger);
  await notifier.send({
    title: 'notify-test',
    body: 'Round-trip test. Reply /go (Telegram) or `echo go > ./.chucknorris/control` within 60s.',
    priority: 'action',
  });
  logger.info('notification sent on all channels — waiting up to 60s for an ack…');

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  let offset = global.telegramBotToken ? await fetchLatestOffset(global.telegramBotToken) : 0;
  const sources: AckSource[] = [controlFileSource(process.cwd())];
  if (global.telegramBotToken && global.telegramChatId) {
    sources.push(
      telegramSource(global.telegramBotToken, global.telegramChatId, {
        get: () => offset,
        set: async (o) => {
          offset = o;
        },
      }),
    );
  }
  try {
    const ack = await waitForAck(sources, logger, abort.signal);
    // waitForAck resolves gracefully (not throws) when the 60s timer fires the
    // outer abort — that's a timeout, not a reply, and must not be reported as success.
    if (ack.source === 'signal') {
      logger.warn('no ack received in 60s — send path works, reply path unverified');
    } else {
      logger.info(`ack round trip OK: ${ack.kind} via ${ack.source}`);
    }
  } catch {
    logger.warn('no ack received in 60s — send path works, reply path unverified');
  } finally {
    clearTimeout(timer);
    await logger.close();
  }
}

/** M2 smoke test: verifies model switching, settingSources, slash-command probe, cost capture. */
async function cmdScratch(flags: Flags): Promise<void> {
  const target = path.resolve(flags.target ?? process.cwd());
  const logger = createLogger(path.join(target, STATE_DIR, 'logs'), 'scratch');
  const queryFn = await realQueryFn();
  const result = await runSession(
    {
      label: 'scratch',
      model: flags.model ?? 'claude-haiku-4-5-20251001',
      prompt: 'Reply with exactly: SCRATCH_OK. Then stop.',
      cwd: target,
      maxTurns: 3,
      allowedTools: ['Read'],
    },
    { queryFn, logger },
  );
  logger.info(
    `ok=${result.ok} model-run cost=$${result.costUsd.toFixed(4)} ` +
      `slash-commands=${result.slashCommands.length} (bmad: ${result.slashCommands.filter((c) => c.includes('bmad')).length})`,
  );
  logger.info(`final text: ${result.finalText.slice(0, 200)}`);
  await logger.close();
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
