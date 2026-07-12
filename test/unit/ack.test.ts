import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { controlFileSource } from '../../src/ack/controlFile.js';
import { waitForAck } from '../../src/ack/listener.js';
import { telegramSource } from '../../src/ack/telegramPoll.js';
import { parseAckText } from '../../src/ack/types.js';
import { consoleLogger } from '../../src/util/logger.js';

describe('parseAckText', () => {
  it('maps commands with and without slash', () => {
    expect(parseAckText('/go', 't').kind).toBe('continue');
    expect(parseAckText('continue', 't').kind).toBe('continue');
    expect(parseAckText('/retry', 't').kind).toBe('retry');
    expect(parseAckText('SKIP', 't').kind).toBe('skip');
    expect(parseAckText('/abort', 't').kind).toBe('abort');
    expect(parseAckText('stop', 't').kind).toBe('abort');
  });

  it('freeform text becomes retry-with-guidance', () => {
    const cmd = parseAckText('use the config loader instead', 't');
    expect(cmd).toMatchObject({ kind: 'retry', guidance: 'use the config loader instead' });
  });
});

describe('controlFileSource', () => {
  let tmp: string;
  afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

  it('picks up a command and truncates the file', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-ack-'));
    const controlDir = path.join(tmp, '.chucknorris');
    await fs.mkdir(controlDir, { recursive: true });
    await fs.writeFile(path.join(controlDir, 'control'), 'skip\n', 'utf8');

    const src = controlFileSource(tmp, 20);
    const cmd = await waitForAck([src], consoleLogger());
    expect(cmd.kind).toBe('skip');
    expect(await fs.readFile(path.join(controlDir, 'control'), 'utf8')).toBe('');
  });
});

describe('telegramSource', () => {
  it('consumes updates, honors chat filter, persists offset', async () => {
    let savedOffset = 0;
    const responses = [
      {
        ok: true,
        result: [
          { update_id: 10, message: { chat: { id: 999 }, text: '/abort' } }, // wrong chat
          { update_id: 11, message: { chat: { id: 42 }, text: 'fix the tests first' } },
        ],
      },
    ];
    const fetchFn = (async () => ({
      ok: true,
      json: async () => responses.shift() ?? { ok: true, result: [] },
    })) as unknown as typeof fetch;

    const src = telegramSource('tok', '42', { get: () => savedOffset, set: async (o) => void (savedOffset = o) }, fetchFn);
    const cmd = await src.wait(new AbortController().signal);
    expect(cmd).toMatchObject({ kind: 'retry', guidance: 'fix the tests first', source: 'telegram' });
    expect(savedOffset).toBe(12); // both updates consumed
  });
});
