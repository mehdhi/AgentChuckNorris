import type { RunState } from '../state/types.js';

const ICON: Record<string, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  done: '●',
  skipped: '⊘',
  failed: '✖',
  paused: '⏸',
};

export function renderStatus(state: RunState): string {
  const lines: string[] = [];
  lines.push(`ChuckNorris run ${state.runId} — ${state.targetRepo}`);
  lines.push(`Goal: ${state.overallGoal}`);
  lines.push('');
  lines.push('Pipeline:');
  for (const s of state.steps) {
    const extra = [
      s.artifact ? `→ ${s.artifact}` : null,
      s.costUsd !== undefined ? `$${s.costUsd.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`  ${ICON[s.status] ?? '?'} ${s.id.padEnd(16)} ${s.status}${extra ? `  ${extra}` : ''}`);
  }

  const stories = Object.values(state.devLoop.stories);
  if (stories.length > 0) {
    lines.push('');
    lines.push('Stories:');
    for (const st of stories) {
      const fail = st.lastFailure ? `  last-fail: ${st.lastFailure.failedCriteria.join(', ')}` : '';
      lines.push(`  ${ICON[st.status] ?? '?'} ${st.key.padEnd(28)} ${st.status} (attempts ${st.attempts})${fail}`);
    }
  }

  lines.push('');
  if (state.waiting) {
    lines.push(`⏸ WAITING for operator: ${state.waiting.reason} — ${state.waiting.message}`);
  }
  lines.push(
    `Totals: $${state.totals.costUsd.toFixed(2)} across ${state.totals.sessions} sessions` +
      (state.maxBudgetUsd !== null ? ` (budget $${state.maxBudgetUsd.toFixed(2)})` : ''),
  );
  return lines.join('\n');
}
