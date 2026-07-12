import { fetchWithRetry } from '../util/retryFetch.js';
import type { Notification, Notifier } from './types.js';

export function ntfyNotifier(topic: string, fetchFn: typeof fetch = fetch): Notifier {
  return {
    name: 'ntfy',
    async send(n: Notification): Promise<void> {
      const res = await fetchWithRetry(fetchFn, `https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: {
          Title: n.title,
          Priority: n.priority === 'action' ? 'high' : 'default',
          ...(n.priority === 'action' ? { Tags: 'warning' } : {}),
        },
        body: n.body,
      });
      if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
    },
  };
}
