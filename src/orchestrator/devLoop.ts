import { promises as fs } from 'node:fs';
import { MAX_TURNS, REVIEW_DIGEST_MAX_CHARS } from '../config/defaults.js';
import {
  markEpicRetrospected,
  patchStory,
  reserveFeatureNumber,
  setChainTip,
  setSprintStatusPath,
  upsertStory,
  type RunState,
  type StoryState,
} from '../state/types.js';
import { extractLastJsonBlock } from '../util/json.js';
import { findFile } from '../util/findFile.js';
import {
  commitsAhead,
  gitCommitAll,
  gitCreateBranch,
  gitDefaultBranch,
  gitHead,
  gitPush,
  gitSwitch,
  hasUncommittedChanges,
} from '../util/git.js';
import { ghCreatePr } from '../util/github.js';
import { runGoalCheck } from './goalChecker.js';
import { NONINTERACTIVE_SUFFIX } from './phases.js';
import {
  info,
  pauseForAck,
  RunAborted,
  runTrackedSession,
  type OrchestratorDeps,
} from './sessionHelpers.js';
import { locateSprintStatus, parseSprintStatus, type SprintStoryEntry } from './sprintStatus.js';
import { parseAcceptanceCriteria, parseStoryGoal, writeTrackingBlock } from './storyDoc.js';

function slashOrSkill(state: RunState, command: string, args: string): string {
  const body =
    state.slashCommandsAvailable === false
      ? `Use the ${command} workflow/skill installed in this repository. ${args}`.trim()
      : `/${command} ${args}`.trim();
  return body + NONINTERACTIVE_SUFFIX;
}

/**
 * Implementation phase. Context isolation is absolute: every step of every
 * story is a fresh session; all carry-over context lives in the story file's
 * ChuckNorris Tracking block and BMAD's own documents.
 */
export async function runDevLoop(state: RunState, deps: OrchestratorDeps): Promise<RunState> {
  state = await ensureSprintStatus(state, deps);

  for (;;) {
    const entries = await parseSprintStatus(state.devLoop.sprintStatusPath!);
    state = syncStories(state, entries);
    await deps.persist(state);

    const next = entries.find((e) => {
      const s = state.devLoop.stories[e.key];
      return !e.done && s?.status !== 'done' && s?.status !== 'skipped';
    });
    if (!next) break;

    state = await processStory(state, next.key, deps);
    state = await maybeRetrospective(state, next.epic, deps);
  }
  return state;
}

async function ensureSprintStatus(state: RunState, deps: OrchestratorDeps): Promise<RunState> {
  if (state.devLoop.sprintStatusPath) return state;
  const located = await locateSprintStatus(state.targetRepo, deps.bmadOutputFolder);
  if (!located) {
    const { state: after, ack } = await pauseForAck(state, deps, {
      reason: 'step_failed',
      storyKey: null,
      message:
        'sprint-status.yaml not found — did sprint-planning run? Fix manually then reply /retry, or /abort.',
    });
    if (ack.kind === 'abort') throw new RunAborted('sprint-status missing');
    return ensureSprintStatus(after, deps);
  }
  state = setSprintStatusPath(state, located);
  await deps.persist(state);
  return state;
}

function syncStories(state: RunState, entries: SprintStoryEntry[]): RunState {
  for (const e of entries) {
    if (!state.devLoop.stories[e.key]) {
      state = upsertStory(state, {
        key: e.key,
        epic: e.epic,
        status: e.done ? 'done' : 'pending',
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
      });
    }
  }
  return state;
}

async function processStory(state: RunState, key: string, deps: OrchestratorDeps): Promise<RunState> {
  state = patchStory(state, key, { status: 'in_progress' });
  await deps.persist(state);
  await info(deps.logger, deps.notifier, `story ${key}`, 'starting');

  state = await startStoryBranch(state, key, deps);
  state = await ensureStoryFile(state, key, deps);
  state = await ensureGoal(state, key, deps);

  const story = () => state.devLoop.stories[key]!;
  if (!story().baselineCommit) {
    const head = await gitHead(state.targetRepo);
    if (!head) deps.logger.warn('target is not a git repo — goal checks will review working tree only');
    state = patchStory(state, key, { baselineCommit: head });
    await deps.persist(state);
  }

  for (;;) {
    state = patchStory(state, key, { attempts: story().attempts + 1 });
    await syncTrackingBlock(state, key);
    await deps.persist(state);

    // implement (coding model)
    const devPrompt = buildDevPrompt(state, story());
    const dev = await runTrackedSession(
      state,
      {
        label: `dev-story:${key}`,
        model: state.modelMap.coding,
        prompt: devPrompt,
        cwd: state.targetRepo,
        maxTurns: MAX_TURNS.coding,
      },
      deps,
    );
    state = dev.state;

    // review (review model)
    const review = await runTrackedSession(
      state,
      {
        label: `code-review:${key}`,
        model: state.modelMap.review,
        prompt: slashOrSkill(state, 'bmad-code-review', `Review the implementation of story ${key} (${story().storyFile}).`),
        cwd: state.targetRepo,
        maxTurns: MAX_TURNS.review,
      },
      deps,
    );
    state = review.state;
    state = patchStory(state, key, {
      reviewDigest: review.session.finalText.slice(0, REVIEW_DIGEST_MAX_CHARS),
    });
    await syncTrackingBlock(state, key);
    await deps.persist(state);

    // verify goal (review model, fresh session, fail-closed)
    const { verdict, session: checkSession } = await runGoalCheck(state, story(), {
      queryFn: deps.queryFn,
      logger: deps.logger,
      abortController: deps.abort,
      ...(deps.systemPromptAppend ? { systemPromptAppend: deps.systemPromptAppend } : {}),
    });
    state = addCheckCost(state, checkSession.costUsd);
    await deps.persist(state);

    if (verdict.verdict === 'pass') {
      state = patchStory(state, key, { status: 'done', lastFailure: null, operatorGuidance: null });
      await syncTrackingBlock(state, key);
      await deps.persist(state);
      state = await openStoryPr(state, key, deps);
      const pr = state.devLoop.stories[key]!.prUrl;
      await info(
        deps.logger,
        deps.notifier,
        `story ${key}`,
        `PASS after ${story().attempts} attempt(s) — ${verdict.summary}${pr ? ` — ${pr}` : ''}`,
      );
      return state;
    }

    state = patchStory(state, key, {
      lastFailure: { summary: verdict.summary, failedCriteria: verdict.failedCriteria },
    });
    await syncTrackingBlock(state, key);
    await deps.persist(state);
    deps.logger.warn(`story ${key} goal-check FAIL (attempt ${story().attempts}): ${verdict.summary}`);

    if (story().attempts <= state.maxRetries) continue; // auto-retry with context in tracking block

    // retries exhausted — operator decides
    const { state: after, ack } = await pauseForAck(state, deps, {
      reason: 'goal_check_failed',
      storyKey: key,
      message:
        `Story ${key} failed goal verification after ${story().attempts} attempts.\n` +
        `Failed criteria: ${verdict.failedCriteria.join('; ') || 'unspecified'}\n` +
        `Summary: ${verdict.summary}`,
    });
    state = after;
    if (ack.kind === 'abort') throw new RunAborted(`story ${key} unresolved`);
    if (ack.kind === 'skip') {
      state = patchStory(state, key, { status: 'skipped' });
      await syncTrackingBlock(state, key);
      await deps.persist(state);
      await info(deps.logger, deps.notifier, `story ${key}`, 'skipped by operator');
      return state;
    }
    // continue/retry (freeform text arrives as guidance): reset the attempt budget
    state = patchStory(state, key, { attempts: 0, operatorGuidance: ack.guidance });
    await syncTrackingBlock(state, key);
    await deps.persist(state);
  }
}

function buildDevPrompt(state: RunState, story: StoryState): string {
  const parts: string[] = [];
  if (story.attempts > 1 || story.lastFailure || story.operatorGuidance) {
    parts.push(
      `RETRY CONTEXT: a previous attempt on this story did not pass goal verification (or was interrupted). ` +
        `First read the story file INCLUDING its "ChuckNorris Tracking" section — it lists the failed ` +
        `criteria, verifier summary, review findings, and any operator guidance. ` +
        (story.baselineCommit ? `Inspect \`git diff ${story.baselineCommit}..HEAD\` to see existing progress. ` : '') +
        `Fix the specific issues; do not redo completed work.`,
    );
  }
  parts.push(slashOrSkill(state, 'bmad-dev-story', `Implement story ${story.key} (${story.storyFile}).`));
  return parts.join('\n\n');
}

// ---------- stacked-PR-per-story workflow ----------

const pad2 = (n: number): string => String(n).padStart(2, '0');
const slugify = (s: string): string =>
  s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'story';
const featureNumberFromBranch = (branch: string): string => branch.match(/^feat\/(\d+)-/)?.[1] ?? '00';
const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Cut this story's numbered feature branch before any work lands, so the story
 * file and its implementation both live on `feat/NN-<key>`. Base is the current
 * chain tip (the previous passed story's branch), else the repo default branch.
 * Any failure downgrades gracefully: the run continues, just without a PR.
 */
async function startStoryBranch(state: RunState, key: string, deps: OrchestratorDeps): Promise<RunState> {
  if (!deps.stackedPrs) return state;
  const cwd = state.targetRepo;
  const story = state.devLoop.stories[key]!;

  if (story.branch) {
    // Resume: branch already created on a prior run — get back onto it.
    try {
      await gitSwitch(cwd, story.branch);
    } catch (err) {
      deps.logger.warn(`stacked-PR: could not switch to ${story.branch}: ${String(err)}`);
    }
    return state;
  }

  const base = state.devLoop.chainTipBranch ?? (await gitDefaultBranch(cwd));
  const { state: reserved, seq } = reserveFeatureNumber(state);
  const branch = `feat/${pad2(seq)}-${slugify(key)}`;
  try {
    await gitCreateBranch(cwd, branch, base);
  } catch (err) {
    deps.logger.warn(
      `stacked-PR: failed to create ${branch} from ${base}: ${String(err)} — continuing without a PR for ${key}`,
    );
    return reserved; // number stays burned to keep NN monotonic
  }
  state = patchStory(reserved, key, { branch, prBase: base });
  await deps.persist(state);
  deps.logger.info(`stacked-PR: story ${key} on ${branch} (base ${base})`);
  return state;
}

/**
 * After a story passes: ensure its work is committed, push the branch, and open
 * a stacked PR against its base (the parent story's branch, or the default
 * branch). The chain tip only advances here — so a skipped/failed story never
 * becomes the base of the next one. Push/PR failures are surfaced but never fail
 * the story; the work is already committed locally.
 */
async function openStoryPr(state: RunState, key: string, deps: OrchestratorDeps): Promise<RunState> {
  if (!deps.stackedPrs) return state;
  const cwd = state.targetRepo;
  const story = state.devLoop.stories[key]!;
  if (!story.branch || story.prNumber) return state; // no branch, or PR already open

  const base = story.prBase ?? (await gitDefaultBranch(cwd));
  const nn = featureNumberFromBranch(story.branch);

  if (await hasUncommittedChanges(cwd)) {
    await gitCommitAll(cwd, `[${nn}] ${key}`);
  }
  if ((await commitsAhead(cwd, base)) === 0) {
    deps.logger.warn(`stacked-PR: ${story.branch} has no commits vs ${base} — no PR for ${key}`);
    return state;
  }

  try {
    await gitPush(cwd, story.branch);
  } catch (err) {
    deps.logger.warn(`stacked-PR: push failed for ${story.branch}: ${String(err)}`);
    await deps.notifier.send({
      title: `story ${key}`,
      body: `Work committed on ${story.branch}, but git push failed: ${String(err)}`,
      priority: 'info',
    });
    return state;
  }

  const parentPr =
    Object.values(state.devLoop.stories).find((s) => s.branch === story.prBase)?.prNumber ?? null;
  const title = `[${nn}] ${story.goal ? truncate(story.goal, 60) : key}`;
  const body =
    `Automated implementation of story \`${key}\`.` +
    (story.goal ? `\n\nGoal: ${story.goal}` : '') +
    (parentPr ? `\n\nStacked on: #${parentPr}` : '');

  const pr = await ghCreatePr(cwd, { base, head: story.branch, title, body });
  if (!pr) {
    deps.logger.warn(`stacked-PR: gh pr create failed for ${story.branch}`);
    await deps.notifier.send({
      title: `story ${key}`,
      body: `Pushed ${story.branch} but PR creation failed — open it manually against ${base}.`,
      priority: 'info',
    });
    return state;
  }

  state = patchStory(state, key, { prNumber: pr.number, prUrl: pr.url });
  state = setChainTip(state, story.branch); // advance the chain only on a clean pass + PR
  await syncTrackingBlock(state, key);
  await deps.persist(state);
  deps.logger.info(`stacked-PR: opened #${pr.number} ${pr.url}`);
  return state;
}

async function ensureStoryFile(state: RunState, key: string, deps: OrchestratorDeps): Promise<RunState> {
  const existing = await locateStoryFile(state, key, deps);
  if (existing) {
    return persistPatch(state, key, { storyFile: existing }, deps);
  }
  const created = await runTrackedSession(
    state,
    {
      label: `create-story:${key}`,
      model: state.modelMap.planning,
      prompt: slashOrSkill(
        state,
        'bmad-create-story',
        `Draft the story for sprint item "${key}". Overall goal: ${state.overallGoal}`,
      ),
      cwd: state.targetRepo,
      maxTurns: MAX_TURNS.planning,
    },
    deps,
  );
  state = created.state;
  const found = await locateStoryFile(state, key, deps);
  if (!found) {
    const { state: after, ack } = await pauseForAck(state, deps, {
      reason: 'step_failed',
      storyKey: key,
      message: `create-story ran but no story file for "${key}" was found. Fix manually, then /retry — or /skip, /abort.`,
    });
    if (ack.kind === 'abort') throw new RunAborted(`story file missing for ${key}`);
    if (ack.kind === 'skip') {
      return persistPatch(after, key, { status: 'skipped' }, deps);
    }
    return ensureStoryFile(after, key, deps);
  }
  return persistPatch(state, key, { storyFile: found }, deps);
}

async function locateStoryFile(
  state: RunState,
  key: string,
  deps: OrchestratorDeps,
): Promise<string | null> {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[-_.])${escaped}.*\\.md$|^${escaped}\\.md$`, 'i');
  if (deps.bmadOutputFolder) {
    const hit = await findFile(deps.bmadOutputFolder, pattern, 4);
    if (hit) return hit;
  }
  return findFile(state.targetRepo, pattern, 5);
}

async function ensureGoal(state: RunState, key: string, deps: OrchestratorDeps): Promise<RunState> {
  const story = state.devLoop.stories[key]!;
  if (story.goal && story.acceptanceCriteria.length > 0) return state;
  if (story.status === 'skipped' || !story.storyFile) return state;

  const markdown = await fs.readFile(story.storyFile, 'utf8');
  let goal = parseStoryGoal(markdown);
  let criteria = parseAcceptanceCriteria(markdown);

  if (!goal || criteria.length === 0) {
    // grunt-model fallback when the story format defeats the regexes
    const extract = await runTrackedSession(
      state,
      {
        label: `goal-extract:${key}`,
        model: state.modelMap.grunt,
        prompt:
          `Read ${story.storyFile} and reply with ONLY one JSON object on the last line: ` +
          `{"goal":"<one-sentence story goal>","acceptanceCriteria":["<criterion>", ...]}`,
        cwd: state.targetRepo,
        maxTurns: MAX_TURNS.grunt,
        allowedTools: ['Read'],
      },
      deps,
    );
    state = extract.state;
    const parsed = extractLastJsonBlock(extract.session.finalText) as {
      goal?: string;
      acceptanceCriteria?: string[];
    } | null;
    goal = goal ?? parsed?.goal ?? null;
    if (criteria.length === 0 && Array.isArray(parsed?.acceptanceCriteria)) {
      criteria = parsed.acceptanceCriteria.filter((c): c is string => typeof c === 'string');
    }
  }

  state = await persistPatch(state, key, { goal, acceptanceCriteria: criteria }, deps);
  await syncTrackingBlock(state, key);
  return state;
}

async function maybeRetrospective(state: RunState, epic: number, deps: OrchestratorDeps): Promise<RunState> {
  if (state.devLoop.retrospectedEpics.includes(epic)) return state;
  const remaining = Object.values(state.devLoop.stories).some(
    (s) => s.epic === epic && s.status !== 'done' && s.status !== 'skipped',
  );
  if (remaining) return state;

  const retro = await runTrackedSession(
    state,
    {
      label: `retrospective:epic-${epic}`,
      model: state.modelMap.grunt,
      prompt: slashOrSkill(state, 'bmad-retrospective', `Run the retrospective for epic ${epic}.`),
      cwd: state.targetRepo,
      maxTurns: MAX_TURNS.grunt,
    },
    deps,
  );
  state = markEpicRetrospected(retro.state, epic);
  await deps.persist(state);
  await info(deps.logger, deps.notifier, `epic ${epic}`, 'complete — retrospective recorded');
  return state;
}

async function persistPatch(
  state: RunState,
  key: string,
  patch: Partial<StoryState>,
  deps: OrchestratorDeps,
): Promise<RunState> {
  state = patchStory(state, key, patch);
  await deps.persist(state);
  return state;
}

async function syncTrackingBlock(state: RunState, key: string): Promise<void> {
  const story = state.devLoop.stories[key]!;
  if (story.storyFile) await writeTrackingBlock(story.storyFile, story, state.maxRetries);
}

function addCheckCost(state: RunState, costUsd: number): RunState {
  return {
    ...state,
    totals: { costUsd: state.totals.costUsd + costUsd, sessions: state.totals.sessions + 1 },
  };
}
