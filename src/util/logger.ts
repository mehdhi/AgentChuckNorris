import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  /** Raw SDK stream events — JSONL file only, not console. */
  event(kind: string, payload: unknown): void;
  close(): Promise<void>;
}

export function createLogger(logDir: string, runId: string): Logger {
  const file = path.join(logDir, `${runId}.jsonl`);
  let queue: Promise<void> = fs.mkdir(logDir, { recursive: true }).then(() => {});

  function append(line: Record<string, unknown>): void {
    queue = queue.then(() =>
      fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...line }) + '\n', 'utf8'),
    );
  }

  function emit(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) {
    const prefix = { info: '•', warn: '⚠', error: '✖' }[level];
    // eslint-disable-next-line no-console
    console[level === 'info' ? 'log' : level](`${prefix} ${msg}`);
    append({ level, msg, ...extra });
  }

  return {
    info: (msg, extra) => emit('info', msg, extra),
    warn: (msg, extra) => emit('warn', msg, extra),
    error: (msg, extra) => emit('error', msg, extra),
    event: (kind, payload) => append({ level: 'event', kind, payload }),
    close: () => queue,
  };
}

export function consoleLogger(): Logger {
  return {
    info: (msg) => console.log(`• ${msg}`),
    warn: (msg) => console.warn(`⚠ ${msg}`),
    error: (msg) => console.error(`✖ ${msg}`),
    event: () => {},
    close: async () => {},
  };
}
