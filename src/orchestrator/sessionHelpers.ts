import { waitForAck } from '../ack/listener.js';
import type { AckCommand, AckSource } from '../ack/types.js';
import type { Notification, Notifier } from '../notify/types.js';
import { runSession } from '../sdk/runner.js';
import type { QueryFn, SessionResult, SessionSpec } from '../sdk/types.js';
import {
  addSessionCost,
  budgetExceeded,
  setWaiting,
  type RunState,
  type WaitingState,
} from '../state/types.js';
import type { Logger } from '../util/logger.js';

/** Thrown to unwind the whole run cleanly on operator abort / SIGINT. */
export class RunAborted extends Error {
  constructor(reason: string) {
    super(`run aborted: ${reason}`);
  }
}

export interface OrchestratorDeps {
  queryFn: QueryFn;
  logger: Logger;
  notifier: Notifier;
  ackSources: AckSource[];
  persist: (s: RunState) => Promise<void>;
  abort: AbortController;
  bmadOutputFolder: string | null;
  /** Caveman/style append for every session; undefined = plain preset prompt. */
  systemPromptAppend?: string;
}

/** Run one session, account cost, persist, enforce the budget guard. */
export async function runTrackedSession(
  state: RunState,
  spec: SessionSpec,
  deps: OrchestratorDeps,
): Promise<{ state: RunState; session: SessionResult }> {
  const session = await runSession(spec, {
    queryFn: deps.queryFn,
    logger: deps.logger,
    abortController: deps.abort,
    ...(deps.systemPromptAppend ? { systemPromptAppend: deps.systemPromptAppend } : {}),
  });
  let next = addSessionCost(state, session.costUsd);
  await deps.persist(next);

  if (budgetExceeded(next)) {
    const { state: afterPause, ack } = await pauseForAck(next, deps, {
      reason: 'budget_exceeded',
      storyKey: null,
      message:
        `Budget exceeded: $${next.totals.costUsd.toFixed(2)} of $${next.maxBudgetUsd?.toFixed(2)}. ` +
        `Reply /go to lift the budget and continue, /abort to stop.`,
    });
    if (ack.kind === 'abort') throw new RunAborted('budget exceeded');
    next = { ...afterPause, maxBudgetUsd: null }; // operator chose to continue: lift the guard
    await deps.persist(next);
  }
  return { state: next, session };
}

/**
 * Notify (action priority) → persist waiting marker → block on ack → clear marker.
 * The waiting marker makes a crash during the pause resumable: `resume` re-sends
 * the notification and comes straight back here.
 */
export async function pauseForAck(
  state: RunState,
  deps: OrchestratorDeps,
  waiting: WaitingState,
): Promise<{ state: RunState; ack: AckCommand }> {
  let next = setWaiting(state, waiting);
  await deps.persist(next);

  const notification: Notification = {
    title: waiting.reason.replace(/_/g, ' '),
    body: `${waiting.message}\n\nReply: /go, /retry, /skip, /abort — or any text as guidance for the next attempt.`,
    priority: 'action',
  };
  await deps.notifier.send(notification);

  const ack = await waitForAck(deps.ackSources, deps.logger, deps.abort.signal);
  next = setWaiting(next, null);
  await deps.persist(next);
  return { state: next, ack };
}

export function info(logger: Logger, notifier: Notifier, title: string, body: string): Promise<void> {
  logger.info(`${title}: ${body}`);
  return notifier.send({ title, body, priority: 'info' });
}
