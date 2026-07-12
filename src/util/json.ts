/**
 * Extract the last JSON object from free-form model output.
 * Handles fenced ```json blocks, trailing prose, and bare objects.
 * Returns null when nothing parseable is found (callers treat as fail-closed).
 */
export function extractLastJsonBlock(text: string): unknown | null {
  const candidates: string[] = [];

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  for (const m of text.matchAll(fenceRe)) {
    if (m[1]) candidates.push(m[1].trim());
  }

  // Scan for balanced top-level {...} spans outside fences too.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        depth = 0;
      }
    }
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]!);
      if (parsed !== null && typeof parsed === 'object') return parsed;
    } catch {
      // keep scanning backwards
    }
  }
  return null;
}
