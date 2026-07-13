import type { CavemanLevel } from './caveman.js';
import type { ModelMap, ModelRole } from './schema.js';

export const DEFAULT_CAVEMAN: CavemanLevel = 'off';

/** Numbered stacked-PR-per-story dev-loop workflow is on unless opted out. */
export const DEFAULT_STACKED_PRS = true;

export const DEFAULT_MODEL_MAP: ModelMap = {
  planning: 'claude-opus-4-8',
  grunt: 'claude-haiku-4-5-20251001',
  coding: 'claude-sonnet-5',
  review: 'claude-opus-4-8',
};

export const ALL_HAIKU_MODEL_MAP: ModelMap = {
  planning: 'claude-haiku-4-5-20251001',
  grunt: 'claude-haiku-4-5-20251001',
  coding: 'claude-haiku-4-5-20251001',
  review: 'claude-haiku-4-5-20251001',
};

export const DEFAULT_MAX_RETRIES = 2;

/** Turn ceilings per role — the backstop against BMAD elicitation hangs. */
export const MAX_TURNS: Record<ModelRole, number> = {
  planning: 60,
  grunt: 20,
  coding: 250,
  review: 80,
};

export const GOAL_CHECK_MAX_TURNS = 30;

/** How long the control file poller sleeps between reads. */
export const CONTROL_FILE_POLL_MS = 5000;

/** Truncation limit for review findings injected into retry context. */
export const REVIEW_DIGEST_MAX_CHARS = 2000;

export const STATE_DIR = '.chucknorris';
export const STATE_FILE = 'state.json';
export const CONTROL_FILE = 'control';
