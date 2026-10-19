/**
 * What a browser folder picker gives (`<input type="file" webkitdirectory>`), built from a
 * folder on disk: one FileLike per file under it, its path in `webkitRelativePath`
 * starting with the folder's name. Synthetic folders only (the tests' scenarios).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type FileLike } from '#src/telegram/export/browser-files.ts';

/** A file as a picker gives it, with these bytes. */
export function fileLike(relativePath: string, bytes: Uint8Array | string): FileLike {
  // A copy: a Node Buffer may be a view of a larger shared pool.
  const data = new Uint8Array(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
  return {
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    webkitRelativePath: relativePath,
    arrayBuffer: () => Promise.resolve(data.slice().buffer),
  };
}

/**
 * The files of a pick of `dir` (files only, as browsers list them), in reverse name
 * order: a picker gives no particular order, so the adapter must not depend on it.
 */
export function pickFolder(dir: string): FileLike[] {
  const top = path.basename(dir);
  const out: FileLike[] = [];
  const walk = (d: string, rel: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, `${rel}/${e.name}`);
      else if (e.isFile()) out.push(fileLike(`${rel}/${e.name}`, fs.readFileSync(p)));
    }
  };
  walk(dir, top);
  return out.sort((a, b) => (a.webkitRelativePath < b.webkitRelativePath ? 1 : -1));
}
