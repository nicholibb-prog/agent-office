// "Major Files" is the owner's private store: nothing in the office may read from it or point into it.
import path from 'node:path';

const SEGMENT = /^major[ _.-]?files$/i;

/** True when any folder in `p` (Windows or POSIX separators) is a Major Files folder. */
export function isMajorFiles(p: string): boolean {
  return p.split(/[\\/]+/).some((part) => SEGMENT.test(part.trim()));
}

/** Both the path as given and where it really leads (pass realpath's result as `real`). */
export function underMajorFiles(given: string, real?: string): boolean {
  return isMajorFiles(path.normalize(given)) || (!!real && isMajorFiles(real));
}
