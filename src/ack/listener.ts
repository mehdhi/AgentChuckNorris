import type { Logger } from '../util/logger.js';
import type { AckCommand, AckSource } from './types.js';

/**
 * Race all enabled sources; first valid command wins, losers are aborted.
 * The outer signal (SIGINT) cancels everything.
 */
export async function waitForAck(
  sources: AckSource[],
  logger: Logger,
  outerSignal?: AbortSignal,
): Promise<AckCommand> {
  if (sources.length === 0) {
    throw new Error('no ack sources configured — cannot pause for operator input');
  }
  const race = new AbortController();
  const onOuterAbort = () => race.abort();
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

  logger.info(`waiting for operator ack via: ${sources.map((s) => s.name).join(', ')}`);
  try {
    const winner = await Promise.any(
      sources.map((s) =>
        s.wait(race.signal).then((cmd) => {
          race.abort(); // stop the other sources
          return cmd;
        }),
      ),
    );
    logger.info(`ack received from ${winner.source}: ${winner.kind}${winner.guidance ? ' (+guidance)' : ''}`);
    return winner;
  } catch (err) {
    if (outerSignal?.aborted) return { kind: 'abort', guidance: null, source: 'signal' };
    throw new Error(`all ack sources failed: ${String(err)}`);
  } finally {
    outerSignal?.removeEventListener('abort', onOuterAbort);
    race.abort();
  }
}
