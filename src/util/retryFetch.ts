/**
 * Outbound notifier calls (ntfy, Telegram) see occasional transient connect
 * failures (observed: undici UND_ERR_CONNECT_TIMEOUT on a fresh process's
 * first request) that succeed on immediate retry. A silently dropped
 * notification defeats the point of the tool, so network-level throws get a
 * couple of quick retries; HTTP-level responses (4xx/5xx) are not retried —
 * those are real API errors, not connectivity blips.
 */
export async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  attempts = 3,
  baseDelayMs = 400,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchFn(url, init);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}
