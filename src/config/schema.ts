import { z } from 'zod';
import { CavemanLevel } from './caveman.js';

export const ModelRole = z.enum(['planning', 'grunt', 'coding', 'review']);
export type ModelRole = z.infer<typeof ModelRole>;

export const ModelMap = z.object({
  planning: z.string(),
  grunt: z.string(),
  coding: z.string(),
  review: z.string(),
});
export type ModelMap = z.infer<typeof ModelMap>;

export const NotifierConfig = z.object({
  ntfyTopic: z.string().optional(),
  desktop: z.boolean().default(true),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
});
export type NotifierConfig = z.infer<typeof NotifierConfig>;

/** Optional pipeline steps the wizard can toggle. Required steps always run. */
export const OptionalSteps = z.object({
  brainstorm: z.boolean().default(false),
  productBrief: z.boolean().default(false),
  ux: z.boolean().default(false),
});
export type OptionalSteps = z.infer<typeof OptionalSteps>;

export const RunConfig = z.object({
  targetRepo: z.string(),
  problemStatement: z.string().min(1),
  overallGoal: z.string().min(1),
  modelMap: ModelMap,
  optionalSteps: OptionalSteps,
  maxRetries: z.number().int().min(0).default(2),
  maxBudgetUsd: z.number().positive().optional(),
  notifiers: NotifierConfig,
});
export type RunConfig = z.infer<typeof RunConfig>;

/** Secrets + defaults stored in ~/.config/chucknorris/config.json, never in the target repo. */
export const GlobalConfig = z.object({
  ntfyTopic: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  modelMap: ModelMap.partial().optional(),
  /** Output style for orchestrated sessions. Set once at first run; omitted = 'off'. */
  caveman: CavemanLevel.optional(),
  /** Open a numbered stacked PR per story during the dev loop. Omitted = on. */
  stackedPrs: z.boolean().optional(),
});
export type GlobalConfig = z.infer<typeof GlobalConfig>;
