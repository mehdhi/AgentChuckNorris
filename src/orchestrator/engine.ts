import { MAX_TURNS } from '../config/defaults.js';
import {
  nextPendingStep,
  patchStory,
  recordStepResult,
  setStepStatus,
  setWaiting,
  type RunState,
} from '../state/types.js';
import { runDevLoop } from './devLoop.js';
import { stepDef, type PhaseContext, type StepDef } from './phases.js';
import {
  info,
  pauseForAck,
  RunAborted,
  runTrackedSession,
  type OrchestratorDeps,
} from './sessionHelpers.js';

/**
 * Main loop: pull the next pending step from state, execute, persist, repeat.
 * Generic — all BMAD knowledge lives in the PIPELINE table and devLoop.
 */
export async function runEngine(state: RunState, deps: OrchestratorDeps): Promise<RunState> {
  state = await handlePendingWait(state, deps);

  for (;;) {
    const step = nextPendingStep(state);
    if (!step) break;

    const def = stepDef(step.id);

    // Resume path: a step left in_progress was interrupted mid-session.
    if (step.status === 'in_progress' && def.verifyArtifact) {
      const artifact = await def.verifyArtifact(ctx(state));
      if (artifact) {
        deps.logger.info(`resume: ${step.id} artifact found (${artifact}) — marking completed`);
        state = recordStepResult(state, step.id, { status: 'completed', artifact });
        await deps.persist(state);
        continue;
      }
    }

    state =
      def.kind === 'internal'
        ? await runDevLoopStep(state, deps)
        : await runBmadStep(state, def, deps);
  }

  state = await finalSummary(state, deps);
  return state;
}

function ctx(state: RunState): PhaseContext {
  return { state, slashMode: state.slashCommandsAvailable !== false };
}

async function runBmadStep(state: RunState, def: StepDef, deps: OrchestratorDeps): Promise<RunState> {
  state = setStepStatus(state, def.id, 'in_progress');
  await deps.persist(state);
  await info(deps.logger, deps.notifier, `phase ${def.id}`, `starting (${state.modelMap[def.modelRole]})`);

  for (;;) {
    const { state: after, session } = await runTrackedSession(
      state,
      {
        label: def.id,
        model: state.modelMap[def.modelRole],
        prompt: def.buildPrompt(ctx(state)),
        cwd: state.targetRepo,
        maxTurns: MAX_TURNS[def.modelRole],
      },
      deps,
    );
    state = after;

    // First BMAD session probes whether bmad slash commands are actually loaded.
    if (state.slashCommandsAvailable === null) {
      const available = session.slashCommands.some((c) => c.replace(/^\//, '').startsWith('bmad'));
      state = { ...state, slashCommandsAvailable: available };
      await deps.persist(state);
      if (!available) {
        deps.logger.warn('no bmad slash commands visible to the SDK — falling back to skill-instruction prompts');
        if (!session.ok) continue; // re-run this step in instruction mode
      }
    }

    if (session.ok) {
      const artifact = def.verifyArtifact ? await def.verifyArtifact(ctx(state)) : null;
      state = recordStepResult(state, def.id, {
        status: 'completed',
        sessionId: session.sessionId,
        costUsd: session.costUsd,
        ...(artifact ? { artifact } : {}),
      });
      await deps.persist(state);
      await info(
        deps.logger,
        deps.notifier,
        `phase ${def.id}`,
        `completed${artifact ? ` → ${artifact}` : ''} ($${session.costUsd.toFixed(2)})`,
      );
      return state;
    }

    const { state: paused, ack } = await pauseForAck(state, deps, {
      reason: 'step_failed',
      storyKey: null,
      message: `Phase ${def.id} failed (${session.subtype}). Reply /retry, /skip (dangerous for required phases), or /abort.`,
    });
    state = paused;
    if (ack.kind === 'abort') throw new RunAborted(`phase ${def.id} failed`);
    if (ack.kind === 'skip') {
      state = setStepStatus(state, def.id, 'skipped');
      await deps.persist(state);
      return state;
    }
    // retry/continue → loop and re-run the session
  }
}

async function runDevLoopStep(state: RunState, deps: OrchestratorDeps): Promise<RunState> {
  state = setStepStatus(state, 'dev-loop', 'in_progress');
  await deps.persist(state);
  state = await runDevLoop(state, deps);
  state = setStepStatus(state, 'dev-loop', 'completed');
  await deps.persist(state);
  return state;
}

/** Resume straight back into a pause: re-send the notification, wait again. */
async function handlePendingWait(state: RunState, deps: OrchestratorDeps): Promise<RunState> {
  if (!state.waiting) return state;
  const waiting = state.waiting;
  deps.logger.info(`resume: run was paused (${waiting.reason}) — re-requesting operator ack`);
  const { state: after, ack } = await pauseForAck(state, deps, waiting);
  state = after;
  if (ack.kind === 'abort') throw new RunAborted('operator abort on resume');
  if (waiting.storyKey && state.devLoop.stories[waiting.storyKey]) {
    if (ack.kind === 'skip') {
      state = patchStory(state, waiting.storyKey, { status: 'skipped' });
    } else {
      state = patchStory(state, waiting.storyKey, { attempts: 0, operatorGuidance: ack.guidance });
    }
    await deps.persist(state);
  }
  return state;
}

/** Informational close-out: cheap model judges the overall goal, then summary notification. */
async function finalSummary(state: RunState, deps: OrchestratorDeps): Promise<RunState> {
  const stories = Object.values(state.devLoop.stories);
  const done = stories.filter((s) => s.status === 'done').length;
  const skipped = stories.filter((s) => s.status === 'skipped').length;

  let goalLine = '(overall goal check skipped)';
  try {
    const { state: after, session } = await runTrackedSession(
      state,
      {
        label: 'overall-goal-check',
        model: state.modelMap.grunt,
        prompt:
          `The project goal was: "${state.overallGoal}". Skim the PRD, the sprint status, and the git log, ` +
          `then reply with ONE sentence: was the goal achieved, and what (if anything) is missing?`,
        cwd: state.targetRepo,
        maxTurns: MAX_TURNS.grunt,
        allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
      },
      deps,
    );
    state = after;
    goalLine = session.finalText.trim().split('\n').pop() ?? goalLine;
  } catch (err) {
    if (err instanceof RunAborted) throw err;
    deps.logger.warn(`overall goal check failed: ${String(err)}`);
  }

  await deps.notifier.send({
    title: 'run complete',
    body:
      `Stories: ${done} done, ${skipped} skipped of ${stories.length}. ` +
      `Total cost: $${state.totals.costUsd.toFixed(2)} across ${state.totals.sessions} sessions.\n` +
      `Overall goal: ${goalLine}`,
    priority: 'info',
  });
  state = setWaiting(state, null);
  await deps.persist(state);
  return state;
}
