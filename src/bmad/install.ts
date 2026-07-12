import { spawn } from 'node:child_process';
import { detectBmad, type BmadInfo } from './detect.js';

/**
 * Non-interactive install (core + bmm, Claude Code as tool) via the
 * installer's --yes/--modules/--tools flags — required for unattended runs.
 * stdio stays inherited so install progress is visible in the run log.
 */
export async function runBmadInstaller(targetRepo: string): Promise<BmadInfo> {
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'bmad-method@latest',
        'install',
        '--yes',
        '--directory',
        targetRepo,
        '--modules',
        'core,bmm',
        '--tools',
        'claude-code',
      ],
      {
        cwd: targetRepo,
        stdio: 'inherit',
        env: process.env,
      },
    );
    child.on('error', reject);
    child.on('close', (c) => resolve(c ?? 1));
  });
  if (code !== 0) {
    throw new Error(`bmad-method install exited with code ${code}`);
  }
  return detectBmad(targetRepo);
}
