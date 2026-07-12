import type { Logger } from '../util/logger.js';
import type { QueryFn, SdkMessage, SessionResult, SessionSpec } from './types.js';

export interface RunnerDeps {
  queryFn: QueryFn;
  logger: Logger;
  abortController?: AbortController;
}

function truncate(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Run one fresh SDK session. Never resumes prior sessions — context isolation
 * between phases/stories is enforced here by construction.
 *
 * The SDK throws after yielding an error result message, so the stream loop is
 * wrapped: if we already saw a result we return it, otherwise rethrow.
 */
export async function runSession(spec: SessionSpec, deps: RunnerDeps): Promise<SessionResult> {
  const { queryFn, logger } = deps;
  logger.info(`session start [${spec.label}] model=${spec.model}`);

  let result: SessionResult | null = null;
  let slashCommands: string[] = [];

  try {
    const stream = queryFn({
      prompt: spec.prompt,
      options: {
        model: spec.model,
        cwd: spec.cwd,
        maxTurns: spec.maxTurns,
        permissionMode: 'bypassPermissions',
        settingSources: ['project'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        ...(spec.allowedTools ? { allowedTools: spec.allowedTools } : {}),
        ...(deps.abortController ? { abortController: deps.abortController } : {}),
      },
    });

    for await (const msg of stream) {
      logger.event(`sdk:${spec.label}`, msg);
      result = ingest(msg, spec, logger, slashCommands) ?? result;
      if (msg.type === 'system' && msg.subtype === 'init' && msg.slash_commands) {
        slashCommands = msg.slash_commands;
      }
    }
  } catch (err) {
    if (!result) {
      logger.error(`session threw [${spec.label}]: ${String(err)}`);
      throw err;
    }
    // Error result already captured; SDK's post-result throw is expected.
  }

  if (!result) {
    throw new Error(`session [${spec.label}] ended without a result message`);
  }
  result.slashCommands = slashCommands;
  logger.info(
    `session end [${spec.label}] ${result.ok ? 'ok' : `FAILED (${result.subtype})`} ` +
      `turns=${result.numTurns} cost=$${result.costUsd.toFixed(4)}`,
  );
  return result;
}

function ingest(
  msg: SdkMessage,
  spec: SessionSpec,
  logger: Logger,
  slashCommands: string[],
): SessionResult | null {
  if (msg.type === 'assistant') {
    for (const block of msg.message?.content ?? []) {
      if (block.type === 'text' && block.text) logger.info(`  [${spec.label}] ${truncate(block.text)}`);
      if (block.type === 'tool_use' && block.name) logger.info(`  [${spec.label}] → ${block.name}`);
    }
    return null;
  }
  if (msg.type === 'result') {
    return {
      ok: msg.subtype === 'success',
      subtype: msg.subtype ?? 'unknown',
      sessionId: msg.session_id ?? '',
      finalText: msg.result ?? '',
      costUsd: msg.total_cost_usd ?? 0,
      numTurns: msg.num_turns ?? 0,
      slashCommands,
    };
  }
  return null;
}

/** Production QueryFn — thin wrapper so the SDK import stays in one place. */
export async function realQueryFn(): Promise<QueryFn> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  return ((args: { prompt: string; options: Record<string, unknown> }) =>
    query(args as never)) as unknown as QueryFn;
}
