export interface SessionSpec {
  /** Human label for logs: 'prd', 'dev-story:1-2', 'goal-check:1-2'. */
  label: string;
  model: string;
  prompt: string;
  cwd: string;
  maxTurns: number;
  allowedTools?: string[];
}

export interface SessionResult {
  ok: boolean;
  /** SDK result subtype: 'success' | 'error_max_turns' | 'error_during_execution' | ... */
  subtype: string;
  sessionId: string;
  finalText: string;
  costUsd: number;
  numTurns: number;
  /** Slash commands reported by the init message; used to probe BMAD availability. */
  slashCommands: string[];
}

/**
 * Minimal structural view of SDK stream messages — keeps us decoupled from
 * SDK type exports and lets tests feed scripted sequences.
 */
export interface SdkMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  slash_commands?: string[];
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  message?: {
    content?: Array<{ type: string; text?: string; name?: string }>;
  };
}

export interface QueryOptions {
  model: string;
  cwd: string;
  maxTurns: number;
  permissionMode: string;
  settingSources: string[];
  systemPrompt: { type: 'preset'; preset: 'claude_code'; append?: string };
  allowedTools?: string[];
  abortController?: AbortController;
}

/** Injectable seam: real SDK `query` in production, ScriptedQueryFn in tests/dry-run. */
export type QueryFn = (args: { prompt: string; options: QueryOptions }) => AsyncIterable<SdkMessage>;
