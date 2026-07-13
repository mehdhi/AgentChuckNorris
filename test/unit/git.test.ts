import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitsAhead,
  gitCommitAll,
  gitCreateBranch,
  gitCurrentBranch,
  gitDefaultBranch,
  gitHead,
  hasGitHubRemote,
  hasUncommittedChanges,
} from '../../src/util/git.js';

const execFileP = promisify(execFile);
let repo: string;

async function g(args: string[]): Promise<void> {
  await execFileP('git', args, { cwd: repo });
}

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-git-'));
  await g(['init', '-q', '-b', 'main']);
  await g(['config', 'user.email', 'test@example.com']);
  await g(['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
  await g(['add', '-A']);
  await g(['commit', '-q', '-m', 'init']);
});

afterEach(async () => fs.rm(repo, { recursive: true, force: true }));

describe('git helpers', () => {
  it('reports head, branch, and default branch', async () => {
    expect(await gitHead(repo)).toMatch(/^[0-9a-f]{40}$/);
    expect(await gitCurrentBranch(repo)).toBe('main');
    expect(await gitDefaultBranch(repo)).toBe('main'); // no origin/HEAD -> falls back to current
  });

  it('detects no GitHub remote', async () => {
    expect(await hasGitHubRemote(repo)).toBe(false);
    await g(['remote', 'add', 'origin', 'https://github.com/x/y.git']);
    expect(await hasGitHubRemote(repo)).toBe(true);
  });

  it('tracks uncommitted changes and commits them', async () => {
    expect(await hasUncommittedChanges(repo)).toBe(false);
    await fs.writeFile(path.join(repo, 'b.txt'), 'two\n');
    expect(await hasUncommittedChanges(repo)).toBe(true);

    expect(await gitCommitAll(repo, 'add b')).toBe(true);
    expect(await hasUncommittedChanges(repo)).toBe(false);
    expect(await gitCommitAll(repo, 'noop')).toBe(false); // nothing to commit
  });

  it('creates a branch and counts commits ahead of its base', async () => {
    await gitCreateBranch(repo, 'feat/01-thing', 'main');
    expect(await gitCurrentBranch(repo)).toBe('feat/01-thing');
    expect(await commitsAhead(repo, 'main')).toBe(0);

    await fs.writeFile(path.join(repo, 'c.txt'), 'three\n');
    await gitCommitAll(repo, 'work on branch');
    expect(await commitsAhead(repo, 'main')).toBe(1);
  });

  it('gitHead returns null outside a repo', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-plain-'));
    expect(await gitHead(plain)).toBeNull();
    await fs.rm(plain, { recursive: true, force: true });
  });
});
