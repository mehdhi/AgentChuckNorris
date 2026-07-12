import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from '../../src/util/retryFetch.js';

describe('fetchWithRetry', () => {
  it('returns immediately on first success, no retry', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }) as Response);
    const res = await fetchWithRetry(fetchFn, 'https://x', {});
    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries transient network throws and succeeds', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('UND_ERR_CONNECT_TIMEOUT');
      return { ok: true } as Response;
    });
    const res = await fetchWithRetry(fetchFn, 'https://x', {}, 3, 1);
    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting attempts', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('still down');
    });
    await expect(fetchWithRetry(fetchFn, 'https://x', {}, 2, 1)).rejects.toThrow('still down');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry an HTTP-level error response (only network throws)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const res = await fetchWithRetry(fetchFn, 'https://x', {});
    expect(res.ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
