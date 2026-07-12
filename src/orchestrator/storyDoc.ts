import { promises as fs } from 'node:fs';
import { atomicWriteFile } from '../util/atomicWrite.js';
import type { StoryState } from '../state/types.js';

const BEGIN = '<!-- chucknorris:begin -->';
const END = '<!-- chucknorris:end -->';

/**
 * The story .md is the model-readable mirror of agent state: fresh dev sessions
 * read it, so retry/failure context travels via document rather than chat
 * history (BMAD docs-as-state philosophy). state.json remains source of truth —
 * this block is rewritten from it after every step, so BMAD workflows that
 * rewrite the story file cannot permanently clobber it.
 */
export function renderTrackingBlock(story: StoryState, maxRetries: number): string {
  const lines = [
    BEGIN,
    '## ChuckNorris Tracking',
    '',
    '_Managed by ChuckNorrisAgent — do not edit by hand; rewritten after every step._',
    '',
    `- Goal: ${story.goal ?? '(not captured yet)'}`,
    `- Status: ${story.status}`,
    `- Attempts: ${story.attempts}/${maxRetries + 1}`,
  ];
  if (story.lastFailure) {
    lines.push(
      `- Last goal-check: FAIL — ${story.lastFailure.failedCriteria.join(', ') || 'unspecified criteria'}`,
      `- Verifier summary: ${story.lastFailure.summary}`,
    );
  } else if (story.status === 'done') {
    lines.push('- Last goal-check: PASS');
  }
  if (story.reviewDigest) {
    lines.push('- Review digest:', '', '```', story.reviewDigest, '```');
  }
  if (story.operatorGuidance) {
    lines.push(`- Operator guidance: ${story.operatorGuidance}`);
  }
  lines.push(END);
  return lines.join('\n');
}

/** Idempotently replace (or append) the managed block in the story file. */
export async function writeTrackingBlock(
  storyFile: string,
  story: StoryState,
  maxRetries: number,
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(storyFile, 'utf8');
  } catch {
    return; // story file missing — nothing to mirror into
  }
  const block = renderTrackingBlock(story, maxRetries);
  const begin = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  let updated: string;
  if (begin >= 0 && end > begin) {
    updated = content.slice(0, begin) + block + content.slice(end + END.length);
  } else {
    updated = content.trimEnd() + '\n\n' + block + '\n';
  }
  await atomicWriteFile(storyFile, updated);
}

/** Parse `## Acceptance Criteria` list items out of a BMAD story markdown file. */
export function parseAcceptanceCriteria(markdown: string): string[] {
  const m = markdown.match(/^#{2,3}\s*Acceptance Criteria\s*$([\s\S]*?)(?=^#{1,3}\s|\n?$(?![\s\S]))/im);
  if (!m?.[1]) return [];
  const items: string[] = [];
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s*)?(.+)$/);
    if (item?.[1]) items.push(item[1].trim());
  }
  return items;
}

/** Parse the story statement (## Story section, or first paragraph as fallback). */
export function parseStoryGoal(markdown: string): string | null {
  const m = markdown.match(/^#{2,3}\s*Story\s*$([\s\S]*?)(?=^#{1,3}\s)/im);
  const section = m?.[1]?.trim();
  if (section) return section.split('\n\n')[0]?.trim() ?? null;
  return null;
}
