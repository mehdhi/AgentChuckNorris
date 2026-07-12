import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface BmadInfo {
  installed: boolean;
  /** Module dirs found under _bmad/ (core, bmm, ...). */
  modules: string[];
  /** BMAD's configured output folder (docs location), absolute; null when unknown. */
  outputFolder: string | null;
}

/**
 * BMAD v6 installs into <repo>/_bmad with per-module config files. The config
 * is simple key=value TOML/YAML — a regex reader avoids a parser dependency
 * and tolerates format drift between BMAD point releases.
 */
export async function detectBmad(targetRepo: string): Promise<BmadInfo> {
  const bmadDir = path.join(targetRepo, '_bmad');
  let entries: string[];
  try {
    entries = await fs.readdir(bmadDir);
  } catch {
    return { installed: false, modules: [], outputFolder: null };
  }

  const modules: string[] = [];
  for (const e of entries) {
    try {
      if ((await fs.stat(path.join(bmadDir, e))).isDirectory() && !e.startsWith('.')) modules.push(e);
    } catch {
      // ignore unreadable entries
    }
  }

  const outputFolder = await findOutputFolder(bmadDir, targetRepo);
  return { installed: true, modules, outputFolder };
}

async function findOutputFolder(bmadDir: string, targetRepo: string): Promise<string | null> {
  const candidates = [
    path.join(bmadDir, 'bmm', 'config.yaml'),
    path.join(bmadDir, 'bmm', 'config.toml'),
    path.join(bmadDir, 'core', 'config.yaml'),
    path.join(bmadDir, 'core', 'config.toml'),
    path.join(bmadDir, 'config.toml'),
    path.join(bmadDir, 'config.yaml'),
  ];
  for (const file of candidates) {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    // matches: output_folder = "docs" | output_folder: docs | outputFolder: '{project-root}/docs'
    const m = text.match(/output[_-]?folder\s*[:=]\s*['"]?([^'"\n#]+)/i);
    if (m?.[1]) {
      const raw = m[1].trim().replace('{project-root}', targetRepo);
      return path.isAbsolute(raw) ? raw : path.join(targetRepo, raw);
    }
  }
  return null;
}

export function bmadReady(info: BmadInfo): { ok: boolean; warning: string | null } {
  if (!info.installed) return { ok: false, warning: 'BMAD not installed (_bmad/ missing)' };
  const missing = ['core', 'bmm'].filter((m) => !info.modules.includes(m));
  if (missing.length > 0) {
    return { ok: true, warning: `BMAD installed but expected modules missing: ${missing.join(', ')}` };
  }
  return { ok: true, warning: null };
}
