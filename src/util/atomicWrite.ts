import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Write via tmp file + rename so readers never observe a torn file. */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}
