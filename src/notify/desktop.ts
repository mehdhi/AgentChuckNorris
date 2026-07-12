import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Notification, Notifier } from './types.js';

const execFileP = promisify(execFile);

/** macOS banner via osascript. No-op failure on other platforms is fine (multi swallows). */
export function desktopNotifier(): Notifier {
  return {
    name: 'desktop',
    async send(n: Notification): Promise<void> {
      const script = `display notification ${JSON.stringify(n.body)} with title ${JSON.stringify(
        `ChuckNorris: ${n.title}`,
      )}${n.priority === 'action' ? ' sound name "Glass"' : ''}`;
      await execFileP('osascript', ['-e', script]);
    },
  };
}
