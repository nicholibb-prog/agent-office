// The holiday theme defaults to off: a fresh office never turns into Halloween by itself in October,
// while a pick someone saved in Settings still comes back.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Themes } from '../src/server/theme.js';

const OCTOBER = Date.UTC(2026, 9, 15, 12);
let dir: string;
let realNow: () => number;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ao-theme-'));
  realNow = Date.now;
  Date.now = () => OCTOBER;
});
afterEach(() => {
  Date.now = realNow;
  rmSync(dir, { recursive: true, force: true });
});

test('a fresh office with no saved theme is off, even in October', () => {
  const t = new Themes(dir, () => 0, () => {});
  assert.equal(t.state().pick, 'off');
  assert.equal(t.state().active, null);
});

test('a theme.json without a valid pick still defaults to off', () => {
  writeFileSync(path.join(dir, 'theme.json'), '{}');
  const t = new Themes(dir, () => 0, () => {});
  assert.deepEqual(t.state(), { pick: 'off', active: null });
});

test('a saved halloween pick still loads', () => {
  writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ pick: 'halloween', by: 'nb', at: 1 }));
  const t = new Themes(dir, () => 0, () => {});
  assert.equal(t.state().pick, 'halloween');
  assert.equal(t.state().active, 'halloween');
});

test('auto stays selectable and follows the calendar', () => {
  const t = new Themes(dir, () => 0, () => {});
  t.set('auto', 'nb');
  assert.equal(t.state().pick, 'auto');
  assert.equal(t.state().active, 'halloween');
  const again = new Themes(dir, () => 0, () => {});
  assert.equal(again.state().pick, 'auto');
});
