// Near-live frames from the synced Drive Bridge folder: path safety, caps, staleness, off by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDriveFrame } from '../src/server/drive-frames.js';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

function dir() {
  const d = path.join(tmpdir(), 'ao-drive-' + process.pid + Math.random().toString(36).slice(2));
  mkdirSync(path.join(d, 'live'), { recursive: true });
  return d;
}

test('reads a fresh JPEG for the seat', () => {
  const d = dir();
  writeFileSync(path.join(d, 'live', 'seat-1.jpg'), JPG);
  const f = readDriveFrame('seat-1', { AO_BRIDGE_LOCAL_DIR: d });
  assert.ok(f && f.bytes.equals(JPG) && f.mime === 'image/jpeg');
});

test('no folder configured, bad seat names and traversal give nothing', () => {
  const d = dir();
  writeFileSync(path.join(d, 'secret.jpg'), JPG);
  assert.equal(readDriveFrame('seat-1', {}), undefined);
  for (const s of ['../secret', '..', 'a/b', 'SEAT-1', '']) assert.equal(readDriveFrame(s, { AO_BRIDGE_LOCAL_DIR: d }), undefined, s);
});

test('symlinks are rejected, even to a real JPEG', () => {
  const d = dir();
  writeFileSync(path.join(d, 'outside.jpg'), JPG);
  symlinkSync(path.join(d, 'outside.jpg'), path.join(d, 'live', 'seat-2.jpg'));
  assert.equal(readDriveFrame('seat-2', { AO_BRIDGE_LOCAL_DIR: d }), undefined);
});

test('size cap and JPEG check', () => {
  const d = dir();
  writeFileSync(path.join(d, 'live', 'seat-3.jpg'), Buffer.concat([JPG, Buffer.alloc(500 * 1024)]));
  writeFileSync(path.join(d, 'live', 'seat-4.jpg'), Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(40)));
  assert.equal(readDriveFrame('seat-3', { AO_BRIDGE_LOCAL_DIR: d }), undefined);
  assert.equal(readDriveFrame('seat-4', { AO_BRIDGE_LOCAL_DIR: d }), undefined);
});

test('older than 60 s is no live feed', () => {
  const d = dir();
  const f = path.join(d, 'live', 'seat-5.jpg');
  writeFileSync(f, JPG);
  const old = (Date.now() - 61_000) / 1000;
  utimesSync(f, old, old);
  assert.equal(readDriveFrame('seat-5', { AO_BRIDGE_LOCAL_DIR: d }), undefined);
  const ok = (Date.now() - 30_000) / 1000;
  utimesSync(f, ok, ok);
  assert.ok(readDriveFrame('seat-5', { AO_BRIDGE_LOCAL_DIR: d }));
});

test('seat must be a real crew seat (isSeatId), not just a tidy string', async () => {
  const d = dir();
  for (const s of ['seat-a', 'george', 'seat-10']) writeFileSync(path.join(d, 'live', s + '.jpg'), JPG);
  writeFileSync(path.join(d, 'live', 'seat-9.jpg'), JPG);
  for (const s of ['seat-a', 'george', 'seat-10']) assert.equal(readDriveFrame(s, { AO_BRIDGE_LOCAL_DIR: d }), undefined, s);
  assert.ok(readDriveFrame('seat-9', { AO_BRIDGE_LOCAL_DIR: d }));
  const { LiveFrames } = await import('../src/server/live-frames.js');
  const store = new LiveFrames();
  for (const s of ['seat-a', 'george', '../x', 'seat-10', '']) assert.equal(store.setEnabled(s, true), false, s);
  assert.equal(store.setEnabled('seat-1', true), true);
  assert.equal(store.setEnabled('okkin', true), true);
});

test('refuses a Bridge folder under Major Files, as given or through a symlink', async () => {
  const { isMajorFiles } = await import('../src/server/major-files.js');
  assert.ok(isMajorFiles('C:\\Users\\owner\\Major Files\\Bridge'));
  assert.ok(isMajorFiles('/home/x/major_files/bridge'));
  assert.ok(!isMajorFiles('/home/x/Bridge/live'));
  const top = path.join(tmpdir(), 'ao-mf-' + process.pid + Math.random().toString(36).slice(2));
  const inside = path.join(top, 'Major Files', 'Bridge');
  mkdirSync(path.join(inside, 'live'), { recursive: true });
  writeFileSync(path.join(inside, 'live', 'seat-1.jpg'), JPG);
  assert.equal(readDriveFrame('seat-1', { AO_BRIDGE_LOCAL_DIR: inside }), undefined, 'direct path');
  const link = path.join(top, 'Bridge-link');
  symlinkSync(inside, link);
  assert.equal(readDriveFrame('seat-1', { AO_BRIDGE_LOCAL_DIR: link }), undefined, 'realpath lands in Major Files');
});

test('a Major Files path returns before realpath is ever called', async () => {
  const { driveFs } = await import('../src/server/drive-frames.js');
  const orig = driveFs.realpathSync;
  const calls: string[] = [];
  driveFs.realpathSync = (p: string) => (calls.push(p), orig(p));
  try {
    assert.equal(readDriveFrame('seat-1', { AO_BRIDGE_LOCAL_DIR: 'C:\\Users\\owner\\Major Files\\Bridge' }), undefined);
    assert.equal(readDriveFrame('seat-1', { AO_BRIDGE_LOCAL_DIR: '/home/owner/major_files/bridge' }), undefined);
    assert.deepEqual(calls, [], 'no realpath on a Major Files path');
    const d = dir();
    writeFileSync(path.join(d, 'live', 'seat-1.jpg'), JPG);
    assert.ok(readDriveFrame('seat-1', { AO_BRIDGE_LOCAL_DIR: d }));
    assert.ok(calls.length > 0, 'the spy does see normal paths');
  } finally {
    driveFs.realpathSync = orig;
  }
});
