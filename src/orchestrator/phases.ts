import type { ModelRole } from '../config/schema.js';
import type { RunState, StepId } from '../state/types.js';
import { findFile } from '../util/findFile.js';

/**
 * The single most important prompt detail for unattended operation: BMAD v6
 * workflows are elicitation-heavy and will otherwise stall waiting for a human.
 */
export const NONINTERACTIVE_SUFFIX =
  '\n\nRun fully non-interactively (#yolo): when the workflow presents options, menus, or ' +
  'elicitation questions, choose the recommended default yourself and proceed without waiting ' +
  'for user input. Do not stop to ask questions; make sensible decisions and keep going until ' +
  'the workflow is complete.';

export interface PhaseContext {
  state: RunState;
  /** false → BMAD slash commands not visible to SDK; fall back to Skill-tool instruction prompts. */
  slashMode: boolean;
}

export interface StepDef {
  id: StepId;
  /** 'bmad' steps run an SDK session; 'internal' steps are handled by the engine (dev-loop). */
  kind: 'bmad' | 'internal';
  command: string | null;
  modelRole: ModelRole;
  optional: boolean;
  buildPrompt: (ctx: PhaseContext) => string;
  /** Resume support: locate this step's output artifact; found ⇒ step completed before crash. */
  verifyArtifact?: (ctx: PhaseContext) => Promise<string | null>;
}

/** `/bmad-prd args` in slash mode, otherwise instruct the model to invoke the skill. */
function invoke(ctx: PhaseContext, command: string, args: string): string {
  const body = ctx.slashMode
    ? `/${command} ${args}`.trim()
    : `Use the ${command} workflow/skill installed in this repository. ${args}`.trim();
  return body + NONINTERACTIVE_SUFFIX;
}

export const PIPELINE: StepDef[] = [
  {
    id: 'brainstorm',
    kind: 'bmad',
    command: 'bmad-brainstorming',
    modelRole: 'planning',
    optional: true,
    buildPrompt: (ctx) =>
      invoke(
        ctx,
        'bmad-brainstorming',
        `We are starting a new project. Problem statement: ${ctx.state.problemStatement}\n` +
          `Overall development goal: ${ctx.state.overallGoal}`,
      ),
  },
  {
    id: 'product-brief',
    kind: 'bmad',
    command: 'bmad-product-brief',
    modelRole: 'planning',
    optional: true,
    buildPrompt: (ctx) =>
      invoke(ctx, 'bmad-product-brief', `Problem statement: ${ctx.state.problemStatement}`),
    verifyArtifact: (ctx) => findFile(ctx.state.targetRepo, /^(product-)?brief.*\.md$/i),
  },
  {
    id: 'prd',
    kind: 'bmad',
    command: 'bmad-prd',
    modelRole: 'planning',
    optional: false,
    buildPrompt: (ctx) =>
      invoke(
        ctx,
        'bmad-prd',
        `Create the PRD. Problem statement: ${ctx.state.problemStatement}\n` +
          `Overall development goal (every requirement must serve this): ${ctx.state.overallGoal}`,
      ),
    verifyArtifact: (ctx) => findFile(ctx.state.targetRepo, /^prd.*\.md$/i),
  },
  {
    id: 'ux',
    kind: 'bmad',
    command: 'bmad-ux',
    modelRole: 'planning',
    optional: true,
    buildPrompt: (ctx) => invoke(ctx, 'bmad-ux', 'Design the UX/UI specification based on the PRD.'),
    verifyArtifact: (ctx) => findFile(ctx.state.targetRepo, /^ux.*\.md$/i),
  },
  {
    id: 'architecture',
    kind: 'bmad',
    command: 'bmad-create-architecture',
    modelRole: 'planning',
    optional: false,
    buildPrompt: (ctx) =>
      invoke(ctx, 'bmad-create-architecture', 'Create the architecture document based on the PRD.'),
    verifyArtifact: (ctx) => findFile(ctx.state.targetRepo, /^architecture.*\.md$/i),
  },
  {
    id: 'epics-stories',
    kind: 'bmad',
    command: 'bmad-create-epics-and-stories',
    modelRole: 'planning',
    optional: false,
    buildPrompt: (ctx) =>
      invoke(
        ctx,
        'bmad-create-epics-and-stories',
        `Generate epics and stories from the PRD and architecture.\n` +
          `Overall development goal — each story must state how it contributes: ${ctx.state.overallGoal}`,
      ),
    verifyArtifact: (ctx) => findFile(ctx.state.targetRepo, /^epic.*\.md$/i),
  },
  {
    id: 'readiness',
    kind: 'bmad',
    command: 'bmad-check-implementation-readiness',
    modelRole: 'grunt',
    optional: true,
    buildPrompt: (ctx) =>
      invoke(ctx, 'bmad-check-implementation-readiness', 'Validate cohesion across planning documents.'),
  },
  {
    id: 'sprint-planning',
    kind: 'bmad',
    command: 'bmad-sprint-planning',
    modelRole: 'grunt',
    optional: false,
    buildPrompt: (ctx) => invoke(ctx, 'bmad-sprint-planning', 'Run sprint planning for all epics.'),
    verifyArtifact: (ctx) => findFile(ctx.state.targetRepo, /^sprint-status\.ya?ml$/i, 5),
  },
  {
    id: 'dev-loop',
    kind: 'internal',
    command: null,
    modelRole: 'coding',
    optional: false,
    buildPrompt: () => '',
  },
];

export function stepDef(id: StepId): StepDef {
  const def = PIPELINE.find((s) => s.id === id);
  if (!def) throw new Error(`unknown step ${id}`);
  return def;
}
