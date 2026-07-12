export type AckKind = 'continue' | 'retry' | 'skip' | 'abort';

export interface AckCommand {
  kind: AckKind;
  /** Freeform operator text — appended to the next dev session as guidance. */
  guidance: string | null;
  source: string;
}

export interface AckSource {
  name: string;
  /** Resolve on the first valid command; must stop cleanly when signal aborts. */
  wait(signal: AbortSignal): Promise<AckCommand>;
}

/**
 * '/go' | 'continue' → continue; '/retry' → retry; '/skip' → skip; '/abort' | 'stop' → abort;
 * anything else → retry with the text as operator guidance.
 */
export function parseAckText(text: string, source: string): AckCommand {
  const norm = text.trim().replace(/^\//, '').toLowerCase();
  if (['go', 'continue', 'ok', 'resume'].includes(norm)) return { kind: 'continue', guidance: null, source };
  if (norm === 'retry') return { kind: 'retry', guidance: null, source };
  if (norm === 'skip') return { kind: 'skip', guidance: null, source };
  if (['abort', 'stop', 'quit'].includes(norm)) return { kind: 'abort', guidance: null, source };
  return { kind: 'retry', guidance: text.trim(), source };
}
