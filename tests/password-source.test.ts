import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ARGV_DEPRECATION,
  PasswordSourceError,
  isMajorFilesPath,
  readPasswordFile,
  resolvePassword,
  scrubPasswordArgv,
} from '../src/server/password-source.js';
import { loadConfig } from '../src/server/config.js';
import { execFileSync } from 'node:child_process';

const SECRET = 'S3cret-Value-zq81';
const posix = process.platform !== 'win32';

function tmp(t: { after(fn: () => void): void }) {
  const d = mkdtempSync(path.join(tmpdir(), 'ao-pw-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
let n = 0;
function secretFile(dir: string, body = SECRET + '\n', mode = 0o600) {
  const f = path.join(dir, `pw${n++}`);
  writeFileSync(f, body);
  chmodSync(f, mode);
  return f;
}

test('precedence: env beats file beats argv', (t) => {
  const f = secretFile(tmp(t), 'from-file\n');
  const warn: string[] = [];
  const w = (l: string) => void warn.push(l);
  assert.deepEqual(resolvePassword({ env: { AGENT_OFFICE_PASSWORD: 'from-env', AGENT_OFFICE_PASSWORD_FILE: f }, argvPassword: 'from-argv', warn: w }), { password: 'from-env', source: 'env' });
  assert.deepEqual(resolvePassword({ env: { AGENT_OFFICE_PASSWORD_FILE: f }, argvPassword: 'from-argv', warn: w }), { password: 'from-file', source: 'file' });
  assert.equal(warn.length, 0);
  assert.deepEqual(resolvePassword({ env: {}, argvPassword: 'from-argv', warn: w }), { password: 'from-argv', source: 'argv' });
  assert.equal(warn.length, 1);
  assert.deepEqual(resolvePassword({ env: {}, warn: w }), { password: '', source: 'none' });
});

test('file: value is trimmed; whitespace-only file refused', (t) => {
  const d = tmp(t);
  assert.equal(readPasswordFile(secretFile(d, SECRET + '\r\n')), SECRET);
  assert.equal(readPasswordFile(secretFile(d, ' a b \n\n')), 'a b');
  assert.throws(() => readPasswordFile(secretFile(d, '   \t \n')), (e: Error) => /empty/.test(e.message) && !e.message.includes(SECRET));
});

test('file: group/world-readable refused on POSIX, without the value in the error', { skip: !posix }, (t) => {
  const d = tmp(t);
  for (const mode of [0o640, 0o604, 0o644]) {
    const f = secretFile(d, SECRET + '\n', mode);
    assert.throws(() => readPasswordFile(f), (e: Error) => e instanceof PasswordSourceError && /group\/others/.test(e.message) && !e.message.includes(SECRET));
  }
  assert.equal(readPasswordFile(secretFile(d, SECRET, 0o400)), SECRET);
  // On Windows the mode bits aren't meaningful, so that check is skipped there.
  assert.equal(readPasswordFile(secretFile(d, SECRET, 0o644), 'win32'), SECRET);
});

test('file: Major Files refused before the path is touched', (t) => {
  assert.ok(isMajorFilesPath('C:\\Users\\owner\\Documents\\Major Files\\pw.txt'));
  assert.ok(isMajorFilesPath('/home/owner/documents/major files/pw'));
  assert.ok(!isMajorFilesPath('/home/owner/Documents/Minor Files/pw'));
  // A path that doesn't exist still gets the Major Files message: refused on the string alone.
  assert.throws(() => readPasswordFile('/nonexistent/Documents/Major Files/pw'), /Major Files/);
  // And through a symlink that points into Major Files.
  const d = tmp(t);
  const mf = path.join(d, 'Documents', 'Major Files');
  mkdirSync(mf, { recursive: true });

  const link = path.join(d, 'link');
  try { symlinkSync(secretFile(mf), link); } catch { return; }
  assert.throws(() => readPasswordFile(link), /Major Files/);
});

test('file: missing or empty file errors carry no value', (t) => {
  const d = tmp(t);
  assert.throws(() => readPasswordFile(path.join(d, 'nope')), /cannot be read/);
  assert.throws(() => readPasswordFile(secretFile(d, '\n')), /empty/);
});

test('deprecation warning is one line and has no value', () => {
  const warn: string[] = [];
  resolvePassword({ env: {}, argvPassword: SECRET, warn: (l) => void warn.push(l) });
  assert.deepEqual(warn, [ARGV_DEPRECATION]);
  assert.ok(!warn[0].includes(SECRET) && !warn[0].includes('\n'));
});

test('scrubPasswordArgv removes the flag and its value', () => {
  const a = ['--port', '1', '--password', SECRET, '--password=' + SECRET, '--no-open'];
  scrubPasswordArgv(a);
  assert.deepEqual(a, ['--port', '1', '--no-open']);
});

function captureLoad(t: { after(fn: () => void): void }, env: Record<string, string | undefined>, argv: string[]) {
  const home = tmp(t);
  const saved: Record<string, string | undefined> = {};
  for (const k of ['AGENT_OFFICE_PASSWORD', 'AGENT_OFFICE_PASSWORD_FILE']) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  const out: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, exit: process.exit, so: process.stdout.write, se: process.stderr.write };
  const grab = (...a: unknown[]) => void out.push(a.map(String).join(' '));
  console.log = console.warn = console.error = console.info = grab;
  process.stdout.write = ((c: unknown) => (out.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown) => (out.push(String(c)), true)) as typeof process.stderr.write;
  process.exit = ((code?: number) => { throw new Error(`exit ${code}`); }) as typeof process.exit;
  let cfg: ReturnType<typeof loadConfig> | undefined;
  let err: unknown;
  try { cfg = loadConfig(['--home', home, '--no-open', ...argv]); } catch (e) { err = e; }
  finally {
    Object.assign(console, { log: orig.log, warn: orig.warn, error: orig.error, info: orig.info });
    process.exit = orig.exit; process.stdout.write = orig.so; process.stderr.write = orig.se;
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  return { cfg, err, out: out.join('\n') };
}

test('loadConfig: env, file and argv all work and nothing logged contains the value', (t) => {
  const f = secretFile(tmp(t));
  for (const [env, argv] of [
    [{ AGENT_OFFICE_PASSWORD: SECRET }, []],
    [{ AGENT_OFFICE_PASSWORD_FILE: f }, []],
    [{}, ['--password', SECRET]],
  ] as const) {
    const argvCopy = [...argv];
    const r = captureLoad(t, env, argvCopy);
    assert.equal(r.err, undefined);
    assert.equal(r.cfg!.password, SECRET);
    assert.ok(!r.out.includes(SECRET), 'value leaked to output');
    assert.ok(!JSON.stringify({ ...r.cfg, password: undefined }).includes(SECRET));
  }
  const r = captureLoad(t, {}, ['--password', SECRET]);
  assert.match(r.out, /deprecated/);
});

test('loadConfig: refused password file exits without echoing the value', { skip: !posix }, (t) => {
  const f = secretFile(tmp(t), SECRET + '\n', 0o644);
  const r = captureLoad(t, { AGENT_OFFICE_PASSWORD_FILE: f }, []);
  assert.match(String(r.err), /exit 2/);
  assert.match(r.out, /group\/others/);
  assert.ok(!r.out.includes(SECRET));
});

test('tunnel parseArgs: same order (env, file, argv) and a value-free warning', async (t) => {
  const { parseArgs } = await import('../src/server/tunnel/index.js');
  const f = secretFile(tmp(t), 'from-file\n');
  const warn: string[] = [];
  const w = (l: string) => void warn.push(l);
  assert.equal(parseArgs(['--password', SECRET], { AGENT_OFFICE_PASSWORD: 'from-env', AGENT_OFFICE_PASSWORD_FILE: f }, w)!.credentials.password, 'from-env');
  assert.equal(parseArgs(['--password', SECRET], { AGENT_OFFICE_PASSWORD_FILE: f }, w)!.credentials.password, 'from-file');
  assert.equal(warn.length, 0);
  assert.equal(parseArgs(['--password', SECRET], {}, w)!.credentials.password, SECRET);
  assert.deepEqual(warn, [ARGV_DEPRECATION]);
  assert.throws(() => parseArgs([], { AGENT_OFFICE_PASSWORD_FILE: '/x/Documents/Major Files/pw' }, w), (e: Error) => /Major Files/.test(e.message) && !e.message.includes(SECRET));
});

test('loadConfig: password env vars are gone afterwards and not inherited by children', (t) => {
  const f = secretFile(tmp(t));
  for (const env of [{ AGENT_OFFICE_PASSWORD: SECRET, AGENT_OFFICE_PASSWORD_FILE: f }, { AGENT_OFFICE_PASSWORD_FILE: f }]) {
    Object.assign(process.env, env);
    assert.equal(loadConfig(['--home', tmp(t), '--no-open']).password, SECRET);
    assert.equal(process.env.AGENT_OFFICE_PASSWORD, undefined);
    assert.equal(process.env.AGENT_OFFICE_PASSWORD_FILE, undefined);
    const childEnv = execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { encoding: 'utf8' });
    assert.ok(!childEnv.includes('AGENT_OFFICE_PASSWORD') && !childEnv.includes(SECRET));
  }
});

test('tunnel parseArgs: password env vars are removed from the environment', async () => {
  const { parseArgs } = await import('../src/server/tunnel/index.js');
  process.env.AGENT_OFFICE_PASSWORD = SECRET;
  process.env.AGENT_OFFICE_PASSWORD_FILE = '/unused';
  assert.equal(parseArgs([], process.env)!.credentials.password, SECRET);
  assert.equal(process.env.AGENT_OFFICE_PASSWORD, undefined);
  assert.equal(process.env.AGENT_OFFICE_PASSWORD_FILE, undefined);
});
