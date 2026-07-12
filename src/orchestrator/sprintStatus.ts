import { promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { findFile } from '../util/findFile.js';

export interface SprintStoryEntry {
  key: string;
  epic: number;
  rawStatus: string;
  done: boolean;
}

/** Statuses BMAD uses for finished stories; anything unrecognized = work remaining (tolerant to drift). */
const DONE_STATUSES = new Set(['done', 'completed', 'complete', 'released', 'accepted']);

export async function locateSprintStatus(
  targetRepo: string,
  outputFolder: string | null,
): Promise<string | null> {
  if (outputFolder) {
    const inOutput = await findFile(outputFolder, /^sprint-status\.ya?ml$/i, 3);
    if (inOutput) return inOutput;
  }
  return findFile(targetRepo, /^sprint-status\.ya?ml$/i, 5);
}

/**
 * Parse BMAD's sprint-status.yaml. Expected shape (v6):
 *   development_status:
 *     epic-1: <status>          ← epic headers, skipped
 *     1-1-user-login: drafted
 * Story keys start with the epic number. Unknown top-level shapes fall back to
 * scanning any map whose keys look like story keys.
 */
export async function parseSprintStatus(file: string): Promise<SprintStoryEntry[]> {
  const text = await fs.readFile(file, 'utf8');
  const doc: unknown = parseYamlTolerant(text);
  if (doc === null || typeof doc !== 'object') return [];

  const record = doc as Record<string, unknown>;
  const statusMap = pickStatusMap(record);
  const entries: SprintStoryEntry[] = [];

  for (const [key, value] of Object.entries(statusMap)) {
    const m = key.match(/^(\d+)[-.]/);
    if (!m) continue; // epic headers ('epic-1') and metadata keys
    const rawStatus = String(value ?? '').toLowerCase().trim();
    entries.push({
      key,
      epic: Number(m[1]),
      rawStatus,
      done: DONE_STATUSES.has(rawStatus),
    });
  }
  return entries;
}

/**
 * BMAD emits template placeholders like `story_location: {project-root}/...`
 * unquoted — invalid YAML (`{` opens a flow mapping). Observed in a real
 * greenfield run, where it crashed the whole run. Recovery ladder:
 * 1. parse as-is; 2. quote `{...` scalars and re-parse; 3. line-level
 * extraction of just the development_status block (the only part we need).
 */
function parseYamlTolerant(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    const sanitized = text
      .split('\n')
      .map((line) => {
        const m = line.match(/^(\s*[\w][\w-]*:\s+)(\{.*)$/);
        return m ? `${m[1]}${JSON.stringify(m[2])}` : line;
      })
      .join('\n');
    try {
      return parseYaml(sanitized);
    } catch {
      return extractDevStatusByLines(text);
    }
  }
}

function extractDevStatusByLines(text: string): unknown {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^development_status\s*:/.test(l));
  if (start < 0) return null;
  const map: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s+\S/.test(line)) break; // dedent = end of block
    const m = line.match(/^\s+([^:#]+):\s*([^\s#]+)/);
    if (m) map[m[1]!.trim()] = m[2]!;
  }
  return { development_status: map };
}

function pickStatusMap(record: Record<string, unknown>): Record<string, unknown> {
  const dev = record['development_status'];
  if (dev !== null && typeof dev === 'object' && !Array.isArray(dev)) {
    return dev as Record<string, unknown>;
  }
  // Fallback: first nested map containing story-like keys, else the root itself.
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value as object);
      if (keys.some((k) => /^\d+[-.]/.test(k))) return value as Record<string, unknown>;
    }
  }
  return record;
}
