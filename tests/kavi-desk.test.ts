// Kavi's desk is a read-only activity twin of a local bridge folder. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readKaviDesk } from '../src/server/kavi-desk.js';

function fixture() {
  const root = path.join(tmpdir(), 'ao-kdesk-' + process.pid + '-' + Math.random().toString(36).slice(2));
  mkdirSync(path.join(root, 'in'), { recursive: true });
  mkdirSync(path.join(root, 'out'), { recursive: true });
  return root;
}
function put(file: string, t: number) {
  writeFileSync(file, 'fake packet body');
  utimesSync(file, t / 1000, t / 1000);
}

test('no folder configured is honest: unconfigured, never working', () => {
  const d = readKaviDesk(undefined);
  assert.equal(d.state, 'unconfigured');
  assert.equal(d.live, false);
});

test('missing folder reads as unreachable', () => {
  assert.equal(readKaviDesk(path.join(tmpdir(), 'ao-nope-' + Date.now())).state, 'unreachable');
});

test('empty folder is quiet', () => {
  const r = fixture();
  assert.equal(readKaviDesk(r).state, 'quiet');
  rmSync(r, { recursive: true, force: true });
});

test('newest inbound after newest outbound means waiting; reverse means answered', () => {
  const r = fixture();
  put(path.join(r, 'out', 'p1.md'), 1_000_000);
  put(path.join(r, 'in', 'p2.md'), 2_000_000);
  let d = readKaviDesk(r);
  assert.equal(d.state, 'waiting');
  assert.equal(d.inCount, 1);
  assert.equal(d.outCount, 1);
  assert.equal(d.lastIn, new Date(2_000_000).toISOString());
  put(path.join(r, 'out', 'p3.md'), 3_000_000);
  d = readKaviDesk(r);
  assert.equal(d.state, 'answered');
  assert.equal(d.lastOut, new Date(3_000_000).toISOString());
  rmSync(r, { recursive: true, force: true });
});

test('never leaks file names or packet text, never writes or deletes', () => {
  const r = fixture();
  put(path.join(r, 'in', 'secret-name-xyz.md'), 5_000_000);
  const before = readdirSync(path.join(r, 'in'));
  const json = JSON.stringify(readKaviDesk(r));
  assert.ok(!json.includes('secret-name-xyz'));
  assert.ok(!json.includes('fake packet body'));
  assert.ok(!json.includes(r));
  assert.deepEqual(readdirSync(path.join(r, 'in')), before);
  assert.equal(readFileSync(path.join(r, 'in', 'secret-name-xyz.md'), 'utf8'), 'fake packet body');
  rmSync(r, { recursive: true, force: true });
});

test('hidden and temp files are ignored; state is never working', () => {
  const r = fixture();
  put(path.join(r, 'in', '.DS_Store'), 9_000_000);
  put(path.join(r, 'in', '~lock.tmp'), 9_000_000);
  const d = readKaviDesk(r);
  assert.equal(d.inCount, 0);
  assert.notEqual(d.state as string, 'working');
  rmSync(r, { recursive: true, force: true });
});

test('module has no network, write, delete, or token code', () => {
  const src = readFileSync(path.join(process.cwd(), 'src/server/kavi-desk.ts'), 'utf8');
  for (const bad of ['fetch(', 'http', 'writeFile', 'unlink', 'rmSync', 'rename', 'token', 'googleapis', 'spawn', 'exec']) {
    assert.ok(!src.includes(bad), 'kavi-desk.ts must not contain ' + bad);
  }
});
