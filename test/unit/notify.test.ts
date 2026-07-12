import { describe, expect, it } from 'vitest';
import { multiNotifier } from '../../src/notify/multi.js';
import { ntfyNotifier } from '../../src/notify/ntfy.js';
import { telegramNotifier } from '../../src/notify/telegram.js';
import type { Notifier } from '../../src/notify/types.js';
import { consoleLogger } from '../../src/util/logger.js';

const note = { title: 't', body: 'b', priority: 'action' as const };

describe('multiNotifier', () => {
  it('one failing channel never breaks the others', async () => {
    const calls: string[] = [];
    const good: Notifier = { name: 'good', send: async () => void calls.push('good') };
    const bad: Notifier = { name: 'bad', send: async () => Promise.reject(new Error('down')) };
    await expect(multiNotifier([bad, good], consoleLogger()).send(note)).resolves.toBeUndefined();
    expect(calls).toEqual(['good']);
  });
});

describe('ntfyNotifier', () => {
  it('POSTs with title/priority headers', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;

    await ntfyNotifier('my-topic', fetchFn).send(note);
    expect(captured!.url).toBe('https://ntfy.sh/my-topic');
    expect((captured!.init.headers as Record<string, string>)['Priority']).toBe('high');
    expect(captured!.init.body).toBe('b');
  });

  it('throws on HTTP error', async () => {
    const fetchFn = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(ntfyNotifier('x', fetchFn).send(note)).rejects.toThrow('ntfy HTTP 500');
  });
});

describe('telegramNotifier', () => {
  it('sends chat_id + prefixed text', async () => {
    let body: Record<string, unknown> | null = null;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return { ok: true };
    }) as unknown as typeof fetch;

    await telegramNotifier('tok', '42', fetchFn).send(note);
    expect(body).toMatchObject({ chat_id: '42' });
    expect(String(body!['text'])).toContain('🚨');
  });
});
