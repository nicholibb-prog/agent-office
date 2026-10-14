// Router test fixtures. Every secret-looking value is built at runtime from fragments, so nothing
// here is a literal key, name or ID; the deny hashes are of fake strings only.
import { readFileSync } from 'node:fs';
import { emptyDeny, hashLiteral, parseAllowList, sha256, type ScanContext } from '../../src/server/router/presend-scan.js';
import type { RouterFlags } from '../../src/server/router/flags.js';

export const j = (...parts: string[]) => parts.join('');
/** Fake owner name / home user / student / Drive ID: invented strings, hashed at runtime. */
export const FAKE_OWNER = j('Zed', 'ora') + ' ' + j('Quill', 'mont');
export const FAKE_HOME_USER = j('zq', 'user', '77');
export const FAKE_STUDENT = j('Ilsa', ' ', 'Varnek');
export const FAKE_DRIVE_ID = j('1FAKEdr', 'iveID_', 'testOnly', '-0000abc', 'XYZ');

export function scanCtx(over: Partial<ScanContext> = {}): ScanContext {
  const deny = emptyDeny();
  for (const w of FAKE_OWNER.split(' ')) deny.owner_name.add(hashLiteral(w));
  deny.owner_name.add(hashLiteral(FAKE_OWNER));
  deny.home_user.add(hashLiteral(FAKE_HOME_USER));
  deny.student.add(hashLiteral(FAKE_STUDENT));
  deny.drive_id.add(sha256(FAKE_DRIVE_ID));
  const allow = parseAllowList(readFileSync('config/presend-allow.json', 'utf8'));
  return { deny, allow, ...over };
}

export const flagsOff: RouterFlags = { openrouter: false, openrouterKeyEnv: 'OPENROUTER_API_KEY', c1SecretToGrokCrew: false, c6StudentDrive: false, kill: false };
