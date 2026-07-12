import { z } from 'zod';

/**
 * Optional "caveman" output style applied to every orchestrated SDK session.
 * Compresses model chatter (which is what most session cost/turns is spent on)
 * without touching correctness: code, commits, structured output, and safety
 * text are always exempted in the append below.
 */
export const CavemanLevel = z.enum(['off', 'lite', 'full', 'ultra']);
export type CavemanLevel = z.infer<typeof CavemanLevel>;

/** Rules that must survive at every level — correctness beats brevity. */
const EXEMPTIONS =
  'ALWAYS write normally (never compressed): source code, code comments, commit messages, PR ' +
  'descriptions, and any required structured output such as JSON blocks or verdicts — reproduce ' +
  'these exactly as specified. Security warnings, destructive/irreversible-action confirmations, ' +
  'and any multi-step ordering must stay full, unambiguous prose. Keep technical terms, ' +
  'identifiers, file paths, and shell commands verbatim. Never sacrifice a fact for brevity.';

const BODY: Record<Exclude<CavemanLevel, 'off'>, string> = {
  lite:
    'Output style: concise. Cut pleasantries, hedging, and filler (just/really/basically/' +
    'actually/simply). Keep full sentences and articles. Do not narrate tool calls or dump long ' +
    'raw logs — quote the shortest decisive line.',
  full:
    'Output style: CAVEMAN. Write terse, like a smart caveman — keep ALL technical substance, cut ' +
    'only fluff. Drop articles (a/an/the), filler (just/really/basically/actually/simply), ' +
    'pleasantries, and hedging. Sentence fragments are fine. Prefer short synonyms (big not ' +
    'extensive, fix not implement). No decorative tables or emoji. Do not narrate tool calls; do ' +
    'not dump long raw logs — quote the shortest decisive line.',
  ultra:
    'Output style: CAVEMAN ULTRA. Maximally terse. Telegraphic fragments only, no articles, no ' +
    'connective filler, no pleasantries, no hedging, no tool-call narration, no decorative tables ' +
    'or emoji. One short clause per point. Quote only the single decisive line from any output.',
};

/**
 * The `systemPrompt.append` string for a level, or `undefined` for 'off'
 * (leaves the preset system prompt untouched).
 */
export function cavemanAppend(level: CavemanLevel): string | undefined {
  if (level === 'off') return undefined;
  return `\n\n=== ${BODY[level]}\n\n${EXEMPTIONS}`;
}
