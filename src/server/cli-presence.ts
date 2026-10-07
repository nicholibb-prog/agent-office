// Which seat CLIs exist on PATH. Looked up once per office process, with the executable bit, never `which`.
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { CliPresence } from '../shared/seat-provider.js';

export function scanCliBins(pathEnv: string, accessImpl: (file: string, mode: number) => void = accessSync): CliPresence {
  const has = (bin: string) => {
    for (const dir of pathEnv.split(path.delimiter)) {
      if (!dir) continue;
      try {
        accessImpl(path.join(dir, bin), constants.X_OK);
        return true;
      } catch {
        /* try the next directory */
      }
    }
    return false;
  };
  return { claude: has('claude'), grok: has('grok'), 'cursor-agent': has('cursor-agent') };
}

let officeBins: CliPresence | undefined;
let scans = 0;

export function officeCliScanCount(): number {
  return scans;
}

/** First floor to ask pays for the scan. Later floors reuse it. */
export function officeCliBins(): CliPresence {
  if (!officeBins) {
    scans += 1;
    officeBins = scanCliBins(process.env.PATH ?? '');
  }
  return officeBins;
}
