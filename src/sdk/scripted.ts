import type { QueryFn, SdkMessage } from './types.js';

export function initMsg(slashCommands: string[] = ['/bmad-prd', '/bmad-dev-story']): SdkMessage {
  return { type: 'system', subtype: 'init', session_id: `sid-${Math.random().toString(36).slice(2, 8)}`, slash_commands: slashCommands };
}

export function resultMsg(opts: { ok?: boolean; text?: string; cost?: number; subtype?: string }): SdkMessage {
  return {
    type: 'result',
    subtype: opts.subtype ?? (opts.ok === false ? 'error_during_execution' : 'success'),
    session_id: `sid-${Math.random().toString(36).slice(2, 8)}`,
    result: opts.text ?? 'done',
    total_cost_usd: opts.cost ?? 0.01,
    num_turns: 3,
  };
}

export interface ScriptEntry {
  /** Sanity-check the prompt this entry answers; mismatch throws. */
  match?: RegExp;
  messages: SdkMessage[];
}

/** Ordered scripted sessions for precise e2e control (retries, failures). */
export function scriptedQueryFn(script: ScriptEntry[]): QueryFn {
  let i = 0;
  return ({ prompt }) => {
    const entry = script[i++];
    if (!entry) throw new Error(`scripted query exhausted at call ${i} (prompt: ${prompt.slice(0, 80)})`);
    if (entry.match && !entry.match.test(prompt)) {
      throw new Error(`scripted query mismatch at call ${i}: expected ${entry.match}, got: ${prompt.slice(0, 120)}`);
    }
    return toStream(entry.messages);
  };
}

/**
 * Dry-run demo mode: every session succeeds instantly with a plausible reply.
 * Requires a pre-seeded target (fixture) since no files are actually produced.
 */
export function autoResponderQueryFn(): QueryFn {
  return ({ prompt }) => {
    let text = 'Workflow completed (dry-run).';
    if (prompt.includes('"verdict"')) {
      text = 'All criteria verified.\n{"verdict":"pass","failedCriteria":[],"summary":"dry-run auto-pass"}';
    } else if (prompt.includes('"acceptanceCriteria"')) {
      text = '{"goal":"dry-run goal","acceptanceCriteria":["works in dry-run"]}';
    } else if (prompt.includes('ONE sentence')) {
      text = 'Dry-run: goal nominally achieved, nothing verified for real.';
    }
    return toStream([initMsg(), resultMsg({ text, cost: 0 })]);
  };
}

async function* toStream(messages: SdkMessage[]): AsyncIterable<SdkMessage> {
  for (const m of messages) yield m;
}
