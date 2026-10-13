// Kavi desk-PC thread: owner notes + Kavi replies from the Bridge folder. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DRIVE_LINK, mergeThread, noteBody, readThread, threadFs } from '../src/server/kavi-thread.js';
import { sendMessage, BRIDGE_ID_MARKER, KAVI_BRIDGE_FOLDER_ID } from '../src/server/kavi-send.js';
import { timeLabel } from '../src/client/features/kavi-board/send-panel.js';

function bridge() {
  const root = path.join(tmpdir(), 'ao-kthread-' + process.pid + '-' + Math.random().toString(36).slice(2));
  mkdirSync(path.join(root, 'to-kavi'), { recursive: true });
  mkdirSync(path.join(root, 'to-george'), { recursive: true });
  writeFileSync(path.join(root, BRIDGE_ID_MARKER), KAVI_BRIDGE_FOLDER_ID);
  return root;
}
function put(file: string, body: string, ms: number) {
  writeFileSync(file, body);
  utimesSync(file, ms / 1000, ms / 1000);
}
const T = Date.parse('2026-10-13T21:00:00.000Z');

test('thread merges both sides oldest-first, with owner before kavi on a tie', () => {
  const o = [{ from: 'owner' as const, text: 'a', at: new Date(T).toISOString() }, { from: 'owner' as const, text: 'c', at: new Date(T + 2000).toISOString() }];
  const k = [{ from: 'kavi' as const, text: 'b', at: new Date(T + 1000).toISOString() }, { from: 'kavi' as const, text: 'c2', at: new Date(T + 2000).toISOString() }];
  assert.deepEqual(mergeThread(o, k).map((x) => x.text), ['a', 'b', 'c', 'c2']);
  assert.deepEqual(mergeThread(o, k, 2).map((x) => x.text), ['c', 'c2'], 'keeps the newest');
});

test('readThread: owner notes from to-kavi, replies from to-george, each with its file time', () => {
  const r = bridge();
  const sent = sendMessage(r, 'first note');
  put(path.join(r, 'to-kavi', sent.name), readFileSync(path.join(r, 'to-kavi', sent.name), 'utf8'), T);
  put(path.join(r, 'to-george', 'reply-1.md'), 'Got it, owner.', T + 60_000);
  put(path.join(r, 'to-george', 'reply-0.txt'), 'Earlier hello', T - 60_000);
  put(path.join(r, 'to-george', '.hidden.md'), 'no', T);
  put(path.join(r, 'to-george', 'photo.png'), 'no', T);
  put(path.join(r, 'to-kavi', 'plan.pdf'), 'not a note', T);
  const t = readThread(r);
  assert.equal(t.state, 'ok');
  assert.equal(t.live, false);
  assert.equal(t.driveLink, DRIVE_LINK);
  assert.ok(DRIVE_LINK.endsWith(KAVI_BRIDGE_FOLDER_ID));
  assert.deepEqual(t.items.map((i) => [i.from, i.text, i.at]), [
    ['kavi', 'Earlier hello', new Date(T - 60_000).toISOString()],
    ['owner', 'first note', new Date(T).toISOString()],
    ['kavi', 'Got it, owner.', new Date(T + 60_000).toISOString()],
  ]);
  rmSync(r, { recursive: true, force: true });
});

test('note header and footer are stripped', () => {
  assert.equal(noteBody('# From the owner (agent office)\n\nhi there\n\n_Sent 2026. Not a live call._\n'), 'hi there');
});

test('time labels: time only today, date and time otherwise, empty for junk', () => {
  const now = new Date('2026-10-13T22:00:00Z');
  const today = timeLabel('2026-10-13T21:30:00Z', now);
  assert.match(today, /\d{1,2}:\d{2}/);
  assert.doesNotMatch(today, /Oct/);
  assert.match(timeLabel('2026-10-01T21:30:00Z', now), /Oct.*\d{1,2}:\d{2}/);
  assert.equal(timeLabel('nope', now), '');
});

test('Major Files reply dir is refused before any fs call', () => {
  const orig = { ...threadFs };
  const calls: string[] = [];
  threadFs.realpathSync = (p: string) => (calls.push('real:' + p), orig.realpathSync(p));
  threadFs.readdirSync = (p: string) => (calls.push('dir:' + p), orig.readdirSync(p));
  try {
    for (const p of ['C:\\Users\\owner\\Documents\\Major Files\\Bridge', '/home/owner/major_files/bridge', '/x/MAJOR-FILES']) {
      const t = readThread(p);
      assert.equal(t.state, 'unreachable');
      assert.deepEqual(t.items, []);
    }
    assert.deepEqual(calls, []);
    const r = bridge();
    readThread(r);
    assert.ok(calls.length > 0, 'spy sees normal paths');
    rmSync(r, { recursive: true, force: true });
  } finally {
    Object.assign(threadFs, orig);
  }
  assert.equal(readThread(undefined).state, 'unconfigured');
});

test('no typing indicator anywhere in the thread or the desk-PC screen', () => {
  const t = readThread(bridge()) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(t).sort(), ['driveLink', 'items', 'live', 'state']);
  for (const f of ['src/server/kavi-thread.ts', 'src/client/features/kavi-board/send-panel.ts']) {
    const src = readFileSync(path.join(process.cwd(), f), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.doesNotMatch(src, /typing|is writing|\.\.\.\s*['"`]|composing/i, f);
  }
});

import { symlinkSync } from 'node:fs';
import { MAX_SCAN, MAX_BYTES, MAX_THREAD } from '../src/server/kavi-thread.js';

test('a symlinked to-george pointing outside the bridge is refused', () => {
  const r = bridge();
  const outside = path.join(tmpdir(), 'ao-kout-' + process.pid + Math.random().toString(36).slice(2));
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.md'), 'outside text');
  rmSync(path.join(r, 'to-george'), { recursive: true });
  symlinkSync(outside, path.join(r, 'to-george'));
  assert.deepEqual(readThread(r).items, []);
  rmSync(r, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test('a symlinked to-kavi pointing at Major Files is refused before it is listed', () => {
  const r = bridge();
  const mf = path.join(tmpdir(), 'ao-kmf-' + process.pid, 'Documents', 'Major Files');
  mkdirSync(mf, { recursive: true });
  writeFileSync(path.join(mf, 'owner-to-kavi-x.md'), '# From the owner\n\nprivate');
  rmSync(path.join(r, 'to-kavi'), { recursive: true });
  symlinkSync(mf, path.join(r, 'to-kavi'));
  const listed: string[] = [];
  const orig = threadFs.readdirSync;
  threadFs.readdirSync = (p: string) => (listed.push(p), orig(p));
  try {
    assert.deepEqual(readThread(r).items, []);
    assert.ok(!listed.some((p) => /major files/i.test(p)), 'Major Files never listed');
  } finally {
    threadFs.readdirSync = orig;
  }
  rmSync(r, { recursive: true, force: true });
  rmSync(path.join(tmpdir(), 'ao-kmf-' + process.pid), { recursive: true, force: true });
});

test('a symlinked reply file is skipped', () => {
  const r = bridge();
  const outside = path.join(tmpdir(), 'ao-kf-' + process.pid + Math.random().toString(36).slice(2) + '.md');
  writeFileSync(outside, 'linked secret');
  symlinkSync(outside, path.join(r, 'to-george', 'link.md'));
  put(path.join(r, 'to-george', 'real.md'), 'real reply', T);
  assert.deepEqual(readThread(r).items.map((i) => i.text), ['real reply']);
  rmSync(r, { recursive: true, force: true });
  rmSync(outside, { force: true });
});

test('caps: newest replies by time, at most MAX_THREAD read, scan stops at MAX_SCAN names', () => {
  const r = bridge();
  for (let i = 0; i < MAX_SCAN + 50; i++) put(path.join(r, 'to-george', `r${String(i).padStart(4, '0')}.md`), `reply ${i}`, T + i * 1000);
  const t = readThread(r);
  assert.equal(t.items.length, MAX_THREAD);
  const times = t.items.map((i) => Date.parse(i.at));
  assert.deepEqual([...times].sort((a, b) => a - b), times, 'oldest first');
  rmSync(r, { recursive: true, force: true });
});

test('caps: stop reading at about 2 MB in total', () => {
  const r = bridge();
  const big = 'x'.repeat(200 * 1024);
  for (let i = 0; i < 15; i++) put(path.join(r, 'to-george', `big${i}.md`), big, T + i * 1000);
  const t = readThread(r);
  assert.ok(t.items.length * big.length <= MAX_BYTES, 'within the byte budget');
  assert.equal(t.items.length, Math.floor(MAX_BYTES / big.length));
  assert.equal(Date.parse(t.items.at(-1)!.at), T + 14_000, 'the newest are the ones kept');
  rmSync(r, { recursive: true, force: true });
});
