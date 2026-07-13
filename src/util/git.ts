import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd });
  return stdout.trim();
}

/** HEAD commit of the target repo, or null when not a git repo / no commits yet. */
export async function gitHead(cwd: string): Promise<string | null> {
  try {
    return await git(cwd, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

/** Current branch name, or null when detached / not a repo. */
export async function gitCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const b = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return b === 'HEAD' ? null : b;
  } catch {
    return null;
  }
}

/** The repo's default branch (origin/HEAD target), falling back to `main`. */
export async function gitDefaultBranch(cwd: string): Promise<string> {
  try {
    // e.g. "origin/main" -> "main"
    const ref = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    return ref.replace(/^origin\//, '') || 'main';
  } catch {
    return (await gitCurrentBranch(cwd)) ?? 'main';
  }
}

/** True when `origin` points at a GitHub remote (needed for `gh pr create`). */
export async function hasGitHubRemote(cwd: string): Promise<boolean> {
  try {
    const url = await git(cwd, ['remote', 'get-url', 'origin']);
    return /github\.com/i.test(url);
  } catch {
    return false;
  }
}

/** True when the working tree has staged or unstaged changes. */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  try {
    return (await git(cwd, ['status', '--porcelain'])) !== '';
  } catch {
    return false;
  }
}

/** Create and check out `branch` from `base`. Throws on failure. */
export async function gitCreateBranch(cwd: string, branch: string, base: string): Promise<void> {
  await git(cwd, ['switch', '-c', branch, base]);
}

/** Check out an existing branch. Throws on failure. */
export async function gitSwitch(cwd: string, branch: string): Promise<void> {
  await git(cwd, ['switch', branch]);
}

/** Stage everything and commit. Returns false when there was nothing to commit. */
export async function gitCommitAll(cwd: string, message: string): Promise<boolean> {
  await git(cwd, ['add', '-A']);
  if (!(await hasStagedChanges(cwd))) return false;
  await git(cwd, ['commit', '-m', message]);
  return true;
}

async function hasStagedChanges(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ['diff', '--cached', '--quiet']);
    return false; // exit 0 = no staged diff
  } catch {
    return true; // non-zero exit = staged changes present
  }
}

/** Count commits on `branch` (HEAD) not reachable from `base`. */
export async function commitsAhead(cwd: string, base: string, branch = 'HEAD'): Promise<number> {
  try {
    return Number(await git(cwd, ['rev-list', '--count', `${base}..${branch}`]));
  } catch {
    return 0;
  }
}

/** Push `branch` to origin, setting upstream. Throws on failure. */
export async function gitPush(cwd: string, branch: string): Promise<void> {
  await git(cwd, ['push', '-u', 'origin', branch]);
}
