import { parseAckText, type AckCommand, type AckSource } from './types.js';

interface TelegramUpdate {
  update_id: number;
  message?: { chat?: { id?: number | string }; text?: string };
}

export interface TelegramOffsetStore {
  get(): number;
  /** Persisted so a reply is never double-consumed across crashes. */
  set(offset: number): Promise<void>;
}

/**
 * Primary ack channel: bidirectional from a phone with zero extra setup.
 * Long-polls getUpdates; only messages from the configured chat count.
 */
export function telegramSource(
  botToken: string,
  chatId: string,
  offsets: TelegramOffsetStore,
  fetchFn: typeof fetch = fetch,
): AckSource {
  return {
    name: 'telegram',
    async wait(signal: AbortSignal): Promise<AckCommand> {
      while (!signal.aborted) {
        let updates: TelegramUpdate[] = [];
        try {
          const res = await fetchFn(
            `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offsets.get()}&timeout=50`,
            { signal },
          );
          if (res.ok) {
            const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
            updates = body.result ?? [];
          }
        } catch (err) {
          if (signal.aborted) break;
          // transient network failure — back off briefly and re-poll
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        for (const u of updates) {
          await offsets.set(u.update_id + 1);
          const text = u.message?.text;
          if (text && String(u.message?.chat?.id) === String(chatId)) {
            return parseAckText(text, 'telegram');
          }
        }
      }
      throw new Error('aborted');
    },
  };
}
