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
