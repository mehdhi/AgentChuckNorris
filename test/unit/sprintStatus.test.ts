import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSprintStatus } from '../../src/orchestrator/sprintStatus.js';

let tmp: string;

async function writeYaml(content: string): Promise<string> {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-sprint-'));
  const file = path.join(tmp, 'sprint-status.yaml');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

afterEach(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

describe('parseSprintStatus', () => {
  it('parses development_status, skips epic headers', async () => {
    const file = await writeYaml(`development_status:
  epic-1: in-progress
  1-1-login: drafted
  1-2-logout: done
  2-1-search: backlog
`);
    const entries = await parseSprintStatus(file);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ key: '1-1-login', epic: 1, done: false });
    expect(entries[1]).toMatchObject({ key: '1-2-logout', epic: 1, done: true });
    expect(entries[2]).toMatchObject({ key: '2-1-search', epic: 2, done: false });
  });

  it('unknown statuses count as not-done (tolerant to BMAD drift)', async () => {
    const file = await writeYaml(`development_status:
  1-1-x: some-new-status
`);
    const entries = await parseSprintStatus(file);
    expect(entries[0]?.done).toBe(false);
  });

  it('falls back to a nested map with story-like keys', async () => {
    const file = await writeYaml(`stories:
  1-1-a: completed
  1-2-b: ready-for-dev
`);
    const entries = await parseSprintStatus(file);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.done).toBe(true);
  });

  it('empty/garbage yaml yields no entries', async () => {
    const file = await writeYaml('just a string');
    expect(await parseSprintStatus(file)).toEqual([]);
  });
});
