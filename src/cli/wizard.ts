import * as p from '@clack/prompts';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bmadReady, detectBmad, type BmadInfo } from '../bmad/detect.js';
import { runBmadInstaller } from '../bmad/install.js';
import type { CavemanLevel } from '../config/caveman.js';
import { DEFAULT_CAVEMAN, DEFAULT_MAX_RETRIES, DEFAULT_MODEL_MAP } from '../config/defaults.js';
import { saveGlobalConfig } from '../config/load.js';
import type { GlobalConfig, ModelMap, ModelRole } from '../config/schema.js';
import type { StepId } from '../state/types.js';

export interface WizardResult {
  targetRepo: string;
  problemStatement: string;
  overallGoal: string;
  modelMap: ModelMap;
  caveman: CavemanLevel;
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

const CAVEMAN_OPTIONS = [
  { value: 'off', label: 'off', hint: 'normal prose (default)' },
  { value: 'lite', label: 'lite', hint: 'trim filler, keep sentences' },
  { value: 'full', label: 'full', hint: 'classic terse caveman' },
  { value: 'ultra', label: 'ultra', hint: 'maximally terse' },
] as const;

/**
 * One-time global setup, run when ~/.config/chucknorris/config.json is absent.
 * Captures the durable, cross-project config (notifications, caveman style,
 * optional model overrides), persists it, and returns the merged config.
 * `current` carries any env-var overrides already resolved by loadGlobalConfig.
 */
export async function firstRunSetup(current: GlobalConfig): Promise<GlobalConfig> {
  p.intro('First run — configure ChuckNorrisAgent (saved globally, editable later)');
  p.note(
    'Stored at ~/.config/chucknorris/config.json. Re-run and hand-edit that file anytime.',
    'about',
  );

  // -- caveman output style --------------------------------------------
  const caveman = await p.select({
    message: 'Caveman output style for the agent throughout development',
    options: CAVEMAN_OPTIONS as unknown as { value: CavemanLevel; label: string; hint: string }[],
    initialValue: current.caveman ?? DEFAULT_CAVEMAN,
  });
  bail(caveman);

  // -- notifications ---------------------------------------------------
  const ntfyTopic = await p.text({
    message: 'ntfy.sh topic for phone push (empty = skip)',
    placeholder: 'e.g. chucknorris-a8f3',
    defaultValue: current.ntfyTopic ?? '',
  });
  bail(ntfyTopic);

  const telegramBotToken = await p.text({
    message: 'Telegram bot token for pause/resume acks (empty = skip)',
    placeholder: '123456:ABC-DEF…',
    defaultValue: current.telegramBotToken ?? '',
  });
  bail(telegramBotToken);

  let telegramChatId = current.telegramChatId ?? '';
  if (String(telegramBotToken).trim()) {
    const chat = await p.text({
      message: 'Telegram chat id (the chat that receives + acks notifications)',
      placeholder: 'e.g. 987654321',
      defaultValue: telegramChatId,
    });
    bail(chat);
    telegramChatId = String(chat).trim();
  }

  // -- optional global model overrides ---------------------------------
  let modelMap = current.modelMap;
  const overrideModels = await p.confirm({
    message:
      `Override the default per-role models globally? Defaults — planning: ${DEFAULT_MODEL_MAP.planning}, ` +
      `grunt: ${DEFAULT_MODEL_MAP.grunt}, coding: ${DEFAULT_MODEL_MAP.coding}, review: ${DEFAULT_MODEL_MAP.review}.`,
    initialValue: false,
  });
  bail(overrideModels);
  if (overrideModels) {
    const partial: Partial<ModelMap> = {};
    for (const role of ['planning', 'grunt', 'coding', 'review'] as ModelRole[]) {
      const def = current.modelMap?.[role] ?? DEFAULT_MODEL_MAP[role];
      const v = await p.text({ message: `Model for ${role}`, defaultValue: def, placeholder: def });
      bail(v);
      partial[role] = String(v);
    }
    modelMap = partial;
  }

  const config: GlobalConfig = {
    ...current,
    caveman: caveman as CavemanLevel,
    ...(String(ntfyTopic).trim() ? { ntfyTopic: String(ntfyTopic).trim() } : { ntfyTopic: undefined }),
    ...(String(telegramBotToken).trim()
      ? { telegramBotToken: String(telegramBotToken).trim() }
      : { telegramBotToken: undefined }),
    ...(telegramChatId ? { telegramChatId } : { telegramChatId: undefined }),
    ...(modelMap ? { modelMap } : {}),
  };
  await saveGlobalConfig(config);
  p.log.success('Saved ~/.config/chucknorris/config.json');
  return config;
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
      message: 'BMAD not installed in target. Install it now (non-interactive: core + bmm, tool: Claude Code)?',
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

  // -- caveman style ----------------------------------------------------
  const caveman = await p.select({
    message: 'Caveman output style for this run',
    options: CAVEMAN_OPTIONS as unknown as { value: CavemanLevel; label: string; hint: string }[],
    initialValue: global.caveman ?? DEFAULT_CAVEMAN,
  });
  bail(caveman);

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
    caveman: caveman as CavemanLevel,
    enabledSteps,
    maxRetries: Number(retries || DEFAULT_MAX_RETRIES),
    maxBudgetUsd: budget === '' ? undefined : Number(budget),
    bmad,
  };
}
