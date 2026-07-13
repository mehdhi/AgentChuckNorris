import { z } from 'zod';
import { CavemanLevel } from '../config/caveman.js';
import { ModelMap } from '../config/schema.js';

export const STEP_IDS = [
  'brainstorm',
  'product-brief',
  'prd',
  'ux',
  'architecture',
  'epics-stories',
  'readiness',
  'sprint-planning',
  'dev-loop',
] as const;

export const StepId = z.enum(STEP_IDS);
export type StepId = z.infer<typeof StepId>;

export const StepStatus = z.enum(['pending', 'in_progress', 'completed', 'skipped', 'failed', 'paused']);
export type StepStatus = z.infer<typeof StepStatus>;

export const StepState = z.object({
  id: StepId,
  status: StepStatus,
  sessionId: z.string().optional(),
  costUsd: z.number().optional(),
  artifact: z.string().optional(),
});
export type StepState = z.infer<typeof StepState>;

export const StoryStatus = z.enum(['pending', 'in_progress', 'done', 'skipped']);
export type StoryStatus = z.infer<typeof StoryStatus>;

export const StoryFailure = z.object({
  summary: z.string(),
  failedCriteria: z.array(z.string()),
});
export type StoryFailure = z.infer<typeof StoryFailure>;

export const StoryState = z.object({
  key: z.string(),
  epic: z.number().int(),
  status: StoryStatus,
  storyFile: z.string().nullable(),
  goal: z.string().nullable(),
  acceptanceCriteria: z.array(z.string()),
  attempts: z.number().int(),
  baselineCommit: z.string().nullable(),
  lastFailure: StoryFailure.nullable(),
  reviewDigest: z.string().nullable(),
  operatorGuidance: z.string().nullable(),
  // Stacked-PR workflow (null when disabled/infeasible for the run).
  branch: z.string().nullable().default(null),
  prBase: z.string().nullable().default(null),
  prNumber: z.number().int().nullable().default(null),
  prUrl: z.string().nullable().default(null),
});
export type StoryState = z.infer<typeof StoryState>;

export const WaitingState = z.object({
  reason: z.enum(['goal_check_failed', 'step_failed', 'budget_exceeded']),
  storyKey: z.string().nullable(),
  message: z.string(),
});
export type WaitingState = z.infer<typeof WaitingState>;

export const RunState = z.object({
  version: z.literal(1),
  runId: z.string(),
  createdAt: z.string(),
  targetRepo: z.string(),
  problemStatement: z.string(),
  overallGoal: z.string(),
  modelMap: ModelMap,
  /** Output style for this run's sessions. Defaulted so pre-caveman state files still load. */
  caveman: CavemanLevel.default('off'),
  /** Open a numbered stacked PR per story. Defaulted so pre-feature state files still load. */
  stackedPrs: z.boolean().default(true),
  maxRetries: z.number().int(),
  maxBudgetUsd: z.number().nullable(),
  steps: z.array(StepState),
  devLoop: z.object({
    sprintStatusPath: z.string().nullable(),
    stories: z.record(z.string(), StoryState),
    retrospectedEpics: z.array(z.number().int()),
    /** Monotonic feature counter for feat/NN branch numbering. */
    featureSeq: z.number().int().default(0),
    /** Branch the next story's branch chains off (last story branch, else null → default branch). */
    chainTipBranch: z.string().nullable().default(null),
  }),
  waiting: WaitingState.nullable(),
  telegramOffset: z.number().int(),
  /** null = not yet probed; boolean = init-message probe result on first BMAD session. */
  slashCommandsAvailable: z.boolean().nullable(),
  totals: z.object({ costUsd: z.number(), sessions: z.number().int() }),
});
export type RunState = z.infer<typeof RunState>;

// ---------- reducers (pure — every transition goes through these) ----------

export function newRunState(init: {
  runId: string;
  targetRepo: string;
  problemStatement: string;
  overallGoal: string;
  modelMap: ModelMap;
  caveman?: CavemanLevel;
  stackedPrs?: boolean;
  maxRetries: number;
  maxBudgetUsd?: number | undefined;
  enabledSteps: StepId[];
}): RunState {
  return {
    version: 1,
    runId: init.runId,
    createdAt: new Date().toISOString(),
    targetRepo: init.targetRepo,
    problemStatement: init.problemStatement,
    overallGoal: init.overallGoal,
    modelMap: init.modelMap,
    caveman: init.caveman ?? 'off',
    stackedPrs: init.stackedPrs ?? true,
    maxRetries: init.maxRetries,
    maxBudgetUsd: init.maxBudgetUsd ?? null,
    steps: STEP_IDS.map((id) => ({
      id,
      status: init.enabledSteps.includes(id) ? 'pending' : 'skipped',
    })),
    devLoop: {
      sprintStatusPath: null,
      stories: {},
      retrospectedEpics: [],
      featureSeq: 0,
      chainTipBranch: null,
    },
    waiting: null,
    telegramOffset: 0,
    slashCommandsAvailable: null,
    totals: { costUsd: 0, sessions: 0 },
  };
}

export function setStepStatus(state: RunState, id: StepId, status: StepStatus): RunState {
  return {
    ...state,
    steps: state.steps.map((s) => (s.id === id ? { ...s, status } : s)),
  };
}

export function recordStepResult(
  state: RunState,
  id: StepId,
  result: { status: StepStatus; sessionId?: string; costUsd?: number; artifact?: string },
): RunState {
  return {
    ...state,
    steps: state.steps.map((s) => (s.id === id ? { ...s, ...result } : s)),
  };
}

export function nextPendingStep(state: RunState): StepState | null {
  return state.steps.find((s) => s.status === 'pending' || s.status === 'in_progress') ?? null;
}

export function upsertStory(state: RunState, story: StoryState): RunState {
  return {
    ...state,
    devLoop: {
      ...state.devLoop,
      stories: { ...state.devLoop.stories, [story.key]: story },
    },
  };
}

export function patchStory(state: RunState, key: string, patch: Partial<StoryState>): RunState {
  const existing = state.devLoop.stories[key];
  if (!existing) throw new Error(`patchStory: unknown story ${key}`);
  return upsertStory(state, { ...existing, ...patch });
}

export function setWaiting(state: RunState, waiting: WaitingState | null): RunState {
  return { ...state, waiting };
}

export function addSessionCost(state: RunState, costUsd: number): RunState {
  return {
    ...state,
    totals: { costUsd: state.totals.costUsd + costUsd, sessions: state.totals.sessions + 1 },
  };
}

export function budgetExceeded(state: RunState): boolean {
  return state.maxBudgetUsd !== null && state.totals.costUsd >= state.maxBudgetUsd;
}

export function setTelegramOffset(state: RunState, offset: number): RunState {
  return { ...state, telegramOffset: offset };
}

export function setSprintStatusPath(state: RunState, p: string): RunState {
  return { ...state, devLoop: { ...state.devLoop, sprintStatusPath: p } };
}

/** Reserve the next feat/NN number (increments at branch creation, pass or fail). */
export function reserveFeatureNumber(state: RunState): { state: RunState; seq: number } {
  const seq = state.devLoop.featureSeq + 1;
  return { seq, state: { ...state, devLoop: { ...state.devLoop, featureSeq: seq } } };
}

/** Advance the chain tip to `branch` — only after a story passes and its PR opens,
 * so later stories chain off the last *good* branch, never a skipped/partial one. */
export function setChainTip(state: RunState, branch: string): RunState {
  return { ...state, devLoop: { ...state.devLoop, chainTipBranch: branch } };
}

export function markEpicRetrospected(state: RunState, epic: number): RunState {
  if (state.devLoop.retrospectedEpics.includes(epic)) return state;
  return {
    ...state,
    devLoop: { ...state.devLoop, retrospectedEpics: [...state.devLoop.retrospectedEpics, epic] },
  };
}
