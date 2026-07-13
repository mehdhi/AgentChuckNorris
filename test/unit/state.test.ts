import { describe, expect, it } from 'vitest';
import {
  addSessionCost,
  budgetExceeded,
  markEpicRetrospected,
  newRunState,
  nextPendingStep,
  patchStory,
  recordStepResult,
  reserveFeatureNumber,
  setChainTip,
  setStepStatus,
  setWaiting,
  upsertStory,
  RunState,
  type StoryState,
} from '../../src/state/types.js';
import { DEFAULT_MODEL_MAP } from '../../src/config/defaults.js';

function base() {
  return newRunState({
    runId: 'r1',
    targetRepo: '/tmp/x',
    problemStatement: 'p',
    overallGoal: 'g',
    modelMap: DEFAULT_MODEL_MAP,
    maxRetries: 2,
    enabledSteps: ['prd', 'architecture', 'epics-stories', 'sprint-planning', 'dev-loop'],
  });
}

const story: StoryState = {
  key: '1-1-login',
  epic: 1,
  status: 'pending',
  storyFile: null,
  goal: null,
  acceptanceCriteria: [],
  attempts: 0,
  baselineCommit: null,
  lastFailure: null,
  reviewDigest: null,
  operatorGuidance: null,
  branch: null,
  prBase: null,
  prNumber: null,
  prUrl: null,
};

describe('state reducers', () => {
  it('newRunState marks disabled steps skipped', () => {
    const s = base();
    expect(s.steps.find((x) => x.id === 'brainstorm')?.status).toBe('skipped');
    expect(s.steps.find((x) => x.id === 'prd')?.status).toBe('pending');
  });

  it('round-trips through zod schema', () => {
    const s = base();
    expect(RunState.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('nextPendingStep walks pipeline in order, includes in_progress', () => {
    let s = base();
    expect(nextPendingStep(s)?.id).toBe('prd');
    s = setStepStatus(s, 'prd', 'in_progress');
    expect(nextPendingStep(s)?.id).toBe('prd');
    s = recordStepResult(s, 'prd', { status: 'completed', costUsd: 1.5, artifact: 'docs/prd.md' });
    expect(nextPendingStep(s)?.id).toBe('architecture');
  });

  it('nextPendingStep null when everything done', () => {
    let s = base();
    for (const step of s.steps) {
      if (step.status === 'pending') s = setStepStatus(s, step.id, 'completed');
    }
    expect(nextPendingStep(s)).toBeNull();
  });

  it('upsertStory + patchStory immutably update', () => {
    let s = upsertStory(base(), story);
    s = patchStory(s, story.key, { attempts: 1, status: 'in_progress' });
    expect(s.devLoop.stories[story.key]?.attempts).toBe(1);
    expect(() => patchStory(s, 'nope', {})).toThrow(/unknown story/);
  });

  it('stackedPrs defaults on; feature counter and chain tip advance separately', () => {
    const s = base();
    expect(s.stackedPrs).toBe(true);
    expect(s.devLoop.featureSeq).toBe(0);
    expect(s.devLoop.chainTipBranch).toBeNull();

    const r1 = reserveFeatureNumber(s);
    expect(r1.seq).toBe(1);
    expect(r1.state.devLoop.featureSeq).toBe(1);
    expect(r1.state.devLoop.chainTipBranch).toBeNull(); // reserving a number never moves the tip

    const tipped = setChainTip(r1.state, 'feat/01-x');
    expect(tipped.devLoop.chainTipBranch).toBe('feat/01-x');
    expect(reserveFeatureNumber(tipped).seq).toBe(2); // monotonic
  });

  it('old state files without stacked-PR fields parse with defaults', () => {
    const s = base() as unknown as Record<string, unknown>;
    delete s['stackedPrs'];
    const dl = s['devLoop'] as Record<string, unknown>;
    delete dl['featureSeq'];
    delete dl['chainTipBranch'];
    const parsed = RunState.parse(JSON.parse(JSON.stringify(s)));
    expect(parsed.stackedPrs).toBe(true);
    expect(parsed.devLoop.featureSeq).toBe(0);
    expect(parsed.devLoop.chainTipBranch).toBeNull();
  });

  it('cost accumulation + budget guard', () => {
    let s = { ...base(), maxBudgetUsd: 2 };
    s = addSessionCost(s, 1.2);
    expect(budgetExceeded(s)).toBe(false);
    s = addSessionCost(s, 0.9);
    expect(s.totals).toEqual({ costUsd: 2.1, sessions: 2 });
    expect(budgetExceeded(s)).toBe(true);
  });

  it('budget never exceeded when unset', () => {
    const s = addSessionCost(base(), 999);
    expect(budgetExceeded(s)).toBe(false);
  });

  it('waiting set/clear', () => {
    let s = setWaiting(base(), { reason: 'goal_check_failed', storyKey: 'k', message: 'm' });
    expect(s.waiting?.reason).toBe('goal_check_failed');
    s = setWaiting(s, null);
    expect(s.waiting).toBeNull();
  });

  it('retrospected epics deduplicate', () => {
    let s = markEpicRetrospected(base(), 1);
    s = markEpicRetrospected(s, 1);
    expect(s.devLoop.retrospectedEpics).toEqual([1]);
  });
});
