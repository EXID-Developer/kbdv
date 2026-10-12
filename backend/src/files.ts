import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

const chains = new Map<string, Promise<unknown>>();

/** Serializes work per file so that concurrent writes land in call order. */
function queue<T>(path: string, task: () => Promise<T>): Promise<T> {
  const next = (chains.get(path) ?? Promise.resolve()).then(task, task);
  const settled = next.catch(() => undefined);
  chains.set(path, settled);
  void settled.then(() => chains.get(path) === settled && chains.delete(path));
  return next;
}

/** Writes JSON through a temporary file and a rename, so a crash never leaves a half-written file. */
export function writeJson(path: string, value: unknown): Promise<void> {
  return queue(path, async () => {
    const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(value));
      await rename(tmp, path);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  });
}

export function removeFile(path: string): Promise<void> {
  return queue(path, () => rm(path, { force: true }));
}
