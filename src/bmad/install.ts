import { spawn } from 'node:child_process';
import { detectBmad, type BmadInfo } from './detect.js';

/**
 * Run the interactive BMAD installer in the operator's terminal (stdio inherit).
 * Happens once per target repo at wizard time; the operator picks modules
 * (core + bmm minimum) and Claude Code as the tool.
 */
export async function runBmadInstaller(targetRepo: string): Promise<BmadInfo> {
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn('npx', ['bmad-method@latest', 'install'], {
      cwd: targetRepo,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (c) => resolve(c ?? 1));
  });
  if (code !== 0) {
    throw new Error(`bmad-method install exited with code ${code}`);
  }
  return detectBmad(targetRepo);
}
