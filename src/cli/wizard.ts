import * as p from '@clack/prompts';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bmadReady, detectBmad, type BmadInfo } from '../bmad/detect.js';
import { runBmadInstaller } from '../bmad/install.js';
import { DEFAULT_MAX_RETRIES, DEFAULT_MODEL_MAP } from '../config/defaults.js';
import type { GlobalConfig, ModelMap, ModelRole } from '../config/schema.js';
import type { StepId } from '../state/types.js';

export interface WizardResult {
  targetRepo: string;
  problemStatement: string;
  overallGoal: string;
  modelMap: ModelMap;
  enabledSteps: StepId[];
  maxRetries: number;
  maxBudgetUsd: number | undefined;
  bmad: BmadInfo;
}

const REQUIRED_STEPS: StepId[] = ['prd', 'architecture', 'epics-stories', 'sprint-planning', 'dev-loop'];

function bail(value: unknown): asserts value is string | string[] | boolean | number {
  if (p.isCancel(value)) {
    p.cancel('wizard cancelled');
    process.exit(1);
  }
}

export async function runWizard(global: GlobalConfig, targetFlag?: string): Promise<WizardResult> {
  p.intro('ChuckNorrisAgent — BMAD dev-loop orchestrator');

  // -- target repo ------------------------------------------------------
  const targetRaw =
    targetFlag ??
    ((await p.text({
      message: 'Target repository path',
      placeholder: process.cwd(),
      defaultValue: process.cwd(),
    })) as string);
  bail(targetRaw);
  const targetRepo = path.resolve(String(targetRaw));
  try {
    const stat = await fs.stat(targetRepo);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    p.cancel(`target repo not found: ${targetRepo}`);
    process.exit(1);
  }

  // -- BMAD install -----------------------------------------------------
  let bmad = await detectBmad(targetRepo);
  if (!bmad.installed) {
    const doInstall = await p.confirm({
      message: 'BMAD not installed in target. Run `npx bmad-method@latest install` now? (pick core + bmm, tool: Claude Code)',
    });
    bail(doInstall);
    if (doInstall) {
      bmad = await runBmadInstaller(targetRepo);
    }
    if (!bmad.installed) {
      p.cancel('BMAD is required. Install it in the target repo, then re-run.');
      process.exit(1);
    }
  }
  const ready = bmadReady(bmad);
  if (ready.warning) p.log.warn(ready.warning);
  p.log.success(`BMAD detected (modules: ${bmad.modules.join(', ') || 'unknown'})`);

  // -- problem + goal ---------------------------------------------------
  const problemStatement = await p.text({
    message: 'Define the problem (what are we building and why?)',
    validate: (v) => ((v ?? '').trim().length < 10 ? 'give it at least a sentence' : undefined),
  });
  bail(problemStatement);

  const overallGoal = await p.text({
    message: 'Overall development goal (checked at the end of the run)',
    validate: (v) => ((v ?? '').trim().length < 10 ? 'give it at least a sentence' : undefined),
  });
  bail(overallGoal);

  // -- process steps ----------------------------------------------------
  const optional = await p.multiselect({
    message: 'Optional phases to run (PRD, architecture, stories, and the dev loop always run)',
    options: [
      { value: 'brainstorm', label: 'Brainstorming session' },
      { value: 'product-brief', label: 'Product brief' },
      { value: 'ux', label: 'UX/UI design (project has a user interface)' },
      { value: 'readiness', label: 'Implementation readiness check', hint: 'recommended' },
    ],
    initialValues: ['readiness'],
    required: false,
  });
  bail(optional);
  const enabledSteps = [...REQUIRED_STEPS, ...(optional as StepId[])];

  // -- models -----------------------------------------------------------
  const useDefaults = await p.confirm({
    message:
      `Model mapping — planning: ${DEFAULT_MODEL_MAP.planning}, grunt: ${DEFAULT_MODEL_MAP.grunt}, ` +
      `coding: ${DEFAULT_MODEL_MAP.coding}, review: ${DEFAULT_MODEL_MAP.review}. Use these?`,
  });
  bail(useDefaults);
  let modelMap: ModelMap = { ...DEFAULT_MODEL_MAP };
  for (const role of ['planning', 'grunt', 'coding', 'review'] as ModelRole[]) {
    const override = global.modelMap?.[role];
    if (override) modelMap = { ...modelMap, [role]: override };
  }
  if (!useDefaults) {
    for (const role of ['planning', 'grunt', 'coding', 'review'] as ModelRole[]) {
      const v = await p.text({ message: `Model for ${role}`, defaultValue: modelMap[role], placeholder: modelMap[role] });
      bail(v);
      modelMap = { ...modelMap, [role]: String(v) };
    }
  }

  // -- limits -----------------------------------------------------------
  const retries = await p.text({
    message: 'Max auto-retries per story before pausing for you',
    defaultValue: String(DEFAULT_MAX_RETRIES),
    placeholder: String(DEFAULT_MAX_RETRIES),
    validate: (v) => (v && !/^\d+$/.test(v) ? 'whole number' : undefined),
  });
  bail(retries);

  const budget = await p.text({
    message: 'Max budget in USD (empty = no limit)',
    placeholder: 'e.g. 25',
    defaultValue: '',
    validate: (v) => (v && !/^\d+(\.\d+)?$/.test(v) ? 'number or empty' : undefined),
  });
  bail(budget);

  // -- notifier summary ---------------------------------------------------
  const channels = [
    'console',
    'desktop',
    global.ntfyTopic ? `ntfy (${global.ntfyTopic})` : null,
    global.telegramBotToken && global.telegramChatId ? 'telegram (ack channel)' : null,
  ].filter(Boolean);
  p.log.info(`Notification channels: ${channels.join(', ')}`);
  if (!global.telegramBotToken) {
    p.log.warn(
      'No Telegram configured — pause/resume acks will use the control file only ' +
        '(echo go > <target>/.chucknorris/control). Set telegramBotToken/telegramChatId in ' +
        '~/.config/chucknorris/config.json for phone acks.',
    );
  }

  p.outro('Configuration complete — starting the run.');

  return {
    targetRepo,
    problemStatement: String(problemStatement),
    overallGoal: String(overallGoal),
    modelMap,
    enabledSteps,
    maxRetries: Number(retries || DEFAULT_MAX_RETRIES),
    maxBudgetUsd: budget === '' ? undefined : Number(budget),
    bmad,
  };
}
