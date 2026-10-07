import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OfficeState } from '../src/server/office-state.js';
import { closedSinceLabel } from '../src/shared/since-close.js';

function dir(t: test.TestContext): string {
  const d = mkdtempSync(path.join(tmpdir(), 'ao-office-state-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test('open after owner close keeps a since-close window from closedAt', (t) => {
  const d = dir(t);
  const a = new OfficeState(d);
  a.openOnBoot(1_000_000);
  a.close('owner', 1_100_000);
  const b = new OfficeState(d);
  const opened = b.openOnBoot(1_200_000);
  assert.equal(opened.office, 'open');
  assert.equal(opened.sinceCloseReason, 'owner');
  assert.equal(opened.sinceCloseAt, new Date(1_100_000).toISOString());
  assert.equal(opened.openedAt, new Date(1_200_000).toISOString());
});

test('unclean stop (still open on disk) is labelled unexpected from last event', (t) => {
  const d = dir(t);
  const a = new OfficeState(d);
  a.openOnBoot(1_000_000);
  // Simulate crash: leave office=open on disk, start a fresh instance.
  const b = new OfficeState(d);
  const opened = b.openOnBoot(1_500_000, 1_250_000);
  assert.equal(opened.office, 'open');
  assert.equal(opened.sinceCloseReason, 'unexpected');
  assert.equal(opened.sinceCloseAt, new Date(1_250_000).toISOString());
});

test('persistence survives restart and file is mode 0600', (t) => {
  const d = dir(t);
  const a = new OfficeState(d);
  a.openOnBoot(2_000_000);
  a.close('owner', 2_100_000);
  const file = path.join(d, 'office-state.json');
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode, 0o600);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { office: string; closeReason: string };
  assert.equal(raw.office, 'closed');
  assert.equal(raw.closeReason, 'owner');
  const b = new OfficeState(d);
  assert.equal(b.state().office, 'closed');
  assert.equal(b.state().closeReason, 'owner');
});

test('dismiss stores the openedAt so the glance does not re-pop until next open', (t) => {
  const d = dir(t);
  const a = new OfficeState(d);
  a.close('owner', 1000);
  a.openOnBoot(2000);
  assert.equal(a.glanceDismissed(), false);
  assert.equal(a.dismissGlance(), true);
  assert.equal(a.glanceDismissed(), true);
  a.close('owner', 3000);
  a.openOnBoot(4000);
  assert.equal(a.glanceDismissed(), false);
});

test('Closed since HH:MM is calm local time from real closedAt', () => {
  // Fixed instant: use local getters via closedSinceLabel.
  const iso = new Date(2026, 9, 6, 7, 5, 0).toISOString();
  const label = closedSinceLabel(iso);
  assert.equal(label, 'Closed since 07:05');
  assert.equal(closedSinceLabel(undefined), null);
});

test('atomic temp+rename leaves a readable JSON file', (t) => {
  const d = dir(t);
  const a = new OfficeState(d);
  a.openOnBoot(5_000_000);
  const file = path.join(d, 'office-state.json');
  JSON.parse(readFileSync(file, 'utf8'));
  // Force a second write
  a.close('owner', 5_100_000);
  const again = JSON.parse(readFileSync(file, 'utf8')) as { office: string };
  assert.equal(again.office, 'closed');
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
});
