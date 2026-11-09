// Test helper: an owner passphrase in a temp owner file (AGENT_OFFICE_OWNER_FILE), and a live owner
// cookie for it, so route tests can act as the owner the way 'Unlock owner' does.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OWNER_COOKIE, setOwnerPassphrase, startOwnerSession } from '../../src/server/hq/okkin-owner.js';

export const TEST_PASSPHRASE = 'correct horse battery staple';

export async function testOwner(): Promise<{ file: string; cookie: () => string }> {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'ao-owner-')), 'okkin-owner.json');
  process.env.AGENT_OFFICE_OWNER_FILE = file;
  await setOwnerPassphrase(file, TEST_PASSPHRASE);
  return { file, cookie: () => `${OWNER_COOKIE}=${startOwnerSession()}` };
}
