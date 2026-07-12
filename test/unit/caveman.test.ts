import { describe, expect, it } from 'vitest';
import { cavemanAppend } from '../../src/config/caveman.js';
import { runSession } from '../../src/sdk/runner.js';
import { initMsg, resultMsg } from '../../src/sdk/scripted.js';
import type { QueryFn, QueryOptions } from '../../src/sdk/types.js';
import { consoleLogger } from '../../src/util/logger.js';

describe('cavemanAppend', () => {
  it('returns undefined for off (preset prompt untouched)', () => {
    expect(cavemanAppend('off')).toBeUndefined();
  });

  it('produces an append for each active level and always keeps the correctness exemptions', () => {
    for (const level of ['lite', 'full', 'ultra'] as const) {
      const text = cavemanAppend(level);
      expect(text).toBeTypeOf('string');
      expect(text).toMatch(/commit messages/i);
      expect(text).toMatch(/JSON/);
      expect(text).toMatch(/security/i);
    }
    expect(cavemanAppend('full')).toMatch(/CAVEMAN/);
  });
});

describe('runSession systemPrompt append', () => {
  function spyQueryFn(): { fn: QueryFn; seen: QueryOptions[] } {
    const seen: QueryOptions[] = [];
    const fn: QueryFn = ({ options }) => {
      seen.push(options);
      return (async function* () {
        yield initMsg();
        yield resultMsg({ cost: 0 });
      })();
    };
    return { fn, seen };
  }

  const spec = { label: 't', model: 'm', prompt: 'p', cwd: '/tmp', maxTurns: 3 };

  it('forwards the append onto the preset system prompt when provided', async () => {
    const { fn, seen } = spyQueryFn();
    await runSession(spec, { queryFn: fn, logger: consoleLogger(), systemPromptAppend: 'CAVE' });
    expect(seen[0]?.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'CAVE' });
  });

  it('omits append entirely when not provided', async () => {
    const { fn, seen } = spyQueryFn();
    await runSession(spec, { queryFn: fn, logger: consoleLogger() });
    expect(seen[0]?.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
    expect('append' in (seen[0]!.systemPrompt as object)).toBe(false);
  });
});
