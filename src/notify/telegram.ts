import { fetchWithRetry } from '../util/retryFetch.js';
import type { Notification, Notifier } from './types.js';

export function telegramNotifier(
  botToken: string,
  chatId: string,
  fetchFn: typeof fetch = fetch,
): Notifier {
  return {
    name: 'telegram',
    async send(n: Notification): Promise<void> {
      const prefix = n.priority === 'action' ? '🚨 ' : '';
      const res = await fetchWithRetry(fetchFn, `https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `${prefix}${n.title}\n\n${n.body}` }),
      });
      if (!res.ok) throw new Error(`telegram HTTP ${res.status}`);
    },
  };
}
