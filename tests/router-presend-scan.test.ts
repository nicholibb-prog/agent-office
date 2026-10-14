// Dan's pre-send scan spec §5 cases 1-13, 16, 18 (14/15/17/19 are in router-cloud-send and
// router-provider-imports). Fixtures are built at runtime; no literal secret is committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { presendScan, scanPayload, MAX_SCAN_BYTES } from '../src/server/router/presend-scan.js';
import { FAKE_DRIVE_ID, FAKE_HOME_USER, FAKE_OWNER, FAKE_STUDENT, j, scanCtx } from './support/router-fixtures.js';

const types = (text: string, ctx = scanCtx()) => presendScan(text, ctx).hits.map((h) => h.type);
const blocks = (text: string, type: string, ctx = scanCtx()) => {
  const r = presendScan(text, ctx);
  assert.equal(r.ok, false, `expected ${type} block`);
  assert.ok(r.hits.some((h) => h.type === type), `expected ${type}, got ${r.hits.map((h) => h.type)}`);
  // Hash-only: no raw value in the result.
  const out = JSON.stringify(r.hits.map(({ sha8, offset_bucket }) => ({ sha8, offset_bucket })));
  for (const word of text.split(/\s+/).filter((w) => w.length >= 6)) assert.ok(!out.includes(word), 'raw value in scan result');
  for (const h of r.hits) assert.deepEqual(Object.keys(h).sort(), ['offset_bucket', 'sha8', 'type']);
};
const passes = (text: string, ctx = scanCtx()) => assert.deepEqual(types(text, ctx), [], text);
const body = (n: number) => 'A1b2C3d4E5f6G7h8J9k0'.repeat(3).slice(0, n);

test('1. every KEY_PATTERN prefix with a fake body blocks', () => {
  const fake = body(24);
  for (const k of [j('sk', '-', fake), j('sk-', 'ant-', fake), j('sk-', 'or-', fake), j('gs', 'k_', fake), j('nva', 'pi-', fake), j('xa', 'i-', fake),
    j('gh', 'p_', fake), j('gh', 'o_', fake), j('gh', 'u_', fake), j('gh', 's_', fake), j('gh', 'r_', fake), j('github', '_pat_', fake),
    j('AK', 'IA', 'QWERTYUIOPASDFGH'), j('AS', 'IA', 'QWERTYUIOPASDFGH'), j('AI', 'za', body(35)), j('ya', '29.', fake), j('xo', 'xb-', fake),
    j('h', 'f_', fake), j('gl', 'pat-', fake), j('sk', '_live_', fake), j('rk', '_live_', fake),
    j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiIxIn0', '.', 'abcdefgh'), j('Bea', 'rer ', fake), j('Authori', 'zation: x'),
    j('https://', 'bob', ':', 'pw123', '@host.test/x'), j('https://host.test/x?', 'token=', 'abc')]) {
    blocks(`please use ${k} now`, 'KEY_PATTERN');
  }
});

test('2. HIGH_ENTROPY: random base64 blocks; a real repo commit passes; a missing one blocks', () => {
  blocks(`blob ${j('q8Zr', 'T2+vLk', '9/WnXp', 'E4sYh7', 'Ud0Mbf', 'C3aGjN', '1oPi')} end`, 'HIGH_ENTROPY');
  const sha = j('bf64a4c0', '53f7e85b', 'adef9671', '4084cae9', 'e8341df9');
  passes(`see commit ${sha}`, scanCtx({ gitObjectExists: (s) => s === sha }));
  blocks(`see commit ${sha}`, 'HIGH_ENTROPY', scanCtx({ gitObjectExists: () => false }));
});

test('3. PEM private key header blocks; an SSH public key passes', () => {
  blocks(j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----\nMIIE'), 'PRIVATE_KEY');
  blocks(j('-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----'), 'PRIVATE_KEY');
  blocks(j('PuTTY-User', '-Key-File-3: ssh-rsa'), 'PRIVATE_KEY');
  passes(j('ssh-', 'ed25519 ', 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl', ' dev@example.com'));
});

test('4. passwords block', () => {
  blocks(j('pass', 'word: hun', 'ter2x'), 'PASSWORD');
  blocks(j('run --pass', 'word=', 'abc123'), 'PASSWORD');
  blocks(j('AGENT_OFFICE', '_PASSWORD=', 'xyz'), 'PASSWORD');
});

test('5. a two-line .env blocks; prose mentioning .env passes', () => {
  blocks(j('DB_HOST=x\n', 'API_TO', 'KEN=y'), 'DOTENV');
  passes('Add the new setting to your .env file and restart.');
});

test('6. email: a real-looking address blocks; example.com passes', () => {
  blocks(j('mail ja', 'ne@co', 'rp.io today'), 'EMAIL');
  passes('mail dev@example.com today');
});

test('7. phone blocks; version and date pass', () => {
  blocks(j('call +1 (720) ', '555-0199'), 'PHONE');
  passes('release 1.2.3 on 2026-10-13');
});

test('8. owner name: whole word in any case blocks; inside another word passes', () => {
  const [first, last] = FAKE_OWNER.split(' ');
  blocks(`thanks ${first.toUpperCase()} for this`, 'OWNER_NAME');
  blocks(`by ${FAKE_OWNER.toLowerCase()}`, 'OWNER_NAME');
  blocks(`${last}'s notes`.replace("'s", ' s'), 'OWNER_NAME');
  passes(`the ${first}ish build has 12 files`);
});

test('9. home paths block', () => {
  blocks(j('C:\\Users\\', 'someone', '\\x'), 'HOME_PATH');
  blocks(j('C:/Users/', 'someone'), 'HOME_PATH');
  blocks(j('/home/', 'someone', '/notes'), 'HOME_PATH');
  blocks(`hi ${FAKE_HOME_USER} there`, 'HOME_PATH');
});

test('10. Major Files: paths and spellings block; Major Files2 passes', () => {
  blocks(j('C:\\Documents\\Major', ' Files\\a'), 'MAJOR_FILES');
  blocks('look in major_files', 'MAJOR_FILES');
  blocks('the MAJOR-FILES folder', 'MAJOR_FILES');
  passes('a folder called Major Files2 here');
  const r = presendScan('fine text', scanCtx({ sourcePath: j('D:/Major', ' Files/x.txt') }));
  assert.ok(r.hits.some((h) => h.type === 'MAJOR_FILES'), 'payload sourced from Major Files blocks');
});

test('11. Drive ID fixture blocks plain, base64, percent-encoded, zero-width split, and in a URL', () => {
  blocks(`id ${FAKE_DRIVE_ID} x`, 'DRIVE_ID');
  blocks(`id ${Buffer.from(FAKE_DRIVE_ID).toString('base64')} x`, 'DRIVE_ID');
  blocks(`id ${[...FAKE_DRIVE_ID].map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')} x`, 'DRIVE_ID');
  blocks(`id ${FAKE_DRIVE_ID.slice(0, 10)}\u200b${FAKE_DRIVE_ID.slice(10)} x`, 'DRIVE_ID');
  blocks(j('https://drive.google.com/drive/', 'folders/', 'anyOtherId123'), 'DRIVE_ID');
  blocks(j('https://docs.google.com/document', '/d/', 'anyDocId456/edit'), 'DRIVE_ID');
});

test('12. Preply / a hashed student name blocks', () => {
  blocks('notes from Preply today', 'STUDENT');
  blocks(`homework for ${FAKE_STUDENT}`, 'STUDENT');
  assert.ok(presendScan('ok', scanCtx({ studentSource: true })).hits.some((h) => h.type === 'STUDENT'));
});

test('13. financial: Luhn card and IBAN block; test card and Luhn-invalid pass', () => {
  blocks(j('card 4111', '1111', '1111', '1111'), 'FINANCIAL');
  passes('card 4242424242424242');
  passes('card 4111111111111112');
  blocks(j('iban GB82 ', 'WEST 1234 ', '5698 7654 32'), 'FINANCIAL');
  blocks(j('ssn 123', '-45-', '6789'), 'FINANCIAL');
});

test('16. fail closed: oversize, a throwing context, a timeout, a binary attachment', () => {
  assert.ok(presendScan('a'.repeat(MAX_SCAN_BYTES + 1), scanCtx()).hits.some((h) => h.type === 'UNSCANNABLE'));
  const boom = scanCtx({ gitObjectExists: () => { throw new Error('git broke'); } });
  const r = presendScan(j('commit ', 'bf64a4c053f7e85badef96714084cae9e8341df9'), boom);
  assert.equal(r.ok, false);
  assert.ok(r.hits.some((h) => h.type === 'UNSCANNABLE'));
  let t = 0;
  const slow = presendScan('plain words', scanCtx({ now: () => (t += 1500) }));
  assert.equal(slow.ok, false);
  assert.ok(slow.hits.some((h) => h.type === 'UNSCANNABLE'));
  const bin = scanPayload({ model: 'm', prompt: 'hi', attachments: [{ name: 'a.png', binary: true }] }, scanCtx());
  assert.equal(bin.ok, false);
  const env = scanPayload({ model: 'm', prompt: 'hi', attachments: [{ name: '.env', text: 'x' }] }, scanCtx());
  assert.ok(env.hits.some((h) => h.type === 'DOTENV'));
});

test('18. a clean public payload passes with no hits', () => {
  const r = scanPayload({ model: 'laguna:free', system: 'You are a helpful reviewer.', prompt: 'Summarise the README of the public agent-office repo in five bullets.', metadata: { level: 2 } }, scanCtx());
  assert.deepEqual(r.hits, []);
  assert.equal(r.ok, true);
});

test('the allowlist exempts a listed fake fixture, but never a NEVER_EXEMPT type', () => {
  passes(j('AKIA', 'IOSFODNN7', 'EXAMPLE'));
  // A Drive URL can't be allowlisted even if its hash is listed.
  const ctx = scanCtx();
  const url = j('https://drive.google.com/drive/', 'folders/', 'abc');
  ctx.allow.hashes.add(createHash('sha256').update(url.toLowerCase()).digest('hex'));
  blocks(url, 'DRIVE_ID', ctx);
});
