import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GlobalConfig } from './schema.js';

export function globalConfigPath(): string {
  return path.join(os.homedir(), '.config', 'chucknorris', 'config.json');
}

/**
 * Load ~/.config/chucknorris/config.json then apply env overrides:
 * CHUCKNORRIS_NTFY_TOPIC, CHUCKNORRIS_TELEGRAM_BOT_TOKEN, CHUCKNORRIS_TELEGRAM_CHAT_ID.
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
  };
}
