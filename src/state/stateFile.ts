import { promises as fs } from 'node:fs';
import path from 'node:path';
import { STATE_DIR, STATE_FILE } from '../config/defaults.js';
import { atomicWriteFile } from '../util/atomicWrite.js';
import { RunState } from './types.js';

export function stateFilePath(targetRepo: string): string {
  return path.join(targetRepo, STATE_DIR, STATE_FILE);
}

export async function loadState(targetRepo: string): Promise<RunState | null> {
  try {
    const text = await fs.readFile(stateFilePath(targetRepo), 'utf8');
    return RunState.parse(JSON.parse(text));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Corrupt or invalid state file at ${stateFilePath(targetRepo)}: ${String(err)}`);
  }
}

export async function saveState(state: RunState): Promise<void> {
  await atomicWriteFile(stateFilePath(state.targetRepo), JSON.stringify(state, null, 2));
}
