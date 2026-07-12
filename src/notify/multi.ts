import type { Logger } from '../util/logger.js';
import type { Notification, Notifier } from './types.js';

/** Fan out to every channel; a channel failure is logged, never fatal. */
export function multiNotifier(notifiers: Notifier[], logger: Logger): Notifier {
  return {
    name: 'multi',
    async send(n: Notification): Promise<void> {
      const results = await Promise.allSettled(notifiers.map((x) => x.send(n)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          logger.warn(`notifier ${notifiers[i]?.name} failed: ${String(r.reason)}`);
        }
      });
    },
  };
}
