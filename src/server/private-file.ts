// A whole file, mode 0600, renamed into place. Readers never see a half-written body.
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';

export function writePrivate(file: string, text: string): void {
  const folder = path.dirname(file);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const tmp = path.join(folder, `.${path.basename(file)}.${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (err) {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to remove */
    }
    throw err;
  }
  closeSync(fd);
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}
