import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CavemanLevel } from './caveman.js';
import { GlobalConfig } from './schema.js';

export function globalConfigPath(): string {
  return path.join(os.homedir(), '.config', 'chucknorris', 'config.json');
}

/** True when a config file exists on disk — the "not first run" signal. */
export async function globalConfigExists(): Promise<boolean> {
  try {
    await fs.access(globalConfigPath());
    return true;
  } catch {
    return false;
  }
}

/** Persist the durable global config (created at first run, editable by hand after). */
export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  const file = globalConfigPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(GlobalConfig.parse(config), null, 2) + '\n', 'utf8');
}

/**
 * Load ~/.config/chucknorris/config.json then apply env overrides:
 * CHUCKNORRIS_NTFY_TOPIC, CHUCKNORRIS_TELEGRAM_BOT_TOKEN, CHUCKNORRIS_TELEGRAM_CHAT_ID,
 * CHUCKNORRIS_CAVEMAN (off|lite|full|ultra), CHUCKNORRIS_STACKED_PRS (true|false).
 */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
  let raw: GlobalConfig = {};
  try {
    const text = await fs.readFile(globalConfigPath(), 'utf8');
    raw = GlobalConfig.parse(JSON.parse(text));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Invalid global config at ${globalConfigPath()}: ${String(err)}`);
    }
  }
  return {
    ...raw,
    ...(process.env['CHUCKNORRIS_NTFY_TOPIC'] ? { ntfyTopic: process.env['CHUCKNORRIS_NTFY_TOPIC'] } : {}),
    ...(process.env['CHUCKNORRIS_TELEGRAM_BOT_TOKEN']
      ? { telegramBotToken: process.env['CHUCKNORRIS_TELEGRAM_BOT_TOKEN'] }
      : {}),
    ...(process.env['CHUCKNORRIS_TELEGRAM_CHAT_ID']
      ? { telegramChatId: process.env['CHUCKNORRIS_TELEGRAM_CHAT_ID'] }
      : {}),
    ...cavemanEnvOverride(),
    ...stackedPrsEnvOverride(),
  };
}

function stackedPrsEnvOverride(): { stackedPrs: boolean } | Record<string, never> {
  const raw = process.env['CHUCKNORRIS_STACKED_PRS'];
  if (raw === undefined || raw === '') return {};
  return { stackedPrs: !/^(0|false|no|off)$/i.test(raw) };
}

function cavemanEnvOverride(): { caveman: CavemanLevel } | Record<string, never> {
  const raw = process.env['CHUCKNORRIS_CAVEMAN'];
  if (!raw) return {};
  const parsed = CavemanLevel.safeParse(raw);
  if (!parsed.success) throw new Error(`CHUCKNORRIS_CAVEMAN must be off|lite|full|ultra, got "${raw}"`);
  return { caveman: parsed.data };
}
