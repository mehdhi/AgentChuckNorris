import { z } from 'zod';
import { GOAL_CHECK_MAX_TURNS } from '../config/defaults.js';
import { runSession, type RunnerDeps } from '../sdk/runner.js';
import type { SessionResult } from '../sdk/types.js';
import type { RunState, StoryState } from '../state/types.js';
import { extractLastJsonBlock } from '../util/json.js';

export const Verdict = z.object({
  verdict: z.enum(['pass', 'fail']),
  failedCriteria: z.array(z.string()).default([]),
  summary: z.string().default(''),
});
export type Verdict = z.infer<typeof Verdict>;

export interface GoalCheckOutcome {
  verdict: Verdict;
  session: SessionResult;
}

function goalCheckPrompt(state: RunState, story: StoryState): string {
  const criteria =
    story.acceptanceCriteria.length > 0
      ? story.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(none captured — judge against the story goal and the story file)';
  const diffInstruction = story.baselineCommit
    ? `Run \`git diff ${story.baselineCommit}..HEAD\` and \`git status\` to see exactly what this story changed.`
    : 'This repo has no recorded baseline commit; review the current working tree state.';

  return `You are a strict goal verifier for one development story. Do not write or fix any code.

Story file: ${story.storyFile ?? '(unknown — locate it by key)'}
Story key: ${story.key}
Story goal: ${story.goal ?? '(see story file)'}
Overall project goal (context only): ${state.overallGoal}

Acceptance criteria to verify:
${criteria}

Steps:
1. Read the story file, including its "ChuckNorris Tracking" section.
2. ${diffInstruction}
3. If the project has an obvious cheap test command (package.json scripts.test, Makefile test), run it.
4. Verify each acceptance criterion against the actual implementation, not the story's claims.

Respond however you like, but the LAST line of your reply must be exactly one JSON object:
{"verdict":"pass"|"fail","failedCriteria":["<criterion text>"],"summary":"<one or two sentences>"}`;
}

/**
 * Separate fresh session with the review model. Fail-closed: an unparseable
 * verdict counts as a fail and consumes a retry.
 */
export async function runGoalCheck(
  state: RunState,
  story: StoryState,
  deps: RunnerDeps,
): Promise<GoalCheckOutcome> {
  const session = await runSession(
    {
      label: `goal-check:${story.key}`,
      model: state.modelMap.review,
      prompt: goalCheckPrompt(state, story),
      cwd: state.targetRepo,
      maxTurns: GOAL_CHECK_MAX_TURNS,
      allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
    },
    deps,
  );

  const parsed = extractLastJsonBlock(session.finalText);
  const result = Verdict.safeParse(parsed);
  if (!session.ok || !result.success) {
    return {
      session,
      verdict: {
        verdict: 'fail',
        failedCriteria: [],
        summary: !session.ok
          ? `goal-check session failed (${session.subtype})`
          : 'verifier verdict unparseable — treating as fail',
      },
    };
  }
  return { session, verdict: result.data };
}
