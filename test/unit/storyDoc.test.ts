import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseAcceptanceCriteria,
  parseStoryGoal,
  renderTrackingBlock,
  writeTrackingBlock,
} from '../../src/orchestrator/storyDoc.js';
import type { StoryState } from '../../src/state/types.js';

const story: StoryState = {
  key: '1-1-x',
  epic: 1,
  status: 'in_progress',
  storyFile: null,
  goal: 'add version flag',
  acceptanceCriteria: ['prints version'],
  attempts: 2,
  baselineCommit: 'abc',
  lastFailure: { summary: 'exit code wrong', failedCriteria: ['AC2'] },
  reviewDigest: 'minor: naming',
  operatorGuidance: 'use process.exit(0)',
};

const STORY_MD = `# Story

## Story

As a user, I want a --version flag so that I can check the version.

## Acceptance Criteria

1. Running \`cli --version\` prints the version
2. [ ] Exit code is 0
- No other output

## Tasks
- [ ] do it
`;

let tmp: string;
afterEach(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

describe('story markdown parsing', () => {
  it('extracts acceptance criteria items (numbered, checkbox, bullet)', () => {
    expect(parseAcceptanceCriteria(STORY_MD)).toEqual([
      'Running `cli --version` prints the version',
      'Exit code is 0',
      'No other output',
    ]);
  });

  it('extracts the story goal paragraph', () => {
    expect(parseStoryGoal(STORY_MD)).toContain('--version flag');
  });

  it('returns empty/null on unrelated markdown', () => {
    expect(parseAcceptanceCriteria('# nope')).toEqual([]);
    expect(parseStoryGoal('# nope')).toBeNull();
  });
});

describe('tracking block', () => {
  it('renders failure context and guidance', () => {
    const block = renderTrackingBlock(story, 2);
    expect(block).toContain('Attempts: 2/3');
    expect(block).toContain('FAIL — AC2');
    expect(block).toContain('use process.exit(0)');
  });

  it('write is idempotent — second write replaces, never duplicates', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-story-'));
    const file = path.join(tmp, 's.md');
    await fs.writeFile(file, STORY_MD, 'utf8');

    await writeTrackingBlock(file, story, 2);
    await writeTrackingBlock(file, { ...story, status: 'done', lastFailure: null }, 2);

    const content = await fs.readFile(file, 'utf8');
    expect(content.match(/chucknorris:begin/g)).toHaveLength(1);
    expect(content).toContain('Status: done');
    expect(content).toContain('## Acceptance Criteria'); // original content intact
  });

  it('missing story file is a no-op', async () => {
    await expect(writeTrackingBlock('/nonexistent/x.md', story, 2)).resolves.toBeUndefined();
  });
});
