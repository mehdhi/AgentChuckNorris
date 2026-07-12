import type { Logger } from '../util/logger.js';
import type { Notification, Notifier } from './types.js';

/** Always-on channel; doubles as the mock in tests and dry-run. */
export function consoleNotifier(logger: Logger): Notifier {
  return {
    name: 'console',
    async send(n: Notification): Promise<void> {
      const fn = n.priority === 'action' ? logger.warn : logger.info;
      fn(`🔔 [${n.priority}] ${n.title} — ${n.body}`);
    },
  };
}
