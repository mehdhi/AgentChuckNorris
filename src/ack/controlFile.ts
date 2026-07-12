import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CONTROL_FILE, CONTROL_FILE_POLL_MS, STATE_DIR } from '../config/defaults.js';
import { parseAckText, type AckCommand, type AckSource } from './types.js';

export function controlFilePath(targetRepo: string): string {
  return path.join(targetRepo, STATE_DIR, CONTROL_FILE);
}

/**
 * Always-available fallback: `echo retry > <target>/.chucknorris/control`.
 * File is truncated after reading so a stale command can't fire twice.
 */
export function controlFileSource(targetRepo: string, pollMs = CONTROL_FILE_POLL_MS): AckSource {
  const file = controlFilePath(targetRepo);
  return {
    name: 'control-file',
    async wait(signal: AbortSignal): Promise<AckCommand> {
      while (!signal.aborted) {
        let text = '';
        try {
          text = (await fs.readFile(file, 'utf8')).trim();
        } catch {
          // missing file = no command yet
        }
        if (text) {
          await fs.writeFile(file, '', 'utf8');
          return parseAckText(text, 'control-file');
        }
        await sleep(pollMs, signal);
      }
      throw new Error('aborted');
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
