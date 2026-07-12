import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { controlFileSource } from '../../src/ack/controlFile.js';
import { detectBmad } from '../../src/bmad/detect.js';
import { DEFAULT_MODEL_MAP } from '../../src/config/defaults.js';
import { consoleNotifier } from '../../src/notify/console.js';
import { runEngine } from '../../src/orchestrator/engine.js';
import type { OrchestratorDeps } from '../../src/orchestrator/sessionHelpers.js';
import { initMsg, resultMsg, scriptedQueryFn, type ScriptEntry } from '../../src/sdk/scripted.js';
import { loadState } from '../../src/state/stateFile.js';
import { newRunState, type RunState } from '../../src/state/types.js';
import { consoleLogger } from '../../src/util/logger.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-target', import.meta.url));

let tmp: string;
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

async function setupTarget(): Promise<string> {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-e2e-'));
  await fs.cp(FIXTURE, tmp, { recursive: true });
  return tmp;
}

async function buildDeps(target: string, script: ScriptEntry[]): Promise<{ deps: OrchestratorDeps; persisted: RunState[] }> {
  const logger = consoleLogger();
  const persisted: RunState[] = [];
  const bmad = await detectBmad(target);
  const deps: OrchestratorDeps = {
    queryFn: scriptedQueryFn(script),
    logger,
    notifier: consoleNotifier(logger),
    ackSources: [controlFileSource(target, 20)],
    persist: async (s) => {
      persisted.push(s);
      const { saveState } = await import('../../src/state/stateFile.js');
      await saveState(s);
    },
    abort: new AbortController(),
    bmadOutputFolder: bmad.outputFolder,
  };
  return { deps, persisted };
}

function baseState(target: string, maxRetries: number): RunState {
  return newRunState({
    runId: 'e2e',
    targetRepo: target,
    problemStatement: 'sample CLI needs a --version flag',
    overallGoal: 'users can check the installed version',
    modelMap: DEFAULT_MODEL_MAP,
    maxRetries,
    enabledSteps: ['prd', 'architecture', 'epics-stories', 'sprint-planning', 'dev-loop'],
  });
}

const bmadInit = () => initMsg(['/bmad-prd', '/bmad-dev-story', '/bmad-code-review']);

const FAIL_VERDICT = 'checked.\n{"verdict":"fail","failedCriteria":["Exit code is 0"],"summary":"exits 1"}';
const PASS_VERDICT = 'checked.\n{"verdict":"pass","failedCriteria":[],"summary":"all good"}';

describe('e2e dry-run (scripted SDK, no network)', () => {
  it('runs the full pipeline with one goal-check failure and retry', async () => {
    const target = await setupTarget();
    const script: ScriptEntry[] = [
      { match: /\/bmad-prd/, messages: [bmadInit(), resultMsg({ cost: 1.0 })] },
      { match: /\/bmad-create-architecture/, messages: [bmadInit(), resultMsg({ cost: 0.8 })] },
      { match: /\/bmad-create-epics-and-stories/, messages: [bmadInit(), resultMsg({ cost: 0.5 })] },
      { match: /\/bmad-sprint-planning/, messages: [bmadInit(), resultMsg({ cost: 0.1 })] },
      // story attempt 1
      { match: /\/bmad-dev-story/, messages: [bmadInit(), resultMsg({ cost: 0.4 })] },
      { match: /\/bmad-code-review/, messages: [bmadInit(), resultMsg({ text: 'finding: wrong exit code', cost: 0.2 })] },
      { match: /"verdict"/, messages: [bmadInit(), resultMsg({ text: FAIL_VERDICT, cost: 0.1 })] },
      // story attempt 2 — retry prompt must carry the tracking-block instruction
      { match: /RETRY CONTEXT[\s\S]*\/bmad-dev-story/, messages: [bmadInit(), resultMsg({ cost: 0.4 })] },
      { match: /\/bmad-code-review/, messages: [bmadInit(), resultMsg({ text: 'clean', cost: 0.2 })] },
      { match: /"verdict"/, messages: [bmadInit(), resultMsg({ text: PASS_VERDICT, cost: 0.1 })] },
      // epic done → retrospective, then final overall goal check
      { match: /\/bmad-retrospective/, messages: [bmadInit(), resultMsg({ cost: 0.05 })] },
      { match: /ONE sentence/, messages: [bmadInit(), resultMsg({ text: 'Goal achieved: version flag works.', cost: 0.02 })] },
    ];

    const { deps } = await buildDeps(target, script);
    const final = await runEngine(baseState(target, 2), deps);

    expect(final.steps.every((s) => s.status === 'completed' || s.status === 'skipped')).toBe(true);
    const story = final.devLoop.stories['1-1-add-version'];
    expect(story).toMatchObject({ status: 'done', attempts: 2 });
    expect(final.devLoop.retrospectedEpics).toEqual([1]);
    expect(final.totals.sessions).toBe(12);
    expect(final.totals.costUsd).toBeCloseTo(3.87, 2);
    expect(final.slashCommandsAvailable).toBe(true);

    // tracking block mirrored into the story doc
    const storyMd = await fs.readFile(path.join(target, 'docs/stories/1-1-add-version.md'), 'utf8');
    expect(storyMd).toContain('chucknorris:begin');
    expect(storyMd).toContain('Status: done');
    expect(storyMd).toContain('Last goal-check: PASS');

    // state round-trips from disk
    const reloaded = await loadState(target);
    expect(reloaded?.devLoop.stories['1-1-add-version']?.status).toBe('done');
  });

  it('pauses after retries exhausted and honors a /skip ack from the control file', async () => {
    const target = await setupTarget();
    // operator's answer sits in the control file before the pause begins
    await fs.mkdir(path.join(target, '.chucknorris'), { recursive: true });
    await fs.writeFile(path.join(target, '.chucknorris', 'control'), 'skip', 'utf8');

    const script: ScriptEntry[] = [
      { match: /\/bmad-prd/, messages: [bmadInit(), resultMsg({ cost: 0.1 })] },
      { match: /\/bmad-create-architecture/, messages: [bmadInit(), resultMsg({ cost: 0.1 })] },
      { match: /\/bmad-create-epics-and-stories/, messages: [bmadInit(), resultMsg({ cost: 0.1 })] },
      { match: /\/bmad-sprint-planning/, messages: [bmadInit(), resultMsg({ cost: 0.1 })] },
      { match: /\/bmad-dev-story/, messages: [bmadInit(), resultMsg({ cost: 0.1 })] },
      { match: /\/bmad-code-review/, messages: [bmadInit(), resultMsg({ cost: 0.1 })] },
      { match: /"verdict"/, messages: [bmadInit(), resultMsg({ text: FAIL_VERDICT, cost: 0.1 })] },
      // maxRetries=0 → pause → skip → epic has no non-skipped stories left → retrospective + summary
      { match: /\/bmad-retrospective/, messages: [bmadInit(), resultMsg({ cost: 0.05 })] },
      { match: /ONE sentence/, messages: [bmadInit(), resultMsg({ text: 'Story skipped; goal not verified.', cost: 0.02 })] },
    ];

    const { deps } = await buildDeps(target, script);
    const final = await runEngine(baseState(target, 0), deps);

    const story = final.devLoop.stories['1-1-add-version'];
    expect(story?.status).toBe('skipped');
    expect(final.waiting).toBeNull();

    const storyMd = await fs.readFile(path.join(target, 'docs/stories/1-1-add-version.md'), 'utf8');
    expect(storyMd).toContain('Status: skipped');
    expect(storyMd).toContain('FAIL — Exit code is 0');
  });
});
