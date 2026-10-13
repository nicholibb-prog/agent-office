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
