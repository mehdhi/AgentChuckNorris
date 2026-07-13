import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** True when the `gh` CLI is installed and authenticated for the current host. */
export async function ghAvailable(cwd: string): Promise<boolean> {
  try {
    await execFileP('gh', ['auth', 'status'], { cwd });
    return true;
  } catch {
    return false;
  }
}

export interface PrRef {
  number: number;
  url: string;
}

/**
 * Open a PR with `gh pr create`. Returns the new PR's number and URL, or null
 * on failure (the caller logs/notifies but does not fail the story — the work
 * is already committed locally).
 */
export async function ghCreatePr(
  cwd: string,
  opts: { base: string; head: string; title: string; body: string },
): Promise<PrRef | null> {
  try {
    const { stdout } = await execFileP(
      'gh',
      ['pr', 'create', '--base', opts.base, '--head', opts.head, '--title', opts.title, '--body', opts.body],
      { cwd },
    );
    const url = stdout.trim().split('\n').find((l) => l.includes('/pull/')) ?? stdout.trim();
    const number = Number(url.match(/\/pull\/(\d+)/)?.[1] ?? 0);
    return { number, url };
  } catch {
    return null;
  }
}
