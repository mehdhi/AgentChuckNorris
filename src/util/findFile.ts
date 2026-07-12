import { promises as fs } from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '_bmad', 'dist', 'build', '.chucknorris']);

/**
 * Bounded recursive search for the first file whose name matches `pattern`.
 * Breadth-first so shallow matches (docs/prd.md) win over deep ones.
 */
export async function findFile(
  root: string,
  pattern: RegExp,
  maxDepth = 4,
): Promise<string | null> {
  let level: string[] = [root];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) next.push(full);
        } else if (pattern.test(e.name)) {
          return full;
        }
      }
    }
    level = next;
  }
  return null;
}

/** All matches, same bounds. */
export async function findFiles(root: string, pattern: RegExp, maxDepth = 4): Promise<string[]> {
  const out: string[] = [];
  let level: string[] = [root];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) next.push(full);
        } else if (pattern.test(e.name)) {
          out.push(full);
        }
      }
    }
    level = next;
  }
  return out;
}
